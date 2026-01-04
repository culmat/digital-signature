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

export async function importData(inputData) {
  try {
    let sqlDump;

    // Auto-detect format: check if it's plain SQL or base64-encoded gzip
    const trimmedInput = inputData.trim();

    // Check if it looks like SQL (starts with -- comment or SET or INSERT)
    if (trimmedInput.startsWith('--') ||
        trimmedInput.startsWith('SET ') ||
        trimmedInput.startsWith('INSERT ')) {
      console.log('Detected plain SQL format');
      sqlDump = trimmedInput;
    } else {
      // Assume it's base64-encoded gzipped data
      console.log('Detected base64-encoded gzip format');
      try {
        const compressed = Buffer.from(trimmedInput, 'base64');
        sqlDump = gunzipSync(compressed).toString('utf-8');
      } catch (decodeError) {
        throw new Error('Invalid backup data format. Expected either plain SQL or base64-encoded .sql.gz data');
      }
    }

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

        const result = await sql.executeRaw(statement);

        // Handle both response formats: {rows: UpdateQueryResponse} or UpdateQueryResponse
        const resultData = result?.rows || result;
        const affectedRows = resultData?.affectedRows || 0;
        const changedRows = resultData?.changedRows || 0;

        // For INSERT ... ON DUPLICATE KEY UPDATE:
        // - affectedRows = number of rows affected (1 per insert, 2 per update)
        // - changedRows = number of rows actually changed (0 if data is same)
        // - insertId = 0 (not useful for multi-row inserts)

        if (statement.includes('INSERT INTO contract')) {
          // If changedRows > 0, some rows were updated with different data
          // If changedRows = 0 but affectedRows > 0, rows were inserted or updated with same data
          if (changedRows > 0) {
            summary.contractsUpdated += changedRows;
            summary.contractsInserted += Math.max(0, affectedRows - (changedRows * 2));
          } else if (affectedRows > 0) {
            // All rows were new inserts (affectedRows = 1 per insert)
            summary.contractsInserted += affectedRows;
          }
        } else if (statement.includes('INSERT INTO signature')) {
          if (changedRows > 0) {
            summary.signaturesUpdated += changedRows;
            summary.signaturesInserted += Math.max(0, affectedRows - (changedRows * 2));
          } else if (affectedRows > 0) {
            summary.signaturesInserted += affectedRows;
          }
        }
      } catch (error) {
        console.error('Error executing statement:', statement, error);
        summary.errors.push({
          statement: statement.substring(0, 100) + '...',
          error: error.message
        });
      }
    }

    summary.executionTimeSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));

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

export async function deleteAllData() {
  const startTime = Date.now();

  try {
    console.log('Starting deletion of all signature data');

    // Delete signatures first (due to foreign key constraint)
    const signaturesResult = await sql.executeRaw('DELETE FROM signature');

    // Handle both response formats: {rows: UpdateQueryResponse} or UpdateQueryResponse
    const signaturesData = signaturesResult?.rows || signaturesResult;
    const signaturesDeleted = signaturesData?.affectedRows || 0;

    // Delete contracts
    const contractsResult = await sql.executeRaw('DELETE FROM contract');

    const contractsData = contractsResult?.rows || contractsResult;
    const contractsDeleted = contractsData?.affectedRows || 0;

    const executionTimeSeconds = parseFloat(((Date.now() - startTime) / 1000).toFixed(2));

    console.log(`Deletion completed. Deleted ${contractsDeleted} contracts and ${signaturesDeleted} signatures in ${executionTimeSeconds}s`);

    return {
      success: true,
      contractsDeleted,
      signaturesDeleted,
      executionTimeSeconds
    };
  } catch (error) {
    console.error('Error deleting all data:', error);
    throw new Error(`Failed to delete all data: ${error.message}`);
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
