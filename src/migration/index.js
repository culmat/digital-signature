/**
 * CMA App Data Migration Handler (i0052)
 *
 * Triggered by `avi:app-data-uploaded` when the Confluence Cloud Migration
 * Assistant has finished uploading the JSONL.gz payload exported by the
 * legacy Server/DC plugin (DigitalSignatureMigrationListener).
 *
 * Reads each contract line, resolves server usernames to Cloud account IDs
 * via the CMA Mappings API, and inserts rows into the `contract` and
 * `signature` SQL tables (idempotent — safe to re-run).
 */

import { migration } from '@forge/migrations';
import sql from '@forge/sql';
import { gunzipSync } from 'zlib';

/** Label written by DigitalSignatureMigrationListener#onStartAppMigration */
const SIGNATURES_LABEL = 'signatures';

/** CMA namespace for Confluence user → Cloud account ID mapping */
const USER_NAMESPACE = 'identity:user';

/** Maximum server IDs per getMappingById call */
const MAPPING_BATCH_SIZE = 100;

export async function handler(event, _context) {
  const { key, label, messageId, transferId } = event;

  // Ignore payloads not produced by this plugin
  if (label !== SIGNATURES_LABEL) {
    await migration.messageProcessed(transferId, messageId);
    return;
  }

  // 1. Download and decompress JSONL.gz
  const compressed = await (await migration.getAppDataPayload(key)).arrayBuffer();
  const jsonl = gunzipSync(Buffer.from(compressed)).toString('utf8');
  const contracts = jsonl.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));

  console.log(`[migration] Received ${contracts.length} contracts`);

  // 2. Collect all unique server usernames across all contracts
  const allUsernames = new Set();
  for (const { signatures } of contracts) {
    Object.keys(signatures).forEach(u => allUsernames.add(u));
  }

  // 3. Batch-resolve usernames → Cloud account IDs (max 100 per call)
  const usernameToAccountId = {};
  const usernames = [...allUsernames];
  for (let i = 0; i < usernames.length; i += MAPPING_BATCH_SIZE) {
    const batch = usernames.slice(i, i + MAPPING_BATCH_SIZE);
    const { result } = await migration.getMappingById(transferId, USER_NAMESPACE, batch);
    Object.assign(usernameToAccountId, result);
  }

  let contractsInserted = 0;
  let signaturesInserted = 0;
  let signaturesMissing = 0;

  // 4. Upsert each contract and its signatures
  for (const { hash, pageId, signatures } of contracts) {
    // Use earliest signature timestamp as contract createdAt
    const timestamps = Object.values(signatures).map(d => new Date(d));
    const createdAt = timestamps.length > 0
      ? new Date(Math.min(...timestamps.map(t => t.getTime())))
      : new Date();

    // INSERT IGNORE is idempotent: no-op if the contract already exists
    await sql.prepare(`
      INSERT IGNORE INTO contract (hash, pageId, createdAt)
      VALUES (?, ?, ?)
    `).bindParams(hash, String(pageId), createdAt).execute();
    contractsInserted++;

    for (const [username, signedAt] of Object.entries(signatures)) {
      const accountId = usernameToAccountId[username];
      if (!accountId) {
        console.warn(`[migration] No account ID mapping for username: ${username} (skipped)`);
        signaturesMissing++;
        continue;
      }
      // INSERT IGNORE is idempotent: no-op if the signature already exists
      await sql.prepare(`
        INSERT IGNORE INTO signature (contractHash, accountId, signedAt)
        VALUES (?, ?, ?)
      `).bindParams(hash, accountId, new Date(signedAt)).execute();
      signaturesInserted++;
    }
  }

  console.log(
    `[migration] Done: ${contractsInserted} contracts, ` +
    `${signaturesInserted} signatures inserted, ` +
    `${signaturesMissing} signatures skipped (no mapping)`
  );

  // 5. Acknowledge processing — required or the platform marks migration as failed
  await migration.messageProcessed(transferId, messageId);
}
