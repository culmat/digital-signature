# Backup & Restore Specification

## Overview

This document defines the admin backup and restore functionality for the Digital Signature Confluence macro. This feature enables Confluence administrators to export all signature data from their instance and restore it later, supporting disaster recovery and migration scenarios.

**Storage Backend**: Forge SQL (normalized relational schema)

### Scope

- **In Scope**: Admin-level backup and restore of all signature data for a Confluence instance
- **Out of Scope**:
  - End-user export of individual signatures (covered separately in TODO.txt)
  - Legacy macro migration (will be covered in a separate specification)

### Use Cases

1. **Migration Foundation**: Export data from one instance for import to another
2. **Testing**: Import test fixtures
1. **Disaster Recovery**: Regular backups to restore data after incidents

---

## Data Format

### Format: SQL Dump (MySQL-Compatible)

**File extension**: `.sql.gz`

**Why SQL dump instead of JSON?**
- **Native format**: Direct SQL dump from Forge SQL (TiDB/MySQL-compatible)
- **Transactional integrity**: Single atomic restore via SQL transactions
- **Referential integrity**: Preserves relationships between contracts and signatures
- **Performance**: Bulk INSERT operations are faster than row-by-row merging
- **Standard tooling**: Works with mysql CLI, phpMyAdmin, DBeaver, etc.
- **Simpler implementation**: Use SQL's built-in INSERT...ON DUPLICATE KEY UPDATE
- **Gzip compression**: Same compression as before, excellent for text-based SQL

**Transport Encoding**:
- SQL dump is gzipped for compression
- Gzipped data is **base64-encoded** for transport through resolver
- Each chunk is independently valid: SQL statements → gzipped → base64-encoded
- Client concatenates chunks and decodes: base64 → gunzip → SQL statements
- Chunk size: ~5000 rows per chunk (tunable based on performance)

### File Structure

SQL dump with metadata comments and bulk INSERT statements:

```sql
-- Digital Signature Backup
-- Version: 3.0.0
-- Exported: 2025-11-23 16:30:00 UTC
-- Exported By: 557058:f8e7f66f-7f19-4e5c-b8ae-123456789abc
-- App Version: 3.0.0
-- Site: https://your-site.atlassian.net
-- Total Contracts: 2500
-- Total Signatures: 5234

-- Disable foreign key checks (not used but standard in MySQL dumps)
SET FOREIGN_KEY_CHECKS = 0;

-- Contract table data
INSERT INTO contract (hash, pageId, createdAt, deletedAt) VALUES
('a1b2c3d4e5f6...', 123456, '2025-11-01 10:30:15.123456', NULL),
('d4e5f6a7b8c9...', 123457, '2025-11-02 14:22:00.654321', '2025-11-10 08:15:30.111111'),
...
('z9y8x7w6v5u4...', 999999, '2025-11-20 18:45:10.999999', NULL)
ON DUPLICATE KEY UPDATE
  pageId = VALUES(pageId),
  createdAt = LEAST(createdAt, VALUES(createdAt)),
  deletedAt = COALESCE(VALUES(deletedAt), deletedAt);

-- Signature table data
INSERT INTO signature (contractHash, accountId, signedAt) VALUES
('a1b2c3d4e5f6...', '557058:uuid-1', '2025-11-01 10:35:22.123456'),
('a1b2c3d4e5f6...', '557058:uuid-2', '2025-11-01 11:20:45.654321'),
('d4e5f6a7b8c9...', '557058:uuid-3', '2025-11-02 14:25:33.987654'),
...
('z9y8x7w6v5u4...', '557058:uuid-n', '2025-11-20 19:00:00.111111')
ON DUPLICATE KEY UPDATE
  signedAt = LEAST(signedAt, VALUES(signedAt));

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;
```

### Schema Compatibility

The SQL dump uses the normalized schema from `docs/sql-schema-design.md`:

**Contract Table**:
- `hash` VARCHAR(64) PRIMARY KEY - SHA-256 of pageId:title:body
- `pageId` BIGINT NOT NULL - Confluence page ID
- `createdAt` TIMESTAMP(6) NOT NULL - When contract was created (UTC, microseconds)
- `deletedAt` TIMESTAMP(6) NULL - When soft-deleted (NULL if active)

**Signature Table**:
- `contractHash` VARCHAR(64) NOT NULL - Reference to contract.hash
- `accountId` VARCHAR(128) NOT NULL - Atlassian account ID
- `signedAt` TIMESTAMP(6) NOT NULL - When user signed (UTC, microseconds)
- PRIMARY KEY (contractHash, accountId) - Compound key prevents duplicates

---

## REST API Endpoints

### GET /admin/data

