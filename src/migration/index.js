/**
 * CMA App Data Migration Handler (i0052)
 *
 * Triggered by `avi:ecosystem.migration:uploaded:app_data` when the
 * Confluence Cloud Migration Assistant has finished uploading a JSONL.gz
 * payload exported by the legacy Server/DC plugin
 * (DigitalSignatureMigrationListener).
 *
 * Also receives `avi:ecosystem.migration:triggered:listener` when the
 * server-side listener is activated (acknowledged but no processing needed).
 *
 * SCALABILITY: the DC exporter writes the signatures in fixed-size CHUNKS
 * (one `createAppData("signatures")` file per batch of contracts), so CMA
 * delivers one `uploaded:app_data` message PER CHUNK and this handler runs
 * once per chunk. Each invocation therefore processes a BOUNDED number of
 * contracts, well within the 25s Forge function limit, regardless of how big
 * the migrated space is. Within a chunk we keep the work cheap by:
 *   - resolving CMA id-mappings in PARALLEL batches (Promise.all), and
 *   - writing rows with BATCHED multi-row INSERTs (a few statements instead of
 *     one round-trip per row).
 * All writes are idempotent (`ON DUPLICATE KEY UPDATE`), so re-delivery /
 * re-running the whole migration is safe.
 *
 * Observability: detailed staged, elapsed-ms logs go to `forge logs` (for
 * debugging); concise per-chunk milestones + failures go to the CMA migration
 * report via `migration.addLog` (visible to the admin running the migration).
 */

import { migration } from '@forge/migrations';
import sql from '@forge/sql';
import { createHash } from 'crypto';
import { gunzipSync } from 'zlib';

/** Label written by DigitalSignatureMigrationListener#onStartAppMigration (every chunk shares it) */
const SIGNATURES_LABEL = 'signatures';

/** CMA namespace for Confluence user → Cloud account ID mapping */
const USER_NAMESPACE = 'identity:user';

/** Prefix required by CMA Mappings API for Confluence user keys */
const USER_KEY_PREFIX = 'confluence.userkey/';

/** CMA namespace for Confluence page ID mapping */
const PAGE_NAMESPACE = 'confluence:page';

/** Maximum server IDs per getMappingById call (CMA Mappings API limit) */
const MAPPING_BATCH_SIZE = 100;

/** Rows per multi-row INSERT statement (keeps us well under max_allowed_packet / param limits) */
const SQL_BATCH_ROWS = 200;

/** Split an array into fixed-size chunks. */
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

/** Best-effort progress/error line into the CMA migration report (never throws). */
async function reportLog(transferId, message) {
  try {
    await migration.addLog(transferId, message);
  } catch (e) {
    console.warn(`[migration] addLog failed: ${e.message}`);
  }
}

/**
 * Resolve a set of server ids to cloud ids via the CMA Mappings API, in
 * PARALLEL batches of MAPPING_BATCH_SIZE. Returns { map, calls }.
 * `encode`/`decode` adapt the id form the API expects/returns (used for the
 * `confluence.userkey/<key>` prefix on the user namespace).
 */
async function resolveMappings(transferId, namespace, ids, encode = (x) => x, decode = (x) => x) {
  const batches = chunkArray(ids, MAPPING_BATCH_SIZE);
  const responses = await Promise.all(
    batches.map((batch) => migration.getMappingById(transferId, namespace, batch.map(encode))),
  );
  const map = {};
  for (const resp of responses) {
    const result = resp?.result || resp || {};
    for (const [k, v] of Object.entries(result)) map[decode(k)] = v;
  }
  return { map, calls: batches.length };
}

/**
 * Idempotent multi-row upsert. Splits `rows` into SQL_BATCH_ROWS-sized
 * statements so ~1000 rows become a handful of round-trips. Values are bound
 * (parameterised) — no manual escaping. Returns the number of statements run.
 */
