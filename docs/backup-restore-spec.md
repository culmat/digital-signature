# Backup & Restore Specification

## Overview

This document defines the admin backup and restore functionality for the Digital Signature Confluence macro. This feature enables Confluence administrators to export all signature data from their instance and restore it later, supporting disaster recovery and migration scenarios.

### Scope

- **In Scope**: Admin-level backup and restore of all signature entities for a Confluence instance
- **Out of Scope**:
  - End-user export of individual signatures (covered separately in TODO.txt)
  - Legacy macro migration (will be covered in a separate specification)

### Use Cases

1. **Disaster Recovery**: Regular backups to restore data after incidents
2. **Migration Foundation**: Export data from one instance for import to another
3. **Pre-upgrade Safety**: Backup before major app or Confluence upgrades

---

## Data Format

### Format: JSONL + Gzip Compression

**File extension**: `.jsonl.gz`

**Why this format?**
- **JSONL** (JSON Lines): One JSON object per line, enables line-by-line processing
- **Gzip**: Industry-standard compression using Node.js built-in `zlib` module (stable since Node v0.6)
- **Fault tolerance**: Corrupted lines don't invalidate entire file
- **Chunking-friendly**: File can be split/merged at line boundaries
- **Long-term storage**: Mature, widely-supported format with excellent tooling ecosystem

**Transport Encoding**:
- Forge resolvers cannot return binary data directly
- Gzipped data is **base64-encoded** for transport through resolver
- Each chunk is independently valid: gzipped → base64-encoded
- Client concatenates chunks and decodes: base64 → gunzip → JSONL
- Chunk size: ~1000 entities per chunk (tunable based on data size)

### File Structure

```
<metadata-line>\n
<entity-line-1>\n
<entity-line-2>\n
...
<entity-line-N>\n
```

**First line (metadata)**:
```json
{
  "version": "1.0.0",
  "exportedAt": 1732268400,
  "exportedBy": "557058:f8e7f66f-7f19-4e5c-b8ae-123456789abc",
  "appVersion": "1.1.23",
  "siteUrl": "https://your-site.atlassian.net",
  "entityCount": 5234
}
```

**Subsequent lines (signature entities)**:
```json
{"hash":"a1b2c3...","pageId":"123456","signatures":[{"accountId":"557058:...", "signedAt":1700000000}],"createdAt":1700000000,"lastModified":1700000100,"deletedAt":0}
{"hash":"d4e5f6...","pageId":"123457","signatures":[{"accountId":"557058:...", "signedAt":1700000200}],"createdAt":1700000200,"lastModified":1700000200,"deletedAt":1700005000}
...
```

### Entity Schema

Each entity line matches the signature entity structure from `manifest.yml`:

```javascript
{
  hash: string,              // SHA-256 of pageId:title:body (entity key)
  pageId: string,            // Confluence page ID
  signatures: Array<{
    accountId: string,       // Atlassian account ID
    signedAt: number         // Unix timestamp (seconds)
  }>,
  createdAt: number,         // Unix timestamp (seconds) - first signature
  lastModified: number,      // Unix timestamp (seconds) - last signature
  deletedAt: number          // Unix timestamp (seconds) - 0 if not deleted
}
```

---

## REST API Endpoints

### GET /admin/data

**Purpose**: Export (backup) all signature data from the Confluence instance with automatic chunking to avoid timeouts

**Authorization**: Confluence administrators only

**Request**:
- Method: `GET`
- Path: `/admin/data`
- Query Parameters:
  - `cursor` (optional): Resume token from previous chunk (for multi-chunk exports)
  - `limit` (optional): Entities per chunk (default: 1000, max: 2000)

**Response (Chunk Completed)**:
```json
{
  "completed": false,
  "data": "<base64-encoded gzipped JSONL chunk>",
  "cursor": "next-batch-cursor-abc123",
  "stats": {
    "totalEntities": 5234,
    "processedEntities": 1000,
    "estimatedChunks": 6,
    "elapsedSeconds": 18
  }
}
```

**Response (Export Completed)**:
```json
{
  "completed": true,
  "data": "<base64-encoded gzipped JSONL final chunk>",
  "stats": {
    "totalEntities": 5234,
    "processedEntities": 5234,
    "totalChunks": 6
  }
}
```

**Error Responses**:
- `403 Forbidden`: User is not a Confluence administrator
- `500 Internal Server Error`: Export processing failed

