# SQL Schema Design for Digital Signatures

## Overview

This document defines the normalized SQL schema for the digital signature application, designed for Forge SQL (TiDB/MySQL-compatible). This is a **breaking change** that completely replaces the existing Key-Value Store (KVS) implementation.

## Context

- **Previous Storage**: Forge Custom Entities (KVS) - see [signatureStore.js](../src/storage/signatureStore.js)
- **New Storage**: Forge SQL (TiDB-based, MySQL-compatible)
- **Migration Type**: Breaking change - no backwards compatibility
- **Target Platform**: Forge SQL (TiDB-based, MySQL-compatible)
- **Migration Path**: See [sql-migration-guide.md](./sql-migration-guide.md)

## Design Principles

1. **Normalized Relational Design**: Separate tables for contracts and signatures
2. **SQL Best Practices**: Proper data types (TIMESTAMP for dates, BIGINT for IDs)
3. **Forge SQL Optimizations**: Uses AUTO_RANDOM for distributed performance
4. **No Foreign Key Constraints**: Not supported in Forge SQL - manual referential integrity
5. **Database-Level Integrity**: UNIQUE constraints, NOT NULL, proper indexes
6. **Modern SQL Standards**: TIMESTAMP with fractional seconds, proper date functions

---

## Schema Definition

### Table: `contract`

Stores contract metadata representing signed Confluence pages.

#### DDL Statement

```sql
CREATE TABLE IF NOT EXISTS contract (
  hash VARCHAR(64) PRIMARY KEY COMMENT 'SHA-256 hash of pageId:title:body',
  pageId BIGINT NOT NULL COMMENT 'Confluence page ID',
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'When contract was created',
  deletedAt TIMESTAMP(6) NULL DEFAULT NULL COMMENT 'When page was deleted, NULL if active',
  INDEX idx_pageId (pageId),
  INDEX idx_deletedAt (deletedAt)
) COMMENT = 'Contract entities representing signed Confluence pages';
```

#### Column Specifications

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| **hash** | VARCHAR(64) | PRIMARY KEY | SHA-256 hash (64 hex chars) of `pageId:title:body` |
| **pageId** | BIGINT | NOT NULL | Confluence page ID (numeric) |
| **createdAt** | TIMESTAMP(6) | NOT NULL, DEFAULT CURRENT_TIMESTAMP(6) | When contract was created (UTC, microseconds) |
| **deletedAt** | TIMESTAMP(6) | NULL DEFAULT NULL | When soft-deleted (UTC, microseconds), NULL if active |

#### Indexes

| Index Name | Columns | Type | Purpose |
|------------|---------|------|---------|
| **PRIMARY** | hash | Unique | Direct lookup by hash (primary access pattern) |
| **idx_pageId** | pageId | Non-unique | Query all contracts for a specific page |
| **idx_deletedAt** | deletedAt | Non-unique | Cleanup queries for soft-deleted contracts |

---

### Table: `signature`

Stores individual signatures with many-to-one relationship to contracts.

#### DDL Statement

```sql
CREATE TABLE IF NOT EXISTS signature (
  contractHash VARCHAR(64) NOT NULL COMMENT 'Reference to contract.hash',
  accountId VARCHAR(128) NOT NULL COMMENT 'Atlassian account ID of signer',
  signedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'When user signed (UTC, microseconds)',
  PRIMARY KEY (contractHash, accountId),
  INDEX idx_contract (contractHash),
  INDEX idx_accountId (accountId),
  INDEX idx_signedAt (signedAt)
) COMMENT = 'Individual signatures for contracts';
```

#### Column Specifications

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| **contractHash** | VARCHAR(64) | PRIMARY KEY (part 1 of 2), NOT NULL | References `contract.hash` (manual relationship) |
| **accountId** | VARCHAR(128) | PRIMARY KEY (part 2 of 2), NOT NULL | Atlassian account ID (format: `557058:uuid`) |
| **signedAt** | TIMESTAMP(6) | NOT NULL, DEFAULT CURRENT_TIMESTAMP(6) | When signature was created (UTC, microseconds) |

#### Indexes

