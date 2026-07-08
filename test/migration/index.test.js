import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// ── mocks ──────────────────────────────────────────────────────────────────
const mockGetAppDataPayload = vi.fn();
const mockGetMappingById = vi.fn();
const mockMessageProcessed = vi.fn(async () => {});
const mockMessageFailed = vi.fn(async () => {});
const mockAddLog = vi.fn(async () => {});

vi.mock('@forge/migrations', () => ({
  migration: {
    getAppDataPayload: (...a) => mockGetAppDataPayload(...a),
    getMappingById: (...a) => mockGetMappingById(...a),
    messageProcessed: (...a) => mockMessageProcessed(...a),
    messageFailed: (...a) => mockMessageFailed(...a),
    addLog: (...a) => mockAddLog(...a),
  },
}));

// Capture every executed statement + its bound params.
const sqlStatements = [];
vi.mock('@forge/sql', () => ({
  default: {
    prepare: (query) => {
      const stmt = {
        query,
        params: [],
        bindParams(...args) { this.params = args; return this; },
        async execute() { sqlStatements.push({ query: this.query, params: this.params }); return { rows: [] }; },
      };
      return stmt;
    },
  },
}));

const { handler } = await import('../../src/migration/index.js');

// ── helpers ─────────────────────────────────────────────────────────────────
const EVENT = (over = {}) => ({
  eventType: 'avi:ecosystem.migration:uploaded:app_data',
  key: 'chunk-key-1',
  label: 'signatures',
  messageId: 'msg-1',
  transferId: 'transfer-1',
  ...over,
});

/** Build a gzipped-JSONL app-data payload object (mimics migration.getAppDataPayload). */
function payload(contracts) {
  const jsonl = contracts.map((c) => JSON.stringify(c)).join('\n') + '\n';
  const gz = gzipSync(Buffer.from(jsonl, 'utf8'));
  const ab = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
  return { arrayBuffer: async () => ab };
}

/** Mapping mock: users under identity:user (prefixed), pages under confluence:page. */
function mappings({ users = {}, pages = {} }) {
  mockGetMappingById.mockImplementation(async (_transferId, namespace, ids) => {
    const result = {};
    for (const id of ids) {
      if (namespace === 'identity:user') {
        const uk = id.replace('confluence.userkey/', '');
        if (users[uk]) result[id] = users[uk];
      } else if (namespace === 'confluence:page') {
        if (pages[id]) result[id] = pages[id];
      }
    }
    return { result };
  });
}

const contractInserts = () => sqlStatements.filter((s) => /INSERT INTO contract\b/.test(s.query));
const signatureInserts = () => sqlStatements.filter((s) => /INSERT INTO signature\b/.test(s.query));
const tupleCount = (q) => (q.match(/\(\?, \?, \?\)/g) || []).length;