**Resumable Export Behavior**:
- Monitors execution time continuously
- Returns partial result when approaching 20-second timeout (5s safety buffer)
- Client automatically requests next chunk using returned `cursor`
- Each chunk contains metadata line (first chunk only) + entity lines
- Chunks are independently valid gzip files encoded as base64

**Implementation Strategy**:
1. Query entities from KVS in batches of 100 (pagination cursor)
2. Build JSONL output with metadata line (first chunk only)
3. Compress to gzip, encode as base64
4. Monitor time: if >20s elapsed, return partial chunk with cursor
5. Include ALL entities (including `deletedAt > 0`)

---

### PUT /admin/data

**Purpose**: Import (restore) signature data with session-based resumable chunks to avoid timeouts

**Authorization**: Confluence administrators only

**Request (First Chunk)**:
- Method: `PUT`
- Path: `/admin/data`
- Headers:
  - `Content-Type: application/json`
  - `X-Import-Session`: Client-generated UUID (e.g., `import-550e8400-e29b-41d4-a716-446655440000`)
  - `X-Chunk-Number`: 1
- Body:
```json
{
  "data": "<base64-encoded gzipped JSONL chunk>"
}
```

**Request (Subsequent Chunks)**:
- Same as above, with `X-Chunk-Number` incremented (2, 3, etc.)
- Use same `X-Import-Session` UUID for all chunks

**Response (Chunk Processed, More Expected)**:
```json
{
  "completed": false,
  "sessionId": "import-550e8400-e29b-41d4-a716-446655440000",
  "processed": 1000,
  "nextChunkExpected": 2,
  "stats": {
    "entitiesCreated": 120,
    "entitiesMerged": 880,
    "signaturesAdded": 95,
    "errors": 2,
    "warnings": 1
  }
}
```

**Response (Import Completed)**:
```json
{
  "completed": true,
  "sessionId": "import-550e8400-e29b-41d4-a716-446655440000",
  "summary": {
    "totalProcessed": 5234,
    "entitiesCreated": 520,
    "entitiesMerged": 4700,
    "signaturesAdded": 1450,
    "signaturesMerged": 11340,
    "errors": 14,
    "warnings": 3
  },
  "errors": [
    {
      "line": 42,
      "chunk": 1,
      "error": "Invalid entity: missing required field 'hash'"
    }
  ],
  "warnings": [
    {
      "line": 100,
      "chunk": 2,
      "warning": "Entity hash mismatch with existing data, merged anyway"
    }
  ]
}
```

**Error Responses**:
- `403 Forbidden`: User is not a Confluence administrator
- `400 Bad Request`: Invalid file format, corrupted data, or wrong chunk sequence
- `409 Conflict`: Session ID mismatch or chunk number out of sequence
- `500 Internal Server Error`: Import processing failed

**Session Management**:
- Client splits large backup files into chunks (UI can use multi-part upload)
- Each chunk processed independently within timeout limits
- Session state stored in KVS (temporary, cleared after completion)
- Chunks must be uploaded sequentially (validated via `X-Chunk-Number`)
- Session expires after 1 hour of inactivity

**Implementation Strategy**:
1. Decode base64 → decompress gzip → parse JSONL line-by-line
2. Validate metadata line (first chunk only)
3. Process each entity with merge logic (see Merge Strategy)
4. Update session state in KVS with progress
5. Continue on non-fatal errors, collect error details
6. Return summary when all chunks processed or chunk completes

---

## Merge Strategy

When restoring data with `PUT /admin/data`, the import process **merges** signatures rather than replacing existing data. This preserves signatures created after the backup was taken.

### Algorithm

For each entity in the backup file:

