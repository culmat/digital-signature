/**
 * CMA App Data Migration Handler (i0052)
 *
 * Triggered by `avi:ecosystem.migration:uploaded:app_data` when the
 * Confluence Cloud Migration Assistant has finished uploading the JSONL.gz
 * payload exported by the legacy Server/DC plugin
 * (DigitalSignatureMigrationListener).
 *
 * Also receives `avi:ecosystem.migration:triggered:listener` when the
 * server-side listener is activated (acknowledged but no processing needed).
 *
 * Reads each contract line, resolves Server pageIds → Cloud pageIds and
 * Server userKeys → Cloud account IDs via the CMA Mappings API, recomputes
 * the contract hash with the Cloud pageId, and inserts rows into the
 * `contract` and `signature` SQL tables (idempotent — safe to re-run).
 */

import { migration } from '@forge/migrations';
import sql from '@forge/sql';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';

/** Label written by DigitalSignatureMigrationListener#onStartAppMigration */
const SIGNATURES_LABEL = 'signatures';

/** CMA namespace for Confluence user → Cloud account ID mapping */
const USER_NAMESPACE = 'identity:user';

/** Prefix required by CMA Mappings API for Confluence user keys */
const USER_KEY_PREFIX = 'confluence.userkey/';

/** CMA namespace for Confluence page ID mapping */
const PAGE_NAMESPACE = 'confluence:page';

/** Maximum server IDs per getMappingById call */
const MAPPING_BATCH_SIZE = 100;

/** Parse date from Server export — supports epoch millis (number) or ISO string */
function parseDate(val) {
  if (!val && val !== 0) return new Date();
  const d = typeof val === 'number' ? new Date(val) : new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
}

/** Recompute contract hash with Cloud pageId (must match client-side formula) */
function computeHash(pageId, title, content) {
  return createHash('sha256').update(`${pageId}:${title}:${content}`).digest('hex');
}