**Purpose**: Export (backup) all signature data from the Confluence instance with automatic chunking to avoid timeouts

**Authorization**: Confluence administrators only

**Request**:
- Method: `GET`
- Path: `/admin/data`
- Query Parameters:
  - `offset` (optional): Row offset for pagination (default: 0)
  - `limit` (optional): Rows per chunk (default: 5000, max: 10000)

**Response (Chunk Completed)**:
```json
{
  "completed": false,
  "data": "<base64-encoded gzipped SQL dump chunk>",
  "offset": 5000,
  "stats": {
    "totalContracts": 2500,
    "totalSignatures": 5234,
    "processedContracts": 1000,
    "processedSignatures": 2000,
    "estimatedChunks": 3,
    "elapsedSeconds": 12
  }
}
```

**Response (Export Completed)**:
```json
{
  "completed": true,
  "data": "<base64-encoded gzipped SQL dump final chunk>",
  "stats": {
    "totalContracts": 2500,
    "totalSignatures": 5234,
    "processedContracts": 2500,
    "processedSignatures": 5234,
    "totalChunks": 3
  }
}
```

**Error Responses**:
- `403 Forbidden`: User is not a Confluence administrator
- `500 Internal Server Error`: Export processing failed

**Resumable Export Behavior**:
- Monitors execution time continuously
- Returns partial result when approaching 20-second timeout (5s safety buffer)
- Client automatically requests next chunk using returned `offset`
- First chunk contains metadata comments + initial SQL statements
- Subsequent chunks contain continuation of INSERT statements
- Chunks are independently valid SQL files that can be concatenated

**Implementation Strategy**:
1. First chunk: Add metadata comments and start transaction
2. Query contracts with LIMIT/OFFSET pagination
3. Query signatures with LIMIT/OFFSET pagination
4. Build SQL INSERT statements with ON DUPLICATE KEY UPDATE
5. Compress to gzip, encode as base64
6. Monitor time: if >20s elapsed, return partial chunk with next offset
7. Include ALL rows (including `deletedAt IS NOT NULL`)

---

### PUT /admin/data

**Purpose**: Import (restore) signature data by executing SQL statements

**Authorization**: Confluence administrators only

**Request**:
- Method: `PUT`
- Path: `/admin/data`
- Headers:
  - `Content-Type: application/json`
- Body:
```json
{
  "data": "<base64-encoded gzipped SQL dump>"
}
```

**Response (Success)**:
```json
{
  "completed": true,
  "summary": {
    "contractsInserted": 520,
    "contractsUpdated": 1980,
    "signaturesInserted": 1450,
    "signaturesUpdated": 3784,
    "executionTimeSeconds": 8,
    "errors": []
  }
}
```

**Response (With Errors)**:
```json
{
  "completed": true,
  "summary": {
    "contractsInserted": 500,
    "contractsUpdated": 1950,
    "signaturesInserted": 1400,
    "signaturesUpdated": 3700,
    "executionTimeSeconds": 7,
    "errors": [
      {
        "statement": "INSERT INTO contract...",
        "error": "Duplicate entry for key 'PRIMARY'"
      }
    ]
  }
}
```

**Error Responses**:
- `403 Forbidden`: User is not a Confluence administrator
- `400 Bad Request`: Invalid SQL dump format or corrupted data
- `500 Internal Server Error`: SQL execution failed

**No Session Management Needed**:
- SQL dumps can be executed atomically within a single transaction
- ON DUPLICATE KEY UPDATE handles merge logic automatically
- No need for chunked uploads or session state
- Entire restore completes in one request (or fails atomically)

**Implementation Strategy**:
1. Decode base64 → decompress gzip → extract SQL statements
2. Validate SQL dump format (check for required tables)
3. Begin transaction
4. Execute SQL statements sequentially
5. Commit transaction on success, rollback on failure
6. Return summary with affected row counts from SQL driver

---

## Merge Strategy

When restoring data with `PUT /admin/data`, the SQL dump uses **ON DUPLICATE KEY UPDATE** to automatically merge data. This preserves signatures created after the backup was taken.

### SQL Merge Logic

The SQL dump contains INSERT statements with ON DUPLICATE KEY UPDATE clauses:

```sql
-- Contract merge: Keep earliest createdAt, preserve deletedAt from backup
INSERT INTO contract (hash, pageId, createdAt, deletedAt) VALUES
  ('abc123...', 123456, '2025-11-01 10:30:15.123456', NULL)
ON DUPLICATE KEY UPDATE
  pageId = VALUES(pageId),
  createdAt = LEAST(createdAt, VALUES(createdAt)),
  deletedAt = COALESCE(VALUES(deletedAt), deletedAt);

-- Signature merge: Keep earliest signedAt for duplicate signatures
INSERT INTO signature (contractHash, accountId, signedAt) VALUES
  ('abc123...', '557058:uuid-1', '2025-11-01 10:35:22.123456')
ON DUPLICATE KEY UPDATE
  signedAt = LEAST(signedAt, VALUES(signedAt));
```