```javascript
async function importEntity(backupEntity) {
  const existing = await getSignature(backupEntity.hash);

  if (!existing) {
    // New entity: insert as-is
    await kvs.entity('signature').set(backupEntity.hash, backupEntity);
    stats.entitiesCreated++;
    stats.signaturesAdded += backupEntity.signatures.length;
    return;
  }

  // Existing entity: merge signatures
  const mergedSignatures = mergeSignatures(
    existing.signatures,
    backupEntity.signatures
  );

  const merged = {
    ...existing,
    hash: backupEntity.hash,
    pageId: backupEntity.pageId,
    signatures: mergedSignatures,
    createdAt: Math.min(existing.createdAt, backupEntity.createdAt),
    lastModified: Math.max(existing.lastModified, backupEntity.lastModified),
    deletedAt: backupEntity.deletedAt || existing.deletedAt // Preserve deletion status
  };

  await kvs.entity('signature').set(backupEntity.hash, merged);
  stats.entitiesMerged++;
  stats.signaturesAdded += (mergedSignatures.length - existing.signatures.length);
}

function mergeSignatures(existingSignatures, backupSignatures) {
  // Create map of accountId -> signature
  const signatureMap = new Map();

  // Add all existing signatures
  for (const sig of existingSignatures) {
    signatureMap.set(sig.accountId, sig);
  }

  // Merge backup signatures (keep oldest signedAt for duplicates)
  for (const sig of backupSignatures) {
    const existing = signatureMap.get(sig.accountId);
    if (!existing || sig.signedAt < existing.signedAt) {
      signatureMap.set(sig.accountId, sig);
    }
  }

  // Return merged array sorted by signedAt
  return Array.from(signatureMap.values())
    .sort((a, b) => a.signedAt - b.signedAt);
}
```

### Merge Rules

1. **Union of signatures**: Combine all unique accountIds from both existing and backup data
2. **Oldest timestamp wins**: If a user appears in both datasets, keep the signature with the earlier `signedAt` timestamp
3. **Preserve earliest creation**: Use the oldest `createdAt` value
4. **Update last modified**: Use the most recent `lastModified` value
5. **Preserve deletion status**: If backup entity has `deletedAt > 0`, preserve it
6. **Deterministic**: No user intervention or preview needed - rules handle all cases

### Why This Approach?

- **Non-destructive**: Never loses data from current instance
- **Idempotent**: Running same import multiple times produces same result
- **Migration-friendly**: Can merge data from multiple sources
- **Disaster recovery**: Restoring old backup preserves newer signatures

---

## Authorization

All backup/restore endpoints require **Confluence Administrator** privileges.

### Admin Check Implementation

```javascript
import api, { route } from '@forge/api';

async function isConfluenceAdmin(accountId) {
  try {
    // Check if user is member of 'confluence-administrators' group
    const response = await api
      .asApp()
      .requestConfluence(
        route`/wiki/rest/api/user/memberof?accountId=${accountId}`,
        {
          headers: { 'Accept': 'application/json' }
        }
      );

    if (!response.ok) {
      console.error('Failed to check admin status:', response.status);
      return false;
    }

    const data = await response.json();
    const isAdmin = data.results.some(
      group => group.name === 'confluence-administrators'
    );

    return isAdmin;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false; // Fail closed
  }
}
```

### Required Permissions

Update `manifest.yml` to include:
```yaml
permissions:
  scopes:
    - read:confluence-user
    - read:confluence-content.all
    - storage:app
```

Note: No additional scopes needed - `read:confluence-user` allows checking group membership.

### Security Considerations

- **Server-side only**: Authorization must happen in resolver, not frontend
- **Fail closed**: On API errors, deny access (return 403)
- **No bypass**: Every request to GET/PUT /admin/data must check authorization
- **Audit logging**: Log all backup/restore operations with accountId and timestamp

---

## Admin UI

### Confluence Global Settings Module

Add to `manifest.yml`:

```yaml
modules:
  confluence:globalSettings:
    - key: digital-signature-admin-settings
      title: Digital Signature Admin
      resource: digital-signature-admin-ui

resources:
  - key: digital-signature-admin-ui
    path: src/frontend/admin.jsx
```

### UI Components

**Location**: `src/frontend/admin.jsx`

**Features**:

1. **Statistics Panel** (lazy-loaded, see Statistics section below)
   - Total entities (fast query)
   - Detailed stats with progress indicator
   - Sampling estimation for large datasets

2. **Backup Section with Progress Tracking**
```jsx
function BackupSection() {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);

  async function downloadBackup() {
    setDownloading(true);
    let cursor = null;
    const chunks = [];

    do {
      // Call resolver with resumption cursor
      const response = await invoke('adminData', {
        method: 'GET',
        cursor
      });

      chunks.push(response.data);

      // Update progress
      setProgress({
        processed: response.stats.processedEntities,
        total: response.stats.totalEntities || response.stats.processedEntities,
        percent: response.stats.totalEntities
          ? Math.round((response.stats.processedEntities / response.stats.totalEntities) * 100)
          : 100
      });

      cursor = response.cursor;
    } while (!response.completed);

    // Combine base64 chunks
    const combinedBase64 = chunks.join('');

    // Decode and download
    downloadFile(combinedBase64, `backup-${Date.now()}.jsonl.gz`);
    setDownloading(false);
    setProgress(null);
  }

  return (
    <div>
      <Button onClick={downloadBackup} disabled={downloading}>
        {downloading ? 'Downloading...' : 'Download Backup'}
      </Button>
      {progress && (
        <ProgressBar
          value={progress.processed}
          max={progress.total}
          label={`${progress.processed} / ${progress.total} entities (${progress.percent}%)`}
        />
      )}
    </div>
  );
}
```