| Index Name | Columns | Type | Purpose |
|------------|---------|------|---------|
| **PRIMARY** | (contractHash, accountId) | Unique (compound) | Natural key - one signature per user per contract |
| **idx_contract** | contractHash | Non-unique | JOIN queries and lookups by contract |
| **idx_accountId** | accountId | Non-unique | Query all signatures by specific user |
| **idx_signedAt** | signedAt | Non-unique | Time-based queries (recent activity, etc.) |

---

## Data Type Rationale

### String Types

#### `hash` - VARCHAR(64)
- SHA-256 produces 64-character hexadecimal string
- Used as PRIMARY KEY for direct contract lookup
- Fixed-length but VARCHAR provides compatibility

#### `accountId` - VARCHAR(128)
- Atlassian account ID format: `"557058:f8e7f66f-7f19-4e5c-b8ae-123456789abc"`
- Current length ~50 chars, VARCHAR(128) provides buffer for future changes

### Numeric Types

#### `pageId` - BIGINT
- Confluence page IDs are numeric
- BIGINT supports values up to 9,223,372,036,854,775,807
- More efficient than VARCHAR for numeric comparisons and joins

#### Compound Primary Key: `(contractHash, accountId)`
- **Natural key**: Directly represents the business constraint (one signature per user per contract)
- **No artificial ID**: Eliminates unnecessary surrogate key
- **Enforces uniqueness**: Primary key constraint prevents duplicate signatures
- **Semantic clarity**: The key itself documents what makes a signature unique
- **No AUTO_RANDOM needed**: Natural keys don't require auto-generation
- **Key size consideration**: ~192 bytes (VARCHAR(64) + VARCHAR(128)) - acceptable since signatures aren't referenced by other tables

**Why compound key over artificial ID?**
- Signature table is purely a child table (no other tables reference it)
- The natural business rule is "one user signs one contract once"
- Eliminates redundant UNIQUE constraint (PRIMARY KEY serves both purposes)
- More maintainable - constraint directly expresses business logic

### Timestamp Types

#### TIMESTAMP(6) - All datetime columns

**Format**: `YYYY-MM-DD HH:MM:SS.fraction`
**Example**: `2024-09-19 06:40:34.999999`

**Why TIMESTAMP(6)?**
- **Fractional seconds**: `(6)` provides microsecond precision (6 digits)
- **UTC storage**: TIMESTAMP automatically converts to UTC and back based on connection timezone
- **NULL semantics**: `deletedAt` can be NULL (cleaner than 0 for "not deleted")
- **Native SQL functions**: Works with DATE_SUB, DATE_ADD, NOW(), etc.
- **Modern standard**: Proper SQL datetime type instead of Unix epoch integers
- **Derived values**: Last modified time can be calculated as `MAX(signedAt)` from signatures

**TIMESTAMP vs DATETIME:**
- TIMESTAMP: Auto-converts timezones, 1970-2038 range (sufficient for this use case)
- DATETIME: No timezone conversion, 1000-9999 range
- **Choice**: TIMESTAMP for automatic UTC handling

**Fractional Seconds Precision:**
- `(0)` - No fractional seconds: `2024-09-19 06:40:34`
- `(3)` - Milliseconds: `2024-09-19 06:40:34.123`
- `(6)` - Microseconds: `2024-09-19 06:40:34.123456` ← **Our choice**

**Application Layer:**
```javascript
// JavaScript Date to TIMESTAMP
const now = new Date(); // Automatically converted by SQL driver

// TIMESTAMP to JavaScript Date
const createdAt = new Date(row.createdAt); // Automatically parsed
```

---

## Common Query Patterns

### 1. Get Contract with Signatures (Primary Operation)

**Purpose**: Fetch contract and all its signatures by hash

**SQL Query:**
```sql
SELECT
  c.hash,
  c.pageId,
  c.createdAt,
  c.deletedAt,
  s.accountId,
  s.signedAt
FROM contract c
LEFT JOIN signature s ON c.hash = s.contractHash
WHERE c.hash = ?
ORDER BY s.signedAt ASC;
```

**Query Plan:**
- Uses PRIMARY KEY index on `contract.hash` (very fast)
- LEFT JOIN ensures contract returned even if no signatures exist
- `idx_contract` index used for signature lookup
- Ordered by `signedAt` for chronological display

**Application Code:**
```javascript
const results = await sql.execute(`
  SELECT c.*, s.accountId, s.signedAt
  FROM contract c
  LEFT JOIN signature s ON c.hash = s.contractHash
  WHERE c.hash = ?
  ORDER BY s.signedAt ASC