export async function handler(event, _context) {
  // Instrumentation (i0052): staged, elapsed-ms structured logs so a 25s Forge
  // timeout shows the exact stage reached and the real sizes/timings — we fix
  // from evidence, not inference. Per-row skip warns are aggregated to counts +
  // small samples (thousands of individual warns both spammed and skewed timing).
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const { eventType, key, label, messageId, transferId } = event;

  console.log(`[migration] event=${eventType} transferId=${transferId} label=${label} key=${key}`);

  // Only process app-data-uploaded events; acknowledge others
  if (eventType !== 'avi:ecosystem.migration:uploaded:app_data') {
    console.log(`[migration] acknowledged non-data event: ${eventType}`);
    return;
  }

  // Ignore payloads not produced by this plugin
  if (label !== SIGNATURES_LABEL) {
    console.log(`[migration] ignoring payload label=${label} (not '${SIGNATURES_LABEL}')`);
    await migration.messageProcessed(transferId, messageId);
    return;
  }

  // 1. Download and decompress JSONL.gz
  const compressed = await (await migration.getAppDataPayload(key)).arrayBuffer();
  const payloadBytes = compressed.byteLength;
  const jsonl = gunzipSync(Buffer.from(compressed)).toString('utf8');
  const contracts = jsonl.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
  console.log(`[migration] parsed contracts=${contracts.length} payloadBytes=${payloadBytes} +${ms()}ms`);

  // 2. Collect all unique server userKeys across all contracts
  const allUsernames = new Set();
  for (const { signatures } of contracts) {
    Object.keys(signatures || {}).forEach(u => allUsernames.add(u));
  }
  const usernames = [...allUsernames];
  console.log(`[migration] uniqueUserKeys=${usernames.length} +${ms()}ms`);

  // 3. Batch-resolve userKeys → Cloud account IDs (max 100 per call)
  //    The Server export uses Confluence userKeys as signature map keys.
  //    CMA Mappings API requires: "confluence.userkey/<userKey>" format.
  const usernameToAccountId = {};
  let userCalls = 0;
  for (let i = 0; i < usernames.length; i += MAPPING_BATCH_SIZE) {
    const batch = usernames.slice(i, i + MAPPING_BATCH_SIZE);
    const prefixedBatch = batch.map(u => `${USER_KEY_PREFIX}${u}`);
    const mappingResponse = await migration.getMappingById(transferId, USER_NAMESPACE, prefixedBatch);
    const result = mappingResponse?.result || mappingResponse || {};
    for (const [prefixedKey, accountId] of Object.entries(result)) {
      usernameToAccountId[prefixedKey.replace(USER_KEY_PREFIX, '')] = accountId;
    }
    userCalls++;
  }
  console.log(`[migration] users resolved=${Object.keys(usernameToAccountId).length}/${usernames.length} calls=${userCalls} +${ms()}ms`);

  // 4. Resolve Server pageIds → Cloud pageIds
  const serverPageIds = [...new Set(contracts.map(c => String(c.pageId)))];
  const pageIdMap = {};
  let pageCalls = 0;
  for (let i = 0; i < serverPageIds.length; i += MAPPING_BATCH_SIZE) {
    const batch = serverPageIds.slice(i, i + MAPPING_BATCH_SIZE);
    const pageResponse = await migration.getMappingById(transferId, PAGE_NAMESPACE, batch);
    const pageResult = pageResponse?.result || pageResponse || {};
    Object.assign(pageIdMap, pageResult);
    pageCalls++;
  }
  console.log(`[migration] pages resolved=${Object.keys(pageIdMap).length}/${serverPageIds.length} calls=${pageCalls} +${ms()}ms`);

  let contractsInserted = 0;
  let signaturesInserted = 0;
  let signaturesMissing = 0;
  let pagesUnmapped = 0;
  let processed = 0;
  const missingPageSample = [];
  const missingUserSample = [];
  const LOG_EVERY = 250;

  // 5. Upsert each contract and its signatures
  for (const { pageId: serverPageId, title, body, signatures } of contracts) {
    processed++;
    const cloudPageId = pageIdMap[String(serverPageId)];
    if (!cloudPageId) {
      pagesUnmapped++;
      if (missingPageSample.length < 10) missingPageSample.push(String(serverPageId));
      continue;
    }

    // Recompute hash with Cloud pageId (must match client-side formula)
    const cloudHash = computeHash(cloudPageId, title || '', body || '');

    // Use earliest signature timestamp as contract createdAt
    const timestamps = Object.values(signatures || {}).map(d => parseDate(d));
    const createdAt = timestamps.length > 0
      ? new Date(Math.min(...timestamps.map(t => t.getTime())))
      : new Date();

    // Upsert: update pageId/createdAt if contract already exists (e.g. re-run)
    await sql.prepare(`
      INSERT INTO contract (hash, pageId, createdAt)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE pageId = VALUES(pageId), createdAt = VALUES(createdAt)
    `).bindParams(cloudHash, cloudPageId, createdAt).execute();
    contractsInserted++;

    for (const [userKey, signedAt] of Object.entries(signatures || {})) {
      const accountId = usernameToAccountId[userKey];
      if (!accountId) {
        signaturesMissing++;
        if (missingUserSample.length < 10) missingUserSample.push(userKey);
        continue;
      }
      // Upsert: update signedAt if signature already exists (e.g. date format fix)
      await sql.prepare(`
        INSERT INTO signature (contractHash, accountId, signedAt)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE signedAt = VALUES(signedAt)
      `).bindParams(cloudHash, accountId, parseDate(signedAt)).execute();
      signaturesInserted++;
    }

    if (processed % LOG_EVERY === 0) {
      console.log(`[migration] progress processed=${processed}/${contracts.length} contractsInserted=${contractsInserted} signaturesInserted=${signaturesInserted} +${ms()}ms`);
    }
  }

  console.log(
    `[migration] Done: contracts=${contractsInserted} signaturesInserted=${signaturesInserted} ` +
    `signaturesSkippedNoUser=${signaturesMissing} contractsSkippedNoPage=${pagesUnmapped} ` +
    `totalContracts=${contracts.length} +${ms()}ms`
  );
  if (missingPageSample.length) console.log(`[migration] sample unmapped pageIds: ${missingPageSample.join(',')}`);
  if (missingUserSample.length) console.log(`[migration] sample unmapped userKeys: ${missingUserSample.join(',')}`);

  // Acknowledge processing — required or the platform marks migration as failed
  await migration.messageProcessed(transferId, messageId);
}