3. **Restore Section with Chunked Upload**
```jsx
function RestoreSection() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  async function uploadRestore(file) {
    setUploading(true);
    setResult(null);

    // Read file as base64
    const fileData = await readFileAsBase64(file);

    // Split into chunks if large (> 5MB)
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB base64
    const chunks = splitIntoChunks(fileData, CHUNK_SIZE);
    const sessionId = crypto.randomUUID();

    for (let i = 0; i < chunks.length; i++) {
      const response = await invoke('adminData', {
        method: 'PUT',
        headers: {
          'X-Import-Session': sessionId,
          'X-Chunk-Number': i + 1,
          'X-Is-Last-Chunk': i === chunks.length - 1
        },
        body: { data: chunks[i] }
      });

      // Update progress
      setProgress({
        current: i + 1,
        total: chunks.length,
        processed: response.processed,
        percent: Math.round(((i + 1) / chunks.length) * 100)
      });

      if (response.completed) {
        setResult(response.summary);
      }
    }

    setUploading(false);
    setProgress(null);
  }

  return (
    <div>
      <input type="file" accept=".jsonl.gz" onChange={(e) => uploadRestore(e.target.files[0])} />
      {progress && (
        <ProgressBar
          value={progress.current}
          max={progress.total}
          label={`Chunk ${progress.current}/${progress.total} - Processed ${progress.processed} entities`}
        />
      )}
      {result && <ResultSummary data={result} />}
    </div>
  );
}
```

4. **Aggregate Statistics Only**
   - Never enumerate thousands of individual records
   - Show counts and percentages
   - Progress indicators during operations

### UI Wireframe