`, [hash]);

if (results.length === 0) {
  return null; // Contract not found
}

// Group signatures and calculate lastModified
const signatures = results
  .filter(r => r.accountId !== null)
  .map(r => ({
    accountId: r.accountId,
    signedAt: r.signedAt
  }));

const contract = {
  hash: results[0].hash,
  pageId: results[0].pageId,
  createdAt: results[0].createdAt,
  deletedAt: results[0].deletedAt,
  signatures: signatures,
  // Derived: Last modified = most recent signature timestamp
  lastModified: signatures.length > 0
    ? signatures[signatures.length - 1].signedAt  // Last in array (ordered by signedAt ASC)
    : results[0].createdAt  // No signatures yet, use createdAt
};
```

### 2. Add Signature (Write Operation)

**Purpose**: Create contract (if not exists) and add signature

**SQL Queries:**
```sql
-- Query 1: Insert contract if not exists
INSERT IGNORE INTO contract (hash, pageId, createdAt, deletedAt)
VALUES (?, ?, NOW(6), NULL);

-- Query 2: Insert signature (signedAt set automatically via DEFAULT)
INSERT INTO signature (contractHash, accountId, signedAt)
VALUES (?, ?, NOW(6));
```

**Key Features:**
- `NOW(6)` provides current timestamp with microsecond precision
- `INSERT IGNORE` handles concurrent contract creation (fails silently if exists)
- No need to update contract - last modified is derived from `MAX(signedAt)`
- UNIQUE constraint prevents duplicate signatures (throws error if user already signed)

**Application Code:**
```javascript
try {
  // Insert contract if not exists
  await sql.execute(`
    INSERT IGNORE INTO contract (hash, pageId, createdAt, deletedAt)
    VALUES (?, ?, NOW(6), NULL)
  `, [hash, pageId]);

  // Insert signature
  await sql.execute(`
    INSERT INTO signature (contractHash, accountId, signedAt)
    VALUES (?, ?, NOW(6))
  `, [hash, accountId]);

  return { success: true };
} catch (error) {
  if (error.message.includes('Duplicate entry')) {
    throw new Error('User has already signed this contract');
  }
  throw error;
}
```

### 3. Soft Delete by Page

**Purpose**: Mark all contracts for a page as deleted

**SQL Query:**
```sql
UPDATE contract
SET deletedAt = NOW(6)
WHERE pageId = ? AND deletedAt IS NULL;
```

**Query Plan:**
- Uses `idx_pageId` index
- Single atomic UPDATE operation
- Only updates active contracts (deletedAt IS NULL)

**Application Code:**
```javascript
const result = await sql.execute(`
  UPDATE contract
  SET deletedAt = NOW(6)
  WHERE pageId = ? AND deletedAt IS NULL
`, [pageId]);

return result.affectedRows; // Number of contracts marked as deleted
```

### 4. Cleanup Old Deleted Contracts

**Purpose**: Hard delete contracts deleted more than X days ago

**SQL Queries:**
```sql
-- Query 1: Delete signatures (manual cascade)
DELETE s FROM signature s
INNER JOIN contract c ON s.contractHash = c.hash
WHERE c.deletedAt IS NOT NULL
  AND c.deletedAt < DATE_SUB(NOW(6), INTERVAL ? DAY);

-- Query 2: Delete contracts
DELETE FROM contract
WHERE deletedAt IS NOT NULL
  AND deletedAt < DATE_SUB(NOW(6), INTERVAL ? DAY);
```

**Key Features:**
- `DATE_SUB(NOW(6), INTERVAL ? DAY)` calculates cutoff date
- Two operations required (no CASCADE DELETE in Forge SQL)
- Delete signatures first to avoid orphaned records

**Application Code:**
```javascript
const retentionDays = 90;

// Delete signatures first
await sql.execute(`
  DELETE s FROM signature s
  INNER JOIN contract c ON s.contractHash = c.hash
  WHERE c.deletedAt IS NOT NULL
    AND c.deletedAt < DATE_SUB(NOW(6), INTERVAL ? DAY)
`, [retentionDays]);

// Delete contracts
const result = await sql.execute(`
  DELETE FROM contract
  WHERE deletedAt IS NOT NULL
    AND deletedAt < DATE_SUB(NOW(6), INTERVAL ? DAY)
