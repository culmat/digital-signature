import sql from '@forge/sql';
import { gzipSync, gunzipSync } from 'zlib';

const DEFAULT_CHUNK_SIZE = 5000;
const MAX_CHUNK_SIZE = 10000;

export async function exportData(offset = 0, limit = DEFAULT_CHUNK_SIZE) {
  const startTime = Date.now();

  if (limit > MAX_CHUNK_SIZE) {
    limit = MAX_CHUNK_SIZE;
  }

  try {
    const stats = await getStatistics();
    const isFirstChunk = offset === 0;

    const sqlStatements = [];

    if (isFirstChunk) {
      sqlStatements.push(generateMetadataComments(stats));
      sqlStatements.push('SET FOREIGN_KEY_CHECKS = 0;');
      sqlStatements.push('');
    }

    const contractsResult = await sql.prepare(`
      SELECT hash, pageId, createdAt, deletedAt
      FROM contract
      ORDER BY hash
      LIMIT ${limit} OFFSET ${offset}
    `).execute();

    const contracts = contractsResult?.rows || contractsResult || [];

    if (contracts.length > 0) {
      const contractInserts = generateContractInserts(contracts);
      sqlStatements.push(contractInserts);
      sqlStatements.push('');
    }

    const signaturesResult = await sql.prepare(`
      SELECT contractHash, accountId, signedAt
      FROM signature
      ORDER BY contractHash, accountId
      LIMIT ${limit} OFFSET ${offset}
    `).execute();

    const signatures = signaturesResult?.rows || signaturesResult || [];

    if (signatures.length > 0) {
      const signatureInserts = generateSignatureInserts(signatures);
      sqlStatements.push(signatureInserts);
      sqlStatements.push('');
    }

    const nextOffset = offset + limit;
    const processedContracts = Math.min(nextOffset, stats.totalContracts);
    const processedSignatures = Math.min(nextOffset, stats.totalSignatures);

    const totalRows = stats.totalContracts + stats.totalSignatures;
    const completed = nextOffset >= totalRows;

    if (completed) {
      sqlStatements.push('SET FOREIGN_KEY_CHECKS = 1;');
    }

    const sqlDump = sqlStatements.join('\n');
    const compressed = gzipSync(sqlDump);
    const base64Data = compressed.toString('base64');

    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    const estimatedChunks = Math.ceil(totalRows / limit);

    return {
      completed,
      data: base64Data,
      offset: completed ? undefined : nextOffset,
      stats: {
        totalContracts: stats.totalContracts,
        totalSignatures: stats.totalSignatures,
        processedContracts,
        processedSignatures,
        ...(completed ? { totalChunks: Math.ceil(nextOffset / limit) } : { estimatedChunks }),
        elapsedSeconds
      }
    };
  } catch (error) {
    console.error('Error exporting data:', error);
    console.error('Error stack:', error.stack);
    console.error('Error details:', JSON.stringify(error, null, 2));
    throw new Error(`Export failed: ${error.message || error}`);
  }
}

export async function importData(base64GzippedSqlDump) {
  try {
    const compressed = Buffer.from(base64GzippedSqlDump, 'base64');
    const sqlDump = gunzipSync(compressed).toString('utf-8');

    const statements = parseSqlStatements(sqlDump);

    const summary = {
      contractsInserted: 0,
      contractsUpdated: 0,
      signaturesInserted: 0,
      signaturesUpdated: 0,
      executionTimeSeconds: 0,
      errors: []
    };

    const startTime = Date.now();

    for (const statement of statements) {
      try {
        if (statement.trim().startsWith('--') ||
            statement.trim().startsWith('SET ') ||
            statement.trim().length === 0) {
          continue;
        }

        const result = await sql.unsafe(statement);

        if (statement.includes('INSERT INTO contract')) {
          summary.contractsInserted += result.insertId ? 1 : 0;
          summary.contractsUpdated += result.affectedRows - (result.insertId ? 1 : 0);
        } else if (statement.includes('INSERT INTO signature')) {
          summary.signaturesInserted += result.insertId ? 1 : 0;
          summary.signaturesUpdated += result.affectedRows - (result.insertId ? 1 : 0);
        }
      } catch (error) {
        console.error('Error executing statement:', statement, error);
        summary.errors.push({
          statement: statement.substring(0, 100) + '...',
          error: error.message
        });
      }
    }

    summary.executionTimeSeconds = Math.floor((Date.now() - startTime) / 1000);

    return {
      completed: true,
      summary
    };
  } catch (error) {
    console.error('Error importing data:', error);
    throw new Error(`Import failed: ${error.message}`);
  }
}