```
┌─────────────────────────────────────────────────────┐
│ Digital Signature Administration                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│ Storage Statistics                                  │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Total Entities: 5,234                (instant)  │ │
│ │                                                  │ │
│ │ [Loading detailed stats...]                     │ │
│ │ Processed: 1,200 / 5,234 (23%)                  │ │
│ │ ████████░░░░░░░░░░░░░░░░░░░░░░░░                │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Backup Data                                         │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Create a backup of all signature data           │ │
│ │                                                  │ │
│ │ [Downloading...]  (disabled during download)    │ │
│ │                                                  │ │
│ │ Progress: 3,500 / 5,234 entities (67%)          │ │
│ │ ████████████████████████████░░░░░░░░░░░░        │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Restore Data                                        │
│ ┌─────────────────────────────────────────────────┐ │
│ │ Upload a backup file to restore signatures      │ │
│ │                                                  │ │
│ │ [Choose File]  backup-2025-11-22.jsonl.gz       │ │
│ │                                                  │ │
│ │ [Uploading...] (disabled during upload)         │ │
│ │                                                  │ │
│ │ Chunk 3/6 - Processed 3,000 entities            │ │
│ │ ████████████████████░░░░░░░░░░░░░░░░░░░░        │ │
│ │                                                  │ │
│ │ Note: Restore merges data (non-destructive)     │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ Import Results (after restore)                      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ✓ Successfully processed 5,234 entities          │ │
│ │                                                  │ │
│ │ • Created: 120 new entities                     │ │
│ │ • Merged: 5,100 existing entities               │ │
│ │ • Added: 450 new signatures                     │ │
│ │ • Errors: 14 (see details below)                │ │
│ │                                                  │ │
│ │ [View Error Details]                            │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Statistics Panel (Lazy Loading)

The statistics panel provides administrators with insights into storage usage, but must handle thousands of entities efficiently.

### Fast Queries (Instant)

**Total Entity Count**:
```javascript
// O(1) operation - count query only
const totalCount = await kvs.entity('signature').query().count();
// Returns immediately: ~100-200ms
```

### Slow Queries (Requires Iteration)

**Detailed Statistics** (total signatures, active/deleted breakdown):
```javascript
// Must iterate all entities
async function calculateDetailedStats() {
  let totalSignatures = 0;
  let activeCount = 0;
  let deletedCount = 0;
  let cursor;
  let processed = 0;

  do {
    const results = await kvs.entity('signature')
      .query()
      .limit(100)
      .cursor(cursor)
      .getMany();

    for (const entity of results.results) {
      totalSignatures += entity.value.signatures.length;
      if (entity.value.deletedAt > 0) {
        deletedCount++;
      } else {
        activeCount++;
      }
      processed++;

      // Update UI progress every 100 entities
      if (processed % 100 === 0) {
        updateProgress(processed);
      }
    }

    cursor = results.nextCursor;
  } while (cursor);

  return { totalSignatures, activeCount, deletedCount };
}
```

**Performance**:
- For 5,000 entities: ~50 queries × 100ms each = ~5-6 seconds
- For 1,000 entities: ~10 queries × 100ms each = ~1-2 seconds

### UI Implementation

**Progressive Loading**:
```jsx
function StatisticsPanel() {
  const [stats, setStats] = useState({ totalEntities: null, loading: true });

  useEffect(() => {
    async function loadStats() {
      // Fast: Get total count immediately
      const total = await invoke('getEntityCount');
      setStats({ totalEntities: total, loading: true });

      // Slow: Calculate detailed stats with progress
      const detailed = await invoke('getDetailedStats', {
        onProgress: (processed) => {
          setStats(prev => ({ ...prev, processed }));
        }
      });

      setStats({ ...detailed, loading: false });
    }

    loadStats();
  }, []);

  if (stats.loading) {
    return (
      <div>
        <div>Total Entities: {stats.totalEntities}</div>
        <div>Loading detailed stats...</div>
        {stats.processed && (
          <ProgressBar
            value={stats.processed}
            max={stats.totalEntities}
            label={`Processed: ${stats.processed} / ${stats.totalEntities}`}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <div>Total Entities: {stats.totalEntities}</div>
      <div>Total Signatures: {stats.totalSignatures}</div>
      <div>Active: {stats.activeCount} | Deleted: {stats.deletedCount}</div>
    </div>
  );
}
```

### Alternative: Sampling Estimation

For very large datasets (>10K entities), use statistical sampling:

```javascript
async function estimateStats() {
  // Sample first 100 entities
  const results = await kvs.entity('signature')
    .query()
    .limit(100)
    .getMany();

  const sample = results.results.map(r => r.value);
  const avgSignatures = sample.reduce((sum, e) => sum + e.signatures.length, 0) / sample.length;

  const totalCount = await kvs.entity('signature').query().count();

  return {
    totalEntities: totalCount,
    estimatedSignatures: Math.round(avgSignatures * totalCount),
    note: 'Estimated from sample of 100 entities'
  };
}
```

---

## Technical Architecture

### File Structure

```
src/
├── frontend/
│   └── admin.jsx                      # Admin UI (NEW)
├── resolvers/
│   ├── index.js                       # Update to add adminData route
│   └── adminDataResolver.js           # GET/PUT handler (NEW)
├── storage/
│   ├── signatureStore.js              # Existing
│   └── backupManager.js               # Export/import logic (NEW)
└── utils/
    ├── adminAuth.js                   # Admin authorization check (NEW)
    └── responseHelper.js              # Existing
```

### New Files

#### 1. `src/utils/adminAuth.js`

```javascript
import api, { route } from '@forge/api';

/**
 * Check if user is a Confluence administrator
 * @param {string} accountId - User's Atlassian account ID
 * @returns {Promise<boolean>}
 */
export async function isConfluenceAdmin(accountId) {
  // Implementation as shown in Authorization section
}
```

#### 2. `src/storage/backupManager.js`

```javascript
import { kvs } from '@forge/kvs';
import { gzipSync, gunzipSync } from 'zlib';

const MAX_EXECUTION_TIME = 20000; // 20s timeout monitoring
const BATCH_SIZE = 100; // KVS query batch size
const CHUNK_SIZE = 1000; // Entities per chunk

/**
 * Export signature entities with chunking and timeout monitoring
 * @param {object} options - { cursor, startTime, accountId }
 * @returns {Promise<ExportChunk>} - Chunked export result
 */
export async function exportChunk(options) {
  const { cursor, startTime, accountId } = options;
  // See Scalability & Performance section for full implementation
  // Returns: { completed, data (base64), cursor, stats }
}

/**
 * Import signature entities from base64-encoded gzip chunk
 * @param {object} options - { data (base64), sessionId, chunkNumber }
 * @returns {Promise<ImportResult>}
 */
export async function importChunk(options) {
  const { data, sessionId, chunkNumber } = options;
  // Decode base64 → gunzip → parse JSONL → merge entities
  // Manage session state in KVS
  // Returns: { completed, sessionId, stats }
}
```

#### 3. `src/resolvers/adminDataResolver.js`

```javascript
import { requireAdmin } from '../utils/adminAuth';
import { exportChunk, importChunk } from '../storage/backupManager';
import { successResponse, errorResponse } from '../utils/responseHelper';

/**
 * Handle GET /admin/data (export) and PUT /admin/data (import)
 * with chunking and timeout monitoring
 */
export async function adminDataResolver(req) {
  // Check authorization
  const auth = await requireAdmin(req);
  if (!auth.authorized) {
    return errorResponse(auth.error, 403);
  }

  if (req.method === 'GET') {
    // Export with chunking
    const cursor = req.query?.cursor;
    const result = await exportChunk({
      cursor,
      startTime: Date.now(),
      accountId: auth.accountId
    });
    return successResponse(result);

  } else if (req.method === 'PUT') {
    // Import with session management
    const sessionId = req.headers['x-import-session'];
    const chunkNumber = parseInt(req.headers['x-chunk-number']);
    const result = await importChunk({
      data: req.body.data,
      sessionId,
      chunkNumber
    });
    return successResponse(result);
  }

  return errorResponse('Method not allowed', 405);
}
```

#### 4. Update `src/resolvers/index.js`

```javascript
import Resolver from '@forge/resolver';
import { signResolver } from './signResolver';
import { getSignaturesResolver } from './getSignaturesResolver';
import { checkAuthorizationResolver } from './checkAuthorizationResolver';
import { adminDataResolver } from './adminDataResolver';

const resolver = new Resolver();

resolver.define('sign', signResolver);
resolver.define('getSignatures', getSignaturesResolver);
resolver.define('checkAuthorization', checkAuthorizationResolver);
resolver.define('adminData', adminDataResolver); // NEW

export const handler = resolver.getDefinitions();
```

---

## Scalability & Performance

### Design for Thousands of Entities

#### Export (GET /admin/data)

**Challenge**: Query and return thousands of entities without hitting 25-second resolver timeout

**Solution**: Chunked export with timeout monitoring and automatic resumption

```javascript
const MAX_EXECUTION_TIME = 20000; // 20 seconds (5s buffer before 25s timeout)
const BATCH_SIZE = 100; // KVS query batch size
const CHUNK_SIZE = 1000; // Target entities per chunk

async function exportWithTimeout(req) {
  const startTime = Date.now();
  const resumeCursor = req.query?.cursor;

  const entities = [];
  const jsonlLines = [];
  let kvsCursor = resumeCursor;
  let processedCount = 0;
  let isFirstChunk = !resumeCursor;

  // Add metadata line (first chunk only)
  if (isFirstChunk) {
    jsonlLines.push(JSON.stringify({
      version: '1.0.0',
      exportedAt: Math.floor(Date.now() / 1000),
      exportedBy: req.context.accountId,
      appVersion: '1.1.23'
    }));
  }

  // Query entities in batches
  do {
    // Check timeout before each KVS query
    if (Date.now() - startTime > MAX_EXECUTION_TIME) {
      // Time to return chunk
      break;
    }

    const results = await kvs.entity('signature')
      .query()
      .limit(BATCH_SIZE)
      .cursor(kvsCursor)
      .getMany();

    // Add entities to chunk
    for (const result of results.results) {
      jsonlLines.push(JSON.stringify(result.value));
      processedCount++;
    }

    kvsCursor = results.nextCursor;

    // Check if chunk size reached
    if (processedCount >= CHUNK_SIZE) {
      break;
    }

  } while (kvsCursor);

  // Create gzip, encode as base64
  const gzipped = gzipSync(jsonlLines.join('\n'));
  const base64Data = gzipped.toString('base64');

  return {
    completed: !kvsCursor, // No more data
    data: base64Data,
    cursor: kvsCursor || undefined,
    stats: {
      processedEntities: processedCount,
      elapsedSeconds: Math.floor((Date.now() - startTime) / 1000)
    }
  };
}
```

**Performance characteristics**:
- **Memory usage**: O(c) where c=chunk size (~1000 entities, ~5MB max)
- **Time per chunk**: 15-20 seconds (well under 25s timeout)
- **Chunks for 10K entities**: ~10 chunks × 18s each = ~3 minutes total
- **Client experience**: Automatic, transparent chunking with progress

#### Import (PUT /admin/data)

**Challenge**: Parse and merge thousands of entities without timeout, handle chunked uploads

**Solution**: Session-based chunked import with timeout monitoring

```javascript
async function importWithSession(req) {
  const sessionId = req.headers['x-import-session'];
  const chunkNumber = parseInt(req.headers['x-chunk-number']);
  const { data } = req.body;

  // Decode base64 → decompress gzip → split lines
  const gzippedBuffer = Buffer.from(data, 'base64');
  const decompressed = gunzipSync(gzippedBuffer);
  const lines = decompressed.toString('utf-8').split('\n');

  // Load or create session state
  let session = await loadSession(sessionId) || {
    totalProcessed: 0,
    stats: { entitiesCreated: 0, entitiesMerged: 0, errors: [] }
  };

  let lineNumber = session.totalProcessed;

  for (const line of lines) {
    if (!line.trim()) continue;

    lineNumber++;

    try {
      const entity = JSON.parse(line);

      // Skip metadata line (has version field)
      if (entity.version) continue;

      // Merge entity with existing data
      await importEntity(entity, session.stats);
      session.totalProcessed++;

    } catch (error) {
      session.stats.errors.push({
        line: lineNumber,
        chunk: chunkNumber,
        error: error.message
      });
    }
  }

  // Save session state
  await saveSession(sessionId, session);

  // Determine if more chunks expected
  const isLastChunk = req.headers['x-is-last-chunk'] === 'true';

  if (isLastChunk) {
    // Cleanup session
    await deleteSession(sessionId);

    return {
      completed: true,
      sessionId,
      summary: session.stats
    };
  } else {
    return {
      completed: false,
      sessionId,
      processed: session.totalProcessed,
      nextChunkExpected: chunkNumber + 1,
      stats: session.stats
    };
  }
}
```

**Performance characteristics**:
- **Memory usage**: O(c) where c=chunk size (process one chunk at a time)
- **Time per chunk**: Variable based on merge complexity, typically 10-20s
- **Session overhead**: Minimal (stores aggregate stats in KVS, ~1KB)

### Platform Quotas & Mitigation

**Forge Platform Quotas** (as of 2025):
- **Resolver execution timeout**: 25 seconds for async operations
- **KVS query limit**: 100 entities per query (pagination required)
- **Storage API rate limits**: Apply to all KVS operations

**How Chunking Mitigates Limits**:
- ✅ **Timeout**: 20-second monitoring ensures chunks complete before 25s limit
- ✅ **Memory**: Process 1000 entities per chunk (~5MB) - well under limits
- ✅ **Scalability**: No upper bound - 100K+ entities handled via multiple chunks
- ✅ **User experience**: Transparent automatic chunking with progress tracking

---

## Error Handling

### Validation

**On Export**:
- Check admin authorization before starting
- Handle KVS query failures gracefully
- Log errors but continue processing remaining entities

**On Import**:
- Validate metadata line (version, required fields)
- Validate each entity (schema compliance)
- Continue processing on non-fatal errors
- Collect all errors for final report

### Error Categories

**Fatal Errors** (abort operation):
- User not authorized (403)
- Invalid file format (400)
- KVS storage unavailable (500)

**Non-Fatal Errors** (log and continue):
- Malformed entity line (skip, add to error report)
- Duplicate accountId in same entity (deduplicate)
- Invalid timestamp (use fallback value)

### Error Response Format

```json
{
  "success": false,
  "error": "Import failed: Invalid metadata line",
  "details": {
    "line": 1,
    "expected": "version field",
    "received": "{}"
  }
}
```

---

## Testing Considerations

### Test Cases

1. **Empty database export/import**
   - Verify metadata-only file is valid
   - Single chunk response with completed=true

2. **Small dataset (< 1000 entities) - Single Chunk**
   - Export completes in one request (no cursor)
   - Import completes in one chunk
   - Measure export/import time

3. **Large dataset (5000+ entities) - Multi-Chunk**
   - Verify chunked export with cursor resumption
   - Test export timeout monitoring (simulated)
   - Verify import session management across multiple chunks
   - Test chunk sequence validation (reject out-of-order chunks)
   - Measure memory usage per chunk (should stay < 10MB)

4. **Merge scenarios**
   - New entity + existing entity = merged
   - Same accountId, different timestamps = keep oldest
   - Deleted entities preserve deletedAt

5. **Error handling**
   - Malformed JSONL line → skip, report error, continue processing
   - Invalid gzip / base64 → return 400 error
   - Non-admin user → return 403
   - Session ID mismatch → return 409 Conflict
   - Wrong chunk number → return 400 error

6. **Authorization**
   - Admin user → allowed
   - Non-admin user → 403
   - API failure → 403 (fail closed)

7. **Chunk Resumption**
   - Export: Cursor from response N works in request N+1
   - Import: Session state persists across chunks
   - Session cleanup after completion

8. **Base64 Encoding**
   - Verify gzip → base64 → transport → base64 decode → gunzip roundtrip
   - Test with binary data (non-UTF8 in signatures field)

### Performance Benchmarks

**Single Chunk (< 1000 entities)**:
- Export: < 5 seconds, single request
- Import: < 10 seconds, single request
- Memory: < 10 MB peak

**Multi-Chunk (5000 entities)**:
- Export: ~5-6 chunks, 15-20 seconds each, ~90-120 seconds total
- Import: ~5-6 chunks, 10-15 seconds each, ~60-90 seconds total
- Memory per chunk: < 10 MB
- Session overhead: < 1 MB in KVS

**Timeout Safety**:
- Each chunk completes in < 20 seconds (5s buffer before 25s limit)
- No chunk should ever timeout

---

## Migration Support

This backup/restore system serves as the foundation for **legacy macro migration** (separate spec).

### How Migration Will Use This System

1. **Legacy Macro**: Implements `GET /admin/data` using this spec's format
2. **New Macro**: Uses `PUT /admin/data` to import legacy data
3. **Same Format**: Both use JSONL.gz for consistency
4. **Merge Logic**: Handles data from old and new systems seamlessly

### Future Spec: Migration

A separate specification will define:
- Legacy data export format mapping
- Migration UI workflow
- Data transformation rules
- Validation and testing procedures

---

## Security Considerations

### Data Privacy

- Backup files contain **personally identifiable information** (accountIds)
- Files should be stored securely by administrators
- Consider encryption for backup files (out of scope for v1)

### Access Control

- Only Confluence administrators can backup/restore
- No way to bypass authorization check
- Audit log all backup/restore operations

### Data Integrity

- Gzip includes checksums (CRC32)
- JSON schema validation on import
- Merge strategy prevents data loss

---

## Open Questions & Future Enhancements

### V1 (Current Spec - MVP)

- ✅ Resumable/chunked REST API (GET/PUT /admin/data)
- ✅ Timeout monitoring with automatic chunking
- ✅ Admin UI with progress tracking
- ✅ Session-based import with multi-chunk support
- ✅ Lazy-loading statistics panel
- ✅ Authorization (Confluence administrators only)
- ✅ Merge strategy (non-destructive)
- ✅ Handles thousands of entities without timeout issues

### V2 (Future Considerations)

1. **CLI Tool (Optional)**: For automation scenarios (scheduled backups, CI/CD integration), a lightweight CLI tool may be provided as a thin wrapper around the resumable REST API. Primary use cases: automated backups via cron/Task Scheduler, encryption with GPG/age, scripting-friendly output. Technology: Rust for zero-dependency native binaries (Linux/Windows/macOS). This is not required for MVP and will be evaluated based on user demand.

2. **Versioning**: Keep multiple backup versions with rotation policy

3. **Differential backups**: Export only changes since last backup (requires tracking changesets)

---

## Appendix: Alternative Formats Considered

| Format | Pros | Cons | Decision |
|--------|------|------|----------|
| **JSONL.gz** | Streamable, fault-tolerant, mature | Slightly larger than binary | ✅ **Selected** |
| JSON Array | Simple, widely supported | Not streamable, fails if corrupted | ❌ Rejected |
| CSV | Human-readable, Excel-compatible | Nested data difficult, no schema | ❌ Rejected |
| MessagePack | Compact binary format | Requires external library, not human-readable | ❌ Rejected |
| Protobuf | Most compact, typed | Requires schema management, complex | ❌ Rejected |
| SQLite | Queryable, transactional | Requires library, overkill for append-only | ❌ Rejected |

**Rationale**: JSONL.gz provides the best balance of simplicity, stability, and chunked processing capability for long-term storage.

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-11-22 | System | Initial specification |
| 2.0 | 2025-11-23 | System | Major update: Resumable/chunked API design, timeout monitoring, session-based import, progress tracking UI, lazy-loading statistics, minimal CLI mention as future work |