describe('migration handler (chunked, batched import)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlStatements.length = 0;
  });

  it('imports a chunk with batched multi-row upserts and acks', async () => {
    mockGetAppDataPayload.mockResolvedValueOnce(payload([
      { pageId: 10, title: 'A', body: 'a', signatures: { alice: 1700000000000, bob: 1700000001000 } },
      { pageId: 11, title: 'B', body: 'b', signatures: { alice: 1700000002000 } },
    ]));
    mappings({
      users: { alice: 'acc-alice', bob: 'acc-bob' },
      pages: { 10: '5010', 11: '5011' },
    });

    await handler(EVENT());

    // one contract INSERT with two value tuples (batched), not two statements
    expect(contractInserts()).toHaveLength(1);
    expect(tupleCount(contractInserts()[0].query)).toBe(2);
    expect(contractInserts()[0].params).toHaveLength(6);
    expect(contractInserts()[0].query).toMatch(/ON DUPLICATE KEY UPDATE/);

    // three signature rows across mapped users, one batched statement
    expect(signatureInserts()).toHaveLength(1);
    expect(tupleCount(signatureInserts()[0].query)).toBe(3);

    // hash is recomputed with the CLOUD pageId
    const expected = createHash('sha256').update('5010:A:a').digest('hex');
    expect(contractInserts()[0].params).toContain(expected);

    expect(mockMessageProcessed).toHaveBeenCalledWith('transfer-1', 'msg-1');
    expect(mockAddLog).toHaveBeenCalledWith('transfer-1', expect.stringContaining('imported chunk'));
  });

  it('resolves mappings in parallel batches (>100 ids → multiple getMappingById calls)', async () => {
    const contracts = Array.from({ length: 150 }, (_, i) => ({
      pageId: i, title: `T${i}`, body: 'x', signatures: {},
    }));
    mockGetAppDataPayload.mockResolvedValueOnce(payload(contracts));
    mappings({ pages: Object.fromEntries(contracts.map((c) => [String(c.pageId), `cloud-${c.pageId}`])) });

    await handler(EVENT());

    // 150 page ids / 100 per call = 2 page-mapping calls (issued via Promise.all)
    const pageCalls = mockGetMappingById.mock.calls.filter((c) => c[1] === 'confluence:page');
    expect(pageCalls).toHaveLength(2);
  });

  it('splits large row sets into multiple INSERT statements (SQL_BATCH_ROWS)', async () => {
    const contracts = Array.from({ length: 201 }, (_, i) => ({
      pageId: i, title: `T${i}`, body: 'x', signatures: {},
    }));
    mockGetAppDataPayload.mockResolvedValueOnce(payload(contracts));
    mappings({ pages: Object.fromEntries(contracts.map((c) => [String(c.pageId), `cloud-${c.pageId}`])) });

    await handler(EVENT());

    // 201 rows / 200 per statement = 2 statements
    expect(contractInserts()).toHaveLength(2);
    expect(mockMessageProcessed).toHaveBeenCalledOnce();
  });

  it('skips contracts whose page did not map and signatures whose user did not map', async () => {
    mockGetAppDataPayload.mockResolvedValueOnce(payload([
      { pageId: 10, title: 'A', body: 'a', signatures: { alice: 1, ghost: 2 } }, // ghost user unmapped
      { pageId: 99, title: 'Z', body: 'z', signatures: { alice: 3 } },            // page 99 unmapped
    ]));
    mappings({ users: { alice: 'acc-alice' }, pages: { 10: '5010' } });

    await handler(EVENT());

    // only page 10 becomes a contract
    expect(tupleCount(contractInserts()[0].query)).toBe(1);
    // only alice's signature on page 10 (ghost skipped, page-99 signature skipped)
    expect(tupleCount(signatureInserts()[0].query)).toBe(1);
    expect(mockMessageProcessed).toHaveBeenCalledOnce();
  });

  it('acks and does nothing for a non-signatures label', async () => {
    await handler(EVENT({ label: 'something-else' }));
    expect(sqlStatements).toHaveLength(0);
    expect(mockMessageProcessed).toHaveBeenCalledWith('transfer-1', 'msg-1');
    expect(mockGetAppDataPayload).not.toHaveBeenCalled();
  });

  it('returns without acking for a non-data event', async () => {
    await handler(EVENT({ eventType: 'avi:ecosystem.migration:triggered:listener' }));
    expect(mockMessageProcessed).not.toHaveBeenCalled();
    expect(sqlStatements).toHaveLength(0);
  });

  it('on failure: logs to the CMA report, does NOT ack, and re-throws (CMA retries)', async () => {
    mockGetAppDataPayload.mockRejectedValueOnce(new Error('payload download failed'));

    await expect(handler(EVENT())).rejects.toThrow('payload download failed');

    expect(mockMessageProcessed).not.toHaveBeenCalled();
    expect(mockMessageFailed).not.toHaveBeenCalled();
    expect(mockAddLog).toHaveBeenCalledWith('transfer-1', expect.stringContaining('FAILED'));
  });
});