`, [retentionDays]);

return result.affectedRows; // Number of contracts deleted
```

### 5. Query Signatures by User

**Purpose**: Find all signatures by a specific user

**SQL Query:**
```sql
SELECT
  c.hash,
  c.pageId,
  c.createdAt,
  s.signedAt
FROM signature s
INNER JOIN contract c ON s.contractHash = c.hash
WHERE s.accountId = ?
  AND c.deletedAt IS NULL
ORDER BY s.signedAt DESC
LIMIT 100;
```

**Query Plan:**
- Uses `idx_accountId` index
- Filters out deleted contracts
- Ordered by most recent signatures first
- Paginated with LIMIT

### 6. Recent Activity

**Purpose**: Find recently signed contracts

**SQL Query:**
```sql
SELECT
  c.hash,
  c.pageId,
  s.accountId,
  s.signedAt
FROM signature s
INNER JOIN contract c ON s.contractHash = c.hash
WHERE s.signedAt > DATE_SUB(NOW(6), INTERVAL 7 DAY)
  AND c.deletedAt IS NULL
ORDER BY s.signedAt DESC;
```

**Query Plan:**
- Uses `idx_signedAt` index
- `DATE_SUB(NOW(6), INTERVAL 7 DAY)` for last 7 days
- Efficient time-based filtering

### 7. Aggregate Statistics

**Purpose**: Count signatures per page

**SQL Query:**
```sql
SELECT
  c.pageId,
  COUNT(s.accountId) as signatureCount,
  MAX(s.signedAt) as lastModified  -- Derived: last modified = most recent signature
FROM contract c
LEFT JOIN signature s ON c.hash = s.contractHash
WHERE c.deletedAt IS NULL
GROUP BY c.pageId
ORDER BY signatureCount DESC;
```

**Features:**
- Aggregate functions (COUNT, MAX)
- `MAX(s.signedAt)` calculates last modified time (replaces redundant column)
- GROUP BY for per-page statistics
- Works with TIMESTAMP columns for date calculations

### 8. Get Last Modified Time

**Purpose**: Calculate when a contract was last modified

**SQL Query:**
```sql
-- Option 1: For a single contract
SELECT MAX(signedAt) as lastModified
FROM signature
WHERE contractHash = ?;

-- Option 2: With fallback to createdAt if no signatures
SELECT
  c.createdAt,
  COALESCE(MAX(s.signedAt), c.createdAt) as lastModified
FROM contract c
LEFT JOIN signature s ON c.hash = s.contractHash
WHERE c.hash = ?
GROUP BY c.hash, c.createdAt;
```

**Notes:**
- `COALESCE(MAX(s.signedAt), c.createdAt)` returns createdAt if no signatures exist
- No redundant storage - always calculated from actual data
- Guaranteed to be accurate (cannot get out of sync)

---

## TIMESTAMP Operations Reference

### Common Date Functions

```sql
-- Current timestamp with microseconds
NOW(6)

-- Current date (no time)
CURDATE()

-- Date arithmetic
DATE_ADD(NOW(6), INTERVAL 30 DAY)    -- 30 days in future
DATE_SUB(NOW(6), INTERVAL 7 DAY)     -- 7 days ago
DATE_SUB(NOW(6), INTERVAL 1 HOUR)    -- 1 hour ago

-- Extract parts
YEAR(createdAt)
MONTH(createdAt)
DAY(createdAt)
HOUR(signedAt)

-- Format timestamp
DATE_FORMAT(signedAt, '%Y-%m-%d %H:%i:%s')

-- Comparison
WHERE createdAt > '2024-01-01 00:00:00'
WHERE signedAt BETWEEN '2024-01-01' AND '2024-12-31'

-- NULL checks
WHERE deletedAt IS NULL        -- Active contracts
WHERE deletedAt IS NOT NULL    -- Deleted contracts
```

### Application Layer Conversion

**JavaScript to SQL:**
```javascript
// Automatic conversion by driver
const now = new Date();
await sql.execute('INSERT INTO contract (createdAt) VALUES (?)', [now]);

// Or use SQL function
await sql.execute('INSERT INTO contract (createdAt) VALUES (NOW(6))');
```