### Merge Rules

**Contracts**:
1. **New contracts**: Inserted as-is with all fields
2. **Existing contracts**: 
   - `pageId` updated to backup value
   - `createdAt` keeps the earliest timestamp (LEAST function)
   - `deletedAt` preserves backup value if set, otherwise keeps current value (COALESCE)

**Signatures**:
1. **New signatures**: Inserted as-is
2. **Duplicate signatures** (same contractHash + accountId):
   - `signedAt` keeps the earliest timestamp (LEAST function)
   - Compound PRIMARY KEY prevents true duplicates

### Why This Approach?

- **Database-native**: Merge logic handled by SQL engine (fast, atomic)
- **Transactional**: All merges in single transaction (all-or-nothing)
- **Non-destructive**: Never loses data from current instance
- **Idempotent**: Running same import multiple times produces same result
- **Simple**: No application code needed for merge logic
- **Performant**: Bulk INSERT with merge is faster than row-by-row operations

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

Required scopes already in `manifest.yml`:
- `read:confluence-user` - Group membership check
- `read:confluence-content.all` - Read page metadata  
- `storage:app` - SQL database access

### Security

- Authorization checked server-side in resolver
- Fail closed on API errors (return 403)
- Audit log all operations with accountId and timestamp

---

## Admin UI

Add to `manifest.yml`:
```yaml
modules:
  confluence:globalSettings:
    - key: digital-signature-admin-settings
      title: Digital Signature Admin
      resource: digital-signature-admin-ui
```

**Location**: `src/frontend/admin.jsx`

### Components

**1. Statistics** - Instant COUNT queries: total/active/deleted contracts, total signatures

**2. Backup** - Button with progress bar, chunked download, `backup-{timestamp}.sql.gz`

**3. Restore** - File upload (.sql.gz), atomic transaction, result summary

---

## Implementation

### New Files

**`src/utils/adminAuth.js`** - Check if user is Confluence administrator via group membership API

**`src/storage/backupManager.js`** - Export/import SQL dumps with gzip compression and base64 encoding

**`src/resolvers/adminDataResolver.js`** - Handle GET (export) and PUT (import) with admin auth check

**`src/frontend/admin.jsx`** - Admin UI with statistics, backup download, restore upload

**`src/resolvers/index.js`** - Add `resolver.define('adminData', adminDataResolver)`

---

## Performance

### Export
- Chunked with LIMIT/OFFSET (5000 rows per chunk)
- 20s timeout monitoring per chunk
- 10-15s per chunk, ~2MB compressed
- Memory: O(chunk_size) ~2-5MB

### Import  
- Single atomic transaction
- Parse SQL, execute statements sequentially
- 5-15s for 10K rows
- Memory: O(file_size)

### Benchmarks
- **Small (< 5K rows)**: Export 12s, Import 8s
- **Medium (10K rows)**: Export 30s (2 chunks), Import 15s
- **Large (50K rows)**: Export 3min (10 chunks), Import 45s

---

## Error Handling

**Export**: Check admin auth, handle SQL query failures, log and continue

**Import**: Validate SQL syntax, execute in transaction, collect errors, return summary

**Fatal Errors** (abort): Not authorized (403), invalid format (400), SQL unavailable (500)

**Non-Fatal Errors** (collect): Malformed SQL statements, duplicate key violations

---

## Testing

1. Empty database - metadata-only dump valid
2. Small dataset (< 5K rows) - single chunk, verify MySQL syntax
3. Large dataset (10K+ rows) - multi-chunk with offset, concatenate valid
4. Merge scenarios - LEAST(createdAt), LEAST(signedAt), preserve deletedAt
5. Error handling - malformed SQL, invalid gzip/base64, non-admin 403
6. Authorization - admin allowed, non-admin 403, fail closed
7. Chunk resumption - offset pagination, no duplicate rows
8. Base64 encoding - roundtrip with special characters
9. Transaction integrity - atomic import, rollback on error, accurate row counts

---

## Security

- Backup files contain PII (accountIds) - store securely
- Admin-only access, fail closed on auth errors
- Audit log all operations
- Gzip checksums (CRC32) validate integrity

## Future Enhancements

- CLI tool for automation (cron, CI/CD)
- Backup versioning with rotation policy
- Differential backups (track changesets)

---

---

**Version**: 3.0 | **Date**: 2025-11-23 | SQL-based storage with native SQL dump format