export async function getStatistics() {
  try {
    const contractStats = await sql.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN deletedAt IS NULL THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN deletedAt IS NOT NULL THEN 1 ELSE 0 END) as deleted
      FROM contract
    `).execute();

    const signatureStats = await sql.prepare(`
      SELECT COUNT(*) as total
      FROM signature
    `).execute();

    const contractRows = contractStats?.rows || contractStats || [];
    const signatureRows = signatureStats?.rows || signatureStats || [];

    const contracts = contractRows[0] || { total: 0, active: 0, deleted: 0 };
    const signatures = signatureRows[0] || { total: 0 };

    return {
      totalContracts: Number(contracts.total || 0),
      activeContracts: Number(contracts.active || 0),
      deletedContracts: Number(contracts.deleted || 0),
      totalSignatures: Number(signatures.total || 0)
    };
  } catch (error) {
    console.error('Error fetching statistics:', error);
    throw new Error(`Failed to fetch statistics: ${error.message}`);
  }
}

function generateMetadataComments(stats) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  return `-- Digital Signature Backup
-- Version: 3.0.0
-- Exported: ${timestamp} UTC
-- Total Contracts: ${stats.totalContracts}
-- Total Signatures: ${stats.totalSignatures}`;
}

function generateContractInserts(contracts) {
  const values = contracts.map(c => {
    const createdAt = formatTimestamp(c.createdAt);
    const deletedAt = c.deletedAt ? `'${formatTimestamp(c.deletedAt)}'` : 'NULL';
    return `('${c.hash}', ${c.pageId}, '${createdAt}', ${deletedAt})`;
  });

  return `INSERT INTO contract (hash, pageId, createdAt, deletedAt) VALUES
${values.join(',\n')}
ON DUPLICATE KEY UPDATE
  pageId = VALUES(pageId),
  createdAt = LEAST(createdAt, VALUES(createdAt)),
  deletedAt = COALESCE(VALUES(deletedAt), deletedAt);`;
}

function generateSignatureInserts(signatures) {
  const values = signatures.map(s => {
    const signedAt = formatTimestamp(s.signedAt);
    return `('${s.contractHash}', '${s.accountId}', '${signedAt}')`;
  });

  return `INSERT INTO signature (contractHash, accountId, signedAt) VALUES
${values.join(',\n')}
ON DUPLICATE KEY UPDATE
  signedAt = LEAST(signedAt, VALUES(signedAt));`;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return null;

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

  return date.toISOString()
    .replace('T', ' ')
    .replace('Z', '')
    .substring(0, 26);
}

function parseSqlStatements(sqlDump) {
  const lines = sqlDump.split('\n');
  const statements = [];
  let currentStatement = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('--') || trimmed.length === 0) {
      if (currentStatement.trim().length > 0) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
      if (trimmed.startsWith('SET ')) {
        statements.push(trimmed);
      }
      continue;
    }

    currentStatement += line + '\n';

    if (trimmed.endsWith(';')) {
      statements.push(currentStatement.trim());
      currentStatement = '';
    }
  }

  if (currentStatement.trim().length > 0) {
    statements.push(currentStatement.trim());
  }

  return statements;
}