**SQL to JavaScript:**
```javascript
const results = await sql.execute('SELECT createdAt FROM contract WHERE hash = ?', [hash]);
const createdAt = new Date(results[0].createdAt); // Automatic parsing
console.log(createdAt.toISOString()); // "2024-09-19T06:40:34.999Z"
```

---

## Foreign Key Relationships (Manual)

### Important: Forge SQL Limitation

From [Forge SQL documentation](https://developer.atlassian.com/platform/forge/storage-reference/sql/):

> "Foreign keys are not supported. You can still perform JOIN operations, but DELETE operations will not be cascaded."

### Relationship Definition

```
contract (1) ----< (N) signature
   hash     ←──── contractHash
```

**Logical relationship (not enforced by database):**
- `signature.contractHash` references `contract.hash`
- Application code must enforce referential integrity
- Manual cascade operations required

### Manual Cascade Delete Pattern

**Application Code:**
```javascript
async function deleteContract(hash) {
  // Step 1: Delete signatures first (child records)
  await sql.execute(
    'DELETE FROM signature WHERE contractHash = ?',
    [hash]
  );

  // Step 2: Delete contract (parent record)
  await sql.execute(
    'DELETE FROM contract WHERE hash = ?',
    [hash]
  );
}
```

**Important:**
- Order matters: delete child records before parent
- No database-level CASCADE enforcement
- Application must handle orphaned records
- Soft deletes recommended for audit trail

---

## Data Integrity Constraints

### Database-Level Constraints

1. **PRIMARY KEY Constraints**
   - `contract.hash` - Unique identifier for contracts
   - `signature.(contractHash, accountId)` - Compound natural key
     - Ensures one user can sign a contract only once
     - Database-enforced (more reliable than application logic)
     - No redundant UNIQUE constraint needed

2. **NOT NULL Constraints**
   - All columns except `deletedAt` are NOT NULL
   - Prevents incomplete data insertion

3. **DEFAULT Values**
   - Timestamps default to `CURRENT_TIMESTAMP(6)`
   - `deletedAt` defaults to NULL (active contract)

4. **Derived Values**
   - Last modified timestamp calculated as `MAX(signedAt)` from signatures
   - No denormalization needed - kept in sync automatically

### Application-Level Constraints

Since Forge SQL doesn't support foreign keys:

1. **Referential Integrity**
   - Verify contract exists before inserting signature
   - Handle orphaned signatures during cleanup
   - Validate contractHash format (64 hex characters)

2. **Cascade Operations**
   - Manually delete signatures when deleting contract
   - Implement in storage layer (transparent to business logic)

3. **Data Validation**
   - Hash format: `/^[a-f0-9]{64}$/i`
   - PageId: Positive BIGINT
   - AccountId: Non-empty string with `:` separator
   - Timestamps: Valid TIMESTAMP range (1970-2038)

---

## Performance Considerations

### Index Strategy

**All queries use indexes:**

| Query Pattern | Index Used | Scan Type |
|---------------|-----------|-----------|
| `WHERE hash = ?` | PRIMARY KEY | Const (single row) |
| `WHERE pageId = ?` | idx_pageId | Index scan |
| `WHERE deletedAt IS NULL` | idx_deletedAt | Index scan |
| `WHERE accountId = ?` | idx_accountId | Index scan |
| `WHERE signedAt > ?` | idx_signedAt | Range scan |
| `JOIN ON contractHash` | idx_contract | Index lookup |

**Verify with EXPLAIN:**
```sql
EXPLAIN SELECT * FROM contract WHERE hash = ?;
-- Expected: type=const, key=PRIMARY
```

### Row Size Considerations

**Forge SQL Limit:** Maximum 6 MiB per row (configurable to 120 MiB)

**Normalized Schema Advantages:**
- Each signature is separate row (~250 bytes)
- No row size issues even with thousands of signatures
- Scales linearly with data growth

**Estimated Sizes:**
- contract row: ~150 bytes
- signature row: ~250 bytes
- 1,000 signatures: ~250 KB (well under limit)

### Query Performance

**Expected Query Times:**
- Hash lookup: ~10-20ms (indexed, single row)
- PageId query: ~20-50ms (indexed, multiple rows)
- JOIN query: ~30-60ms (both tables indexed)
- Bulk delete: ~100-500ms (depends on batch size)
- Date range query: ~50-200ms (indexed, depends on range)

**Optimization Tips:**
1. Use parameterized queries (prevents SQL injection, enables query caching)
2. Limit result sets for large queries
3. Use covering indexes when possible
4. Consider pagination for admin views

---

## Schema Evolution & Versioning

### Migration Strategy

See [sql-migration-guide.md](./sql-migration-guide.md) for complete details.

**Version History:**

| Version | Description | Migration Script |
|---------|-------------|------------------|
| v1.0.0 | Initial schema | `001_initial_schema.sql` |

### Future Schema Changes

**Adding Columns:**
```sql
ALTER TABLE contract ADD COLUMN title VARCHAR(255) COMMENT 'Page title';
```

**Adding Indexes:**
```sql
CREATE INDEX idx_createdAt ON contract(createdAt);
```

**Modifying Columns:**
```sql
ALTER TABLE signature MODIFY accountId VARCHAR(256);
```

**Best Practices:**
- Never drop columns with data (add new columns instead)
- Use migration runner for all schema changes
- Test migrations in staging first
- Document all changes in this file

---

## Security Considerations

### SQL Injection Prevention

**Always use parameterized queries:**
```javascript
// ✅ SAFE: Parameterized query
await sql.execute(
  'SELECT * FROM contract WHERE hash = ?',
  [hash]
);

// ❌ UNSAFE: String interpolation
await sql.execute(
  `SELECT * FROM contract WHERE hash = '${hash}'`
);
```

### Data Access Control

- Forge SQL enforces app-level isolation (separate database per installation)
- No cross-tenant data access possible
- Application code must enforce user permissions

### Sensitive Data

- No PII stored directly
- accountId is Atlassian's internal identifier
- pageId is numeric identifier (not page content)
- Hash is cryptographic (SHA-256, cannot reverse)

---

## References

### Internal Documentation
- [sql-migration-guide.md](./sql-migration-guide.md) - Migration implementation
- [sql-data-access-layer.md](./sql-data-access-layer.md) - Repository pattern
- [backup-restore-spec.md](./backup-restore-spec.md) - Data export/import

### External Documentation
- [Forge SQL Overview](https://developer.atlassian.com/platform/forge/storage-reference/sql/)
- [Forge SQL Tutorial](https://developer.atlassian.com/platform/forge/storage-reference/sql-tutorial/)
- [TiDB Data Types](https://docs.pingcap.com/tidb/stable/data-type-overview/)
- [TiDB Date and Time Types](https://docs.pingcap.com/tidb/stable/data-type-date-and-time/)
- [MySQL TIMESTAMP](https://dev.mysql.com/doc/refman/8.4/en/datetime.html)

---

## Appendix: Complete Schema Script

```sql
-- Digital Signature Application - SQL Schema
-- Version: 1.0.0
-- Platform: Forge SQL (TiDB/MySQL-compatible)
-- Breaking change: Complete replacement of KVS storage

-- Table: contract
CREATE TABLE IF NOT EXISTS contract (
  hash VARCHAR(64) PRIMARY KEY COMMENT 'SHA-256 hash of pageId:title:body',
  pageId BIGINT NOT NULL COMMENT 'Confluence page ID',
  createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'When contract was created',
  deletedAt TIMESTAMP(6) NULL DEFAULT NULL COMMENT 'When page was deleted, NULL if active'
) COMMENT = 'Contract entities representing signed Confluence pages';

-- Indexes for contract
CREATE INDEX idx_pageId ON contract(pageId);
CREATE INDEX idx_deletedAt ON contract(deletedAt);

-- Table: signature
CREATE TABLE IF NOT EXISTS signature (
  contractHash VARCHAR(64) NOT NULL COMMENT 'Reference to contract.hash',
  accountId VARCHAR(128) NOT NULL COMMENT 'Atlassian account ID of signer',
  signedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'When user signed (UTC, microseconds)',
  PRIMARY KEY (contractHash, accountId)
) COMMENT = 'Individual signatures for contracts';

-- Indexes for signature
CREATE INDEX idx_contract ON signature(contractHash);
CREATE INDEX idx_accountId ON signature(accountId);
CREATE INDEX idx_signedAt ON signature(signedAt);
```

---

**Document Version:** 2.1.0
**Last Updated:** 2025-11-23
**Author:** Digital Signature Development Team
**Change Type:** Breaking Change - Complete KVS Replacement with Natural Keys
