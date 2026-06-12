import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gunzipSync } from 'zlib';

// Capture every query string handed to sql.prepare so we can assert on the
// generated SQL (e.g. that LIMIT/OFFSET are inlined, not bound).
const preparedQueries = [];
const mockExecute = vi.fn();

const mockPrepare = vi.fn((query) => {
  preparedQueries.push(query);
  const stmt = {
    // Forge SQL rejects bound params in LIMIT; the export must NOT call this.
    bindParams: vi.fn(() => stmt),
    execute: () => mockExecute(query),
  };
  return stmt;
});

vi.mock('@forge/sql', () => ({
  default: {
    prepare: mockPrepare,
    executeRaw: vi.fn(),
  },
}));

const { exportData } = await import('../../src/storage/backupManager.js');

// Route a prepared query to the right canned result based on its SQL text.
function routeQuery(query) {
  if (/COUNT\(\*\)[\s\S]*FROM contract/i.test(query)) {
    return { rows: [{ total: 0, active: null, deleted: null }] };
  }
  if (/COUNT\(\*\)[\s\S]*FROM signature/i.test(query)) {
    return { rows: [{ total: 0 }] };
  }
  // Paginated SELECTs (export) — empty dataset.
  return { rows: [] };
}

describe('backupManager.exportData', () => {
  beforeEach(() => {
    preparedQueries.length = 0;
    vi.clearAllMocks();
    mockExecute.mockImplementation(routeQuery);
  });

  it('completes on an empty dataset and returns a valid gzip payload', async () => {
    const result = await exportData(0, 5000);

    expect(result.completed).toBe(true);
    expect(result.offset).toBeUndefined();
    expect(result.stats.totalContracts).toBe(0);
    expect(result.stats.totalSignatures).toBe(0);

    // data must be valid base64-encoded gzip that decompresses to the SQL dump
    const sqlDump = gunzipSync(Buffer.from(result.data, 'base64')).toString('utf-8');
    expect(sqlDump).toContain('SET FOREIGN_KEY_CHECKS = 0;');
    expect(sqlDump).toContain('SET FOREIGN_KEY_CHECKS = 1;');
  });

  it('inlines sanitized LIMIT/OFFSET instead of binding them (Forge SQL regression)', async () => {
    await exportData(0, 5000);

    const selects = preparedQueries.filter((q) => /LIMIT/i.test(q) && !/COUNT\(\*\)/i.test(q));
    expect(selects.length).toBe(2);
    for (const q of selects) {
      expect(q).not.toContain('LIMIT ?');
      expect(q).toContain('LIMIT 5000 OFFSET 0');
    }
  });

  it('sanitizes out-of-range pagination params before inlining', async () => {
    // limit clamps to MAX_CHUNK_SIZE (10000); negative offset clamps to 0
    await exportData(-5, 999999);

    const selects = preparedQueries.filter((q) => /LIMIT/i.test(q) && !/COUNT\(\*\)/i.test(q));
    for (const q of selects) {
      expect(q).toContain('LIMIT 10000 OFFSET 0');
    }
  });
});