async function batchUpsert(table, columns, updateClause, rows, toParams) {
  const tuple = `(${columns.map(() => '?').join(', ')})`;
  let statements = 0;
  for (const slice of chunkArray(rows, SQL_BATCH_ROWS)) {
    const placeholders = slice.map(() => tuple).join(', ');
    const params = [];
    for (const r of slice) params.push(...toParams(r));
    await sql
      .prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders} ` +
        `ON DUPLICATE KEY UPDATE ${updateClause}`,
      )
      .bindParams(...params)
      .execute();
    statements++;
  }
  return statements;
}

export async function handler(event, _context) {
  // Staged, elapsed-ms structured logs so a timeout (should no longer happen
  // with chunking) or any anomaly shows the exact stage + real sizes/timings.
  const t0 = Date.now();
  const ms = () => Date.now() - t0;
  const { eventType, key, label, messageId, transferId } = event;
  // `key` uniquely identifies this chunk's payload — include it in every line
  // so concurrent/sequential chunk invocations are distinguishable in forge logs.
  const tag = `transferId=${transferId} key=${key}`;

  console.log(`[migration] event=${eventType} ${tag} label=${label}`);

  // Only process app-data-uploaded events; acknowledge others.
  if (eventType !== 'avi:ecosystem.migration:uploaded:app_data') {
    console.log(`[migration] acknowledged non-data event: ${eventType}`);
    return;
  }

  // Ignore payloads not produced by this plugin.
  if (label !== SIGNATURES_LABEL) {
    console.log(`[migration] ignoring payload label=${label} (not '${SIGNATURES_LABEL}')`);
    await migration.messageProcessed(transferId, messageId);
    return;
  }

  try {
    // 1. Download + decompress this chunk's JSONL.gz.
    const compressed = await (await migration.getAppDataPayload(key)).arrayBuffer();
    const payloadBytes = compressed.byteLength;
    const jsonl = gunzipSync(Buffer.from(compressed)).toString('utf8');
    const contracts = jsonl.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    console.log(`[migration] ${tag} parsed contracts=${contracts.length} payloadBytes=${payloadBytes} +${ms()}ms`);

    // 2. Collect unique server userKeys across this chunk's contracts.
    const allUsernames = new Set();
    for (const { signatures } of contracts) {
      Object.keys(signatures || {}).forEach((u) => allUsernames.add(u));
    }
    const usernames = [...allUsernames];
    const serverPageIds = [...new Set(contracts.map((c) => String(c.pageId)))];
    console.log(`[migration] ${tag} uniqueUserKeys=${usernames.length} uniquePageIds=${serverPageIds.length} +${ms()}ms`);

    // 3. Resolve userKeys → Cloud accountIds and pageIds → Cloud pageIds, in
    //    parallel. The Server export uses Confluence userKeys; the CMA Mappings
    //    API requires the "confluence.userkey/<userKey>" form for users.
    const [users, pages] = await Promise.all([
      resolveMappings(
        transferId, USER_NAMESPACE, usernames,
        (u) => `${USER_KEY_PREFIX}${u}`,
        (k) => k.replace(USER_KEY_PREFIX, ''),
      ),
      resolveMappings(transferId, PAGE_NAMESPACE, serverPageIds),
    ]);
    const usernameToAccountId = users.map;
    const pageIdMap = pages.map;
    console.log(
      `[migration] ${tag} users resolved=${Object.keys(usernameToAccountId).length}/${usernames.length} calls=${users.calls} | ` +
      `pages resolved=${Object.keys(pageIdMap).length}/${serverPageIds.length} calls=${pages.calls} +${ms()}ms`,
    );

    // 4. Build contract + signature rows (skip contracts whose page didn't map,
    //    and signatures whose signer didn't map). Recompute the hash with the
    //    Cloud pageId so it matches the client-side formula.
    const contractRows = [];
    const signatureRows = [];
    let pagesUnmapped = 0;
    let signaturesMissing = 0;
    const missingPageSample = [];
    const missingUserSample = [];

    for (const { pageId: serverPageId, title, body, signatures } of contracts) {
      const cloudPageId = pageIdMap[String(serverPageId)];
      if (!cloudPageId) {
        pagesUnmapped++;
        if (missingPageSample.length < 10) missingPageSample.push(String(serverPageId));
        continue;
      }
      const cloudHash = computeHash(cloudPageId, title || '', body || '');
      // Earliest signature timestamp as contract createdAt.
      const timestamps = Object.values(signatures || {}).map(parseDate);
      const createdAt = timestamps.length > 0
        ? new Date(Math.min(...timestamps.map((t) => t.getTime())))
        : new Date();
      contractRows.push({ hash: cloudHash, pageId: cloudPageId, createdAt });

      for (const [userKey, signedAt] of Object.entries(signatures || {})) {
        const accountId = usernameToAccountId[userKey];
        if (!accountId) {
          signaturesMissing++;
          if (missingUserSample.length < 10) missingUserSample.push(userKey);
          continue;
        }
        signatureRows.push({ contractHash: cloudHash, accountId, signedAt: parseDate(signedAt) });
      }
    }
    console.log(
      `[migration] ${tag} prepared contractRows=${contractRows.length} signatureRows=${signatureRows.length} ` +
      `skippedNoPage=${pagesUnmapped} skippedNoUser=${signaturesMissing} +${ms()}ms`,
    );
    if (missingPageSample.length) console.log(`[migration] ${tag} sample unmapped pageIds: ${missingPageSample.join(',')}`);
    if (missingUserSample.length) console.log(`[migration] ${tag} sample unmapped userKeys: ${missingUserSample.join(',')}`);

    // 5. Batched, idempotent upserts.
    const contractStmts = await batchUpsert(
      'contract', ['hash', 'pageId', 'createdAt'],
      'pageId = VALUES(pageId), createdAt = VALUES(createdAt)',
      contractRows, (r) => [r.hash, r.pageId, r.createdAt],
    );
    const signatureStmts = await batchUpsert(
      'signature', ['contractHash', 'accountId', 'signedAt'],
      'signedAt = VALUES(signedAt)',
      signatureRows, (r) => [r.contractHash, r.accountId, r.signedAt],
    );

    console.log(
      `[migration] ${tag} DONE contracts=${contractRows.length}(${contractStmts} stmts) ` +
      `signatures=${signatureRows.length}(${signatureStmts} stmts) ` +
      `skippedNoPage=${pagesUnmapped} skippedNoUser=${signaturesMissing} totalContracts=${contracts.length} +${ms()}ms`,
    );

    // Concise milestone into the CMA migration report (admin-visible).
    await reportLog(
      transferId,
      `[digital-signature] imported chunk: contracts=${contractRows.length} signatures=${signatureRows.length} ` +
      `(skipped: pages=${pagesUnmapped}, users=${signaturesMissing}) in ${ms()}ms`,
    );

    // Acknowledge — required, or CMA re-delivers this chunk.
    await migration.messageProcessed(transferId, messageId);
  } catch (err) {
    // Log full detail to forge logs; surface a concise failure to the admin.
    console.error(`[migration] ${tag} FAILED +${ms()}ms: ${err && err.stack ? err.stack : err}`);
    await reportLog(transferId, `[digital-signature] chunk FAILED after ${ms()}ms: ${err && err.message ? err.message : err}`);
    // Re-throw WITHOUT acking so CMA re-delivers this (small, bounded) chunk —
    // safer than messageFailed, which would give up on a possibly-transient error.
    // Idempotent upserts make the retry safe. Chunking keeps failure isolated to
    // this chunk; other chunks are independent messages.
    throw err;
  }
}
