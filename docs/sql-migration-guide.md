# SQL Migration Guide

## Overview

This guide covers the implementation of SQL schema migrations using Forge's migration system. It includes schema creation, data migration from KVS to SQL, and deployment strategies.

## Context

- **Source**: Forge Custom Entities (KVS) - see [signatureStore.js](../src/storage/signatureStore.js)
- **Target**: Forge SQL (TiDB/MySQL-compatible)
- **Schema**: See [sql-schema-design.md](./sql-schema-design.md)
- **Data Access Layer**: See [sql-data-access-layer.md](./sql-data-access-layer.md)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Migration System Overview](#migration-system-overview)
3. [Project Structure](#project-structure)
4. [Schema Migration Implementation](#schema-migration-implementation)
5. [Data Migration from KVS to SQL](#data-migration-from-kvs-to-sql)
6. [Migration Versioning](#migration-versioning)
7. [Testing Migrations](#testing-migrations)
8. [Production Deployment](#production-deployment)
9. [Rollback Strategies](#rollback-strategies)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### 1. Add Forge SQL Dependency

**Update `package.json`:**

```json
{
  "dependencies": {
    "@forge/bridge": "5.5.0",
    "@forge/kvs": "^1.0.0",
    "@forge/react": "11.4.0",
    "@forge/resolver": "1.7.0",
    "@forge/sql": "^1.0.0"  // ← ADD THIS
  }
}
```

**Install dependencies:**
```bash
npm install
```

### 2. Update Permissions

**Verify `manifest.yml` has storage permission:**

```yaml
permissions:
  scopes:
    - read:confluence-user
    - read:confluence-content.all
    - storage:app  # Required for both KVS and SQL
```

**Note:** The `storage:app` permission covers both KVS and SQL storage.

### 3. Forge CLI Requirements

- Forge CLI version 10.3.0 or higher
- Check version: `forge --version`
- Update if needed: `npm install -g @forge/cli`

---

## Migration System Overview

### Forge Migration Runner

Forge SQL uses a **migration runner** system to manage schema changes:

- **Purpose**: Version-controlled database schema evolution
- **Execution**: Migrations run automatically during app deployment
- **Idempotency**: Each migration runs exactly once per installation
- **Order**: Migrations execute in the order they're enqueued
- **Persistence**: Migration status tracked per installation

### Key Concepts

1. **Migration ID**: Unique identifier for each migration (e.g., `v001_initial_schema`)
2. **Migration Script**: SQL DDL statements to execute
3. **Migration Queue**: Ordered list of migrations to run
4. **Migration Status**: Tracked per installation (pending, running, completed, failed)

### Migration API

```javascript
import { migrationRunner } from '@forge/sql';

// Enqueue a migration
await migrationRunner.enqueue('migration-id', 'SQL statement');

// Run all queued migrations
await migrationRunner.run();
```

**Important:**
- Migrations are **permanent** - they cannot be undone via the runner
- Use `CREATE TABLE IF NOT EXISTS` for idempotency
- Test migrations thoroughly before production deployment

---

## Project Structure

### Recommended File Organization

```
src/
├── storage/
│   ├── signatureStore.js          # Current KVS implementation
│   ├── signatureStoreSql.js       # NEW: SQL implementation
│   ├── migrations/                # NEW: Migration scripts
│   │   ├── index.js               # Migration runner entry point
│   │   ├── 001_initial_schema.js  # Schema creation
│   │   └── 002_migrate_data.js    # Data migration (if needed)
│   └── index.js                   # Storage abstraction (optional)
```

### Migration File Naming Convention

**Pattern:** `<number>_<description>.js`

Examples:
- `001_initial_schema.js` - Initial table creation
- `002_add_indexes.js` - Additional indexes
- `003_alter_columns.js` - Column modifications
- `999_migrate_from_kvs.js` - Data migration script

**Best Practices:**
- Use 3-digit numbers (001, 002, 003) for easy ordering
- Descriptive names
- One logical change per migration
- Keep migration scripts in version control

---

## Schema Migration Implementation

### Step 1: Create Migration Files

#### File: `src/storage/migrations/001_initial_schema.js`

```javascript
/**
 * Initial SQL schema migration
 * Creates contract and signature tables with indexes
 */

// Schema version: 1.0.0
// See: docs/sql-schema-design.md

export const MIGRATION_ID_SCHEMA = 'v001_create_initial_schema';

export const CREATE_CONTRACT_TABLE = `
  CREATE TABLE IF NOT EXISTS contract (
    hash VARCHAR(64) PRIMARY KEY COMMENT 'SHA-256 hash of pageId:title:body',
    pageId BIGINT NOT NULL COMMENT 'Confluence page ID',
    createdAt BIGINT NOT NULL COMMENT 'Unix timestamp (seconds) when first signature added',
    lastModified BIGINT NOT NULL COMMENT 'Unix timestamp (seconds) when last signature added',
    deletedAt BIGINT NOT NULL DEFAULT 0 COMMENT 'Unix timestamp (seconds) when page deleted, 0 if active'
  ) COMMENT = 'Contract entities representing signed Confluence pages'
`;

export const CREATE_SIGNATURE_TABLE = `
  CREATE TABLE IF NOT EXISTS signature (
    id BIGINT PRIMARY KEY AUTO_RANDOM(4, 54) COMMENT 'Auto-generated ID (JavaScript-safe range)',
    contractHash VARCHAR(64) NOT NULL COMMENT 'Reference to contract.hash',
    accountId VARCHAR(128) NOT NULL COMMENT 'Atlassian account ID of signer',
    signedAt BIGINT NOT NULL COMMENT 'Unix timestamp (seconds) when user signed'
  ) COMMENT = 'Individual signatures for contracts'
`;

export const CREATE_CONTRACT_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_pageId ON contract(pageId)',
  'CREATE INDEX IF NOT EXISTS idx_deletedAt ON contract(deletedAt)'
];

export const CREATE_SIGNATURE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_contract ON signature(contractHash)',
  'CREATE INDEX IF NOT EXISTS idx_accountId ON signature(accountId)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_signature ON signature(contractHash, accountId)'
];

/**
 * Combines all schema creation statements
 * @returns {string[]} Array of SQL statements to execute
 */
export function getSchemaStatements() {
  return [
    CREATE_CONTRACT_TABLE,
    ...CREATE_CONTRACT_INDEXES,
    CREATE_SIGNATURE_TABLE,
    ...CREATE_SIGNATURE_INDEXES
  ];
}
```

#### File: `src/storage/migrations/index.js`

```javascript
/**
 * Migration runner entry point
 * Registers and executes all migrations
 */

import { migrationRunner } from '@forge/sql';
import {
  MIGRATION_ID_SCHEMA,
  getSchemaStatements
} from './001_initial_schema';

/**
 * Runs all database migrations
 * Should be called during app initialization
 *
 * @returns {Promise<void>}
 * @throws {Error} If migration fails
 */
export async function runMigrations() {
  try {
    console.log('Starting database migrations...');

    // Enqueue schema migration
    const schemaStatements = getSchemaStatements();
    for (const statement of schemaStatements) {
      await migrationRunner.enqueue(MIGRATION_ID_SCHEMA, statement);
    }

    // Run all queued migrations
    await migrationRunner.run();

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw new Error(`Database migration failed: ${error.message}`);
  }
}

/**
 * Alternative: Enqueue migrations without running
 * Useful for testing or staged deployments
 *
 * @returns {Promise<void>}
 */
export async function enqueueMigrations() {
  const schemaStatements = getSchemaStatements();
  for (const statement of schemaStatements) {
    await migrationRunner.enqueue(MIGRATION_ID_SCHEMA, statement);
  }
}
```

### Step 2: Integrate Migration Runner

#### Option A: Run Migrations in Resolver (Recommended for Initial Setup)

**File: `src/resolvers/index.js`**

```javascript
import Resolver from '@forge/resolver';
import { runMigrations } from '../storage/migrations';

const resolver = new Resolver();

// Initialize database on first resolver call
let migrationsRun = false;

resolver.define('init-database', async () => {
  if (!migrationsRun) {
    await runMigrations();
    migrationsRun = true;
  }
  return { success: true };
});

// Your existing resolvers...
resolver.define('sign', signResolver);
resolver.define('getSignatures', getSignaturesResolver);
resolver.define('checkAuthorization', checkAuthorizationResolver);

export const handler = resolver.getDefinitions();
```

#### Option B: Run Migrations in Scheduled Trigger (Alternative)

**File: `manifest.yml`**

```yaml
function:
  - key: run-migrations
    handler: migrations.handler

triggers:
  - key: migrations-trigger
    function: run-migrations
    events:
      - avi:forge:installed:app
```

**File: `src/migrations.js`**

```javascript
import { runMigrations } from './storage/migrations';

export async function handler(event, context) {
  try {
    await runMigrations();
    return { success: true };
  } catch (error) {
    console.error('Migration trigger failed:', error);
    return { success: false, error: error.message };
  }
}
```

### Step 3: Deploy with Migrations

```bash
# Deploy to development environment
forge deploy --environment development

# Migrations run automatically on first deployment
# Check logs for migration status
forge logs --environment development
```

**Expected Output:**
```
Starting database migrations...
Migration v001_create_initial_schema: Running...
Migration v001_create_initial_schema: Completed
Database migrations completed successfully
```

---

## Data Migration from KVS to SQL

### Migration Strategy Overview

**Two Approaches:**

1. **Admin-Triggered Migration** (Recommended)
   - Create admin UI for controlled migration
   - Operator triggers migration manually
   - Progress tracking and error handling
   - Based on [backup-restore-spec.md](./backup-restore-spec.md)

2. **Automatic Migration** (Alternative)
   - Runs during app deployment
   - Background job migrates data automatically
   - Risk: timeout for large datasets

**Recommendation:** Use Admin-Triggered Migration for control and visibility.

### Admin-Triggered Migration Implementation

#### File: `src/storage/migrations/002_migrate_from_kvs.js`

```javascript
/**
 * Data migration from KVS to SQL
 * Reads all KVS entities and inserts into SQL tables
 */

import { sql } from '@forge/sql';
import kvs from '@forge/kvs';

const ENTITY_NAME = 'signature';
const BATCH_SIZE = 100;

/**
 * Migrates all KVS entities to SQL
 *
 * @returns {Promise<{migrated: number, errors: number}>}
 */
export async function migrateFromKvsToSql() {
  let migratedCount = 0;
  let errorCount = 0;
  let cursor = undefined;

  console.log('Starting KVS to SQL migration...');

  try {
    do {
      // Fetch batch of KVS entities
      const results = await kvs.entity(ENTITY_NAME)
        .query()
        .limit(BATCH_SIZE)
        .cursor(cursor)
        .getMany();

      console.log(`Processing batch: ${results.results.length} entities`);

      // Process each entity
      for (const entity of results.results) {
        try {
          await migrateEntity(entity);
          migratedCount++;
        } catch (error) {
          console.error(`Failed to migrate entity ${entity.hash}:`, error);
          errorCount++;
        }
      }

      cursor = results.nextCursor;
    } while (cursor);

    console.log(`Migration complete: ${migratedCount} migrated, ${errorCount} errors`);

    return { migrated: migratedCount, errors: errorCount };
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

/**
 * Migrates a single KVS entity to SQL
 *
 * @param {Object} kvsEntity - KVS entity to migrate
 * @returns {Promise<void>}
 */
async function migrateEntity(kvsEntity) {
  const { hash, pageId, signatures, createdAt, lastModified, deletedAt } = kvsEntity;

  // Insert contract
  await sql.execute(`
    INSERT INTO contract (hash, pageId, createdAt, lastModified, deletedAt)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      lastModified = VALUES(lastModified),
      deletedAt = VALUES(deletedAt)
  `, [hash, pageId, createdAt, lastModified, deletedAt || 0]);

  // Insert signatures
  if (signatures && signatures.length > 0) {
    for (const sig of signatures) {
      try {
        await sql.execute(`
          INSERT IGNORE INTO signature (contractHash, accountId, signedAt)
          VALUES (?, ?, ?)
        `, [hash, sig.accountId, sig.signedAt]);
      } catch (error) {
        // Ignore duplicate key errors (signature already exists)
        if (!error.message.includes('Duplicate entry')) {
          throw error;
        }
      }
    }
  }
}

/**
 * Verifies migration integrity
 * Compares KVS and SQL counts
 *
 * @returns {Promise<{kvsCount: number, sqlCount: number, match: boolean}>}
 */
export async function verifyMigration() {
  // Count KVS entities
  let kvsCount = 0;
  let cursor = undefined;

  do {
    const results = await kvs.entity(ENTITY_NAME)
      .query()
      .limit(BATCH_SIZE)
      .cursor(cursor)
      .getMany();

    kvsCount += results.results.length;
    cursor = results.nextCursor;
  } while (cursor);

  // Count SQL contracts
  const sqlResult = await sql.execute('SELECT COUNT(*) as count FROM contract');
  const sqlCount = sqlResult[0].count;

  return {
    kvsCount,
    sqlCount,
    match: kvsCount === sqlCount
  };
}
```

#### File: `src/resolvers/migrateDataResolver.js`

```javascript
/**
 * Admin resolver for data migration
 * Triggered from admin UI
 */

import { migrateFromKvsToSql, verifyMigration } from '../storage/migrations/002_migrate_from_kvs';
import { successResponse, errorResponse } from '../utils/responseHelper';

/**
 * Triggers data migration from KVS to SQL
 *
 * @param {Object} req - Resolver request
 * @returns {Promise<Object>} Migration result
 */
export async function migrateDataResolver(req) {
  try {
    console.log('Data migration triggered by admin');

    // Run migration
    const result = await migrateFromKvsToSql();

    // Verify migration
    const verification = await verifyMigration();

    return successResponse({
      migrated: result.migrated,
      errors: result.errors,
      verification
    });
  } catch (error) {
    console.error('Migration resolver failed:', error);
    return errorResponse(error.message);
  }
}

/**
 * Checks migration status
 *
 * @returns {Promise<Object>} Current status
 */
export async function checkMigrationStatus() {
  try {
    const verification = await verifyMigration();
    return successResponse(verification);
  } catch (error) {
    return errorResponse(error.message);
  }
}
```

#### File: `src/resolvers/index.js`

```javascript
import Resolver from '@forge/resolver';
import { migrateDataResolver, checkMigrationStatus } from './migrateDataResolver';

const resolver = new Resolver();

// Admin migration resolvers
resolver.define('migrate-data', migrateDataResolver);
resolver.define('check-migration-status', checkMigrationStatus);

// Existing resolvers...
resolver.define('sign', signResolver);
resolver.define('getSignatures', getSignaturesResolver);

export const handler = resolver.getDefinitions();
```

#### Admin UI Integration

**File: `src/frontend/admin/MigrationPanel.jsx`**

```jsx
import React, { useState } from 'react';
import { invoke } from '@forge/bridge';

export default function MigrationPanel() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const checkStatus = async () => {
    setLoading(true);
    const result = await invoke('check-migration-status');
    setStatus(result.data);
    setLoading(false);
  };

  const runMigration = async () => {
    if (!confirm('Start data migration from KVS to SQL?')) return;

    setLoading(true);
    const result = await invoke('migrate-data');
    setStatus(result.data);
    setLoading(false);

    alert(`Migration complete: ${result.data.migrated} migrated, ${result.data.errors} errors`);
  };

  return (
    <div>
      <h2>KVS to SQL Migration</h2>
      <button onClick={checkStatus} disabled={loading}>
        Check Status
      </button>
      <button onClick={runMigration} disabled={loading}>
        Run Migration
      </button>

      {status && (
        <div>
          <h3>Status</h3>
          <p>KVS Entities: {status.verification.kvsCount}</p>
          <p>SQL Contracts: {status.verification.sqlCount}</p>
          <p>Match: {status.verification.match ? '✅ Yes' : '❌ No'}</p>
        </div>
      )}
    </div>
  );
}
```

### Automatic Migration Implementation (Alternative)

If you prefer automatic migration during deployment:

```javascript
// In src/storage/migrations/index.js

import { migrationRunner } from '@forge/sql';
import { migrateFromKvsToSql } from './002_migrate_from_kvs';

export async function runMigrations() {
  // Run schema migrations
  await runSchemaMigrations();

  // Run data migration (once)
  const migrationFlag = 'data_migration_completed';
  const flagExists = await checkMigrationFlag(migrationFlag);

  if (!flagExists) {
    console.log('Running data migration from KVS to SQL...');
    await migrateFromKvsToSql();
    await setMigrationFlag(migrationFlag);
    console.log('Data migration completed');
  }
}

async function checkMigrationFlag(flagName) {
  // Use KVS to track migration status
  const kvs = require('@forge/kvs').default;
  const flag = await kvs.entity('_migrations').get(flagName);
  return !!flag;
}

async function setMigrationFlag(flagName) {
  const kvs = require('@forge/kvs').default;
  await kvs.entity('_migrations').set(flagName, { completed: true, timestamp: Date.now() });
}
```

---

## Migration Versioning

### Version Tracking Strategy

**Approach:** Use migration IDs to track applied migrations.

**Benefits:**
- Each migration runs exactly once per installation
- Safe to redeploy without re-running migrations
- Easy to add new migrations over time

### Migration ID Convention

```
v<version>_<description>
```

**Examples:**
- `v001_create_initial_schema` - Version 1, initial schema
- `v002_add_title_column` - Version 2, add title to contract
- `v003_create_audit_table` - Version 3, new audit table

### Adding New Migrations

**Process:**
1. Create new migration file with incremented version
2. Export migration statements
3. Add to migration runner
4. Test in development
5. Deploy to production

**Example: Adding a new column**

```javascript
// src/storage/migrations/002_add_title_column.js

export const MIGRATION_ID_ADD_TITLE = 'v002_add_title_column';

export const ADD_TITLE_COLUMN = `
  ALTER TABLE contract
  ADD COLUMN title VARCHAR(255) COMMENT 'Page title for display'
`;

// Update migrations/index.js
import { MIGRATION_ID_ADD_TITLE, ADD_TITLE_COLUMN } from './002_add_title_column';

export async function runMigrations() {
  // Schema v1
  await migrationRunner.enqueue(MIGRATION_ID_SCHEMA, CREATE_CONTRACT_TABLE);
  // ...

  // Schema v2 - New column
  await migrationRunner.enqueue(MIGRATION_ID_ADD_TITLE, ADD_TITLE_COLUMN);

  await migrationRunner.run();
}
```

---

## Testing Migrations

### Local Development Testing

#### 1. Test Schema Creation

```bash
# Deploy to development
forge deploy --environment development

# Check logs for migration status
forge logs --environment development | grep -i migration

# Verify tables created
# (Use SQL client or resolver to query schema)
```

**Test Query:**
```javascript
// In a resolver
const tables = await sql.execute(`
  SHOW TABLES
`);
console.log('Tables:', tables);
```

#### 2. Test Data Migration

```javascript
// Create test data in KVS
import kvs from '@forge/kvs';

const testEntity = {
  hash: 'test123abc',
  pageId: '123456',
  signatures: [
    { accountId: '557058:test-uuid', signedAt: 1700000000 }
  ],
  createdAt: 1700000000,
  lastModified: 1700000000,
  deletedAt: 0
};

await kvs.entity('signature').set('test123abc', testEntity);

// Run migration
await migrateFromKvsToSql();

// Verify SQL data
const contract = await sql.execute(
  'SELECT * FROM contract WHERE hash = ?',
  ['test123abc']
);
console.log('Migrated contract:', contract);

const signatures = await sql.execute(
  'SELECT * FROM signature WHERE contractHash = ?',
  ['test123abc']
);
console.log('Migrated signatures:', signatures);
```

### Staging Environment Testing

1. **Deploy to staging:**
   ```bash
   forge deploy --environment staging
   ```

2. **Verify migration logs:**
   ```bash
   forge logs --environment staging
   ```

3. **Test with real data:**
   - Use production-like data volume
   - Verify all entities migrated
   - Check query performance
   - Validate data integrity

4. **Performance testing:**
   - Measure migration duration
   - Monitor resource usage
   - Test with large datasets

### Integration Testing

**Playwright Test Example:**

```javascript
// tests/e2e/migration.spec.js

import { test, expect } from '@playwright/test';

test.describe('SQL Migration', () => {
  test('should migrate KVS data to SQL', async ({ page }) => {
    // Navigate to admin panel
    await page.goto('/admin/migration');

    // Click check status
    await page.click('button:has-text("Check Status")');

    // Verify status displayed
    await expect(page.locator('text=KVS Entities:')).toBeVisible();

    // Run migration
    await page.click('button:has-text("Run Migration")');

    // Wait for completion
    await page.waitForSelector('text=Migration complete');

    // Verify success
    const status = await page.textContent('[data-testid="migration-status"]');
    expect(status).toContain('Match: ✅ Yes');
  });
});
```

---

## Production Deployment

### Pre-Deployment Checklist

- [ ] Schema migrations tested in development
- [ ] Data migration tested in staging
- [ ] Performance benchmarks completed
- [ ] Rollback plan documented
- [ ] Backup of KVS data created (see [backup-restore-spec.md](./backup-restore-spec.md))
- [ ] Team notified of deployment
- [ ] Monitoring configured

### Deployment Process

#### Step 1: Deploy Schema Migrations

```bash
# Deploy to production (schema only, no data migration yet)
forge deploy --environment production

# Monitor logs
forge logs --environment production --tail
```

**Expected behavior:**
- Tables created
- Indexes created
- No data migrated yet (manual trigger)

#### Step 2: Verify Schema

```bash
# Use forge tunnel to test resolvers
forge tunnel --environment production
```

Test schema in browser console:
```javascript
// In browser console
await AP.invoke('check-migration-status');
```

#### Step 3: Trigger Data Migration

**Option A: Admin UI** (Recommended)
1. Navigate to admin panel
2. Click "Check Status" to verify schema
3. Click "Run Migration" to start data migration
4. Monitor progress

**Option B: Resolver** (Alternative)
```bash
# Trigger via curl or postman
curl -X POST https://your-forge-app/migrate-data
```

#### Step 4: Verify Migration

```javascript
await AP.invoke('check-migration-status');
// Should return: { kvsCount: X, sqlCount: X, match: true }
```

#### Step 5: Enable SQL Storage

Update storage implementation to use SQL:

```javascript
// src/storage/index.js
export { putSignature, getSignature, setDeleted, cleanup } from './signatureStoreSql';
```

Redeploy:
```bash
forge deploy --environment production
```

### Post-Deployment Verification

- [ ] All resolvers working with SQL
- [ ] No errors in logs
- [ ] Signature counts match KVS
- [ ] Performance acceptable
- [ ] User functionality unchanged

---

## Rollback Strategies

### Rollback Scenarios

1. **Schema migration failed**
   - Tables not created or incomplete
   - Action: Fix migration script, redeploy

2. **Data migration failed**
   - Some entities not migrated
   - Action: Re-run migration (idempotent)

3. **Performance issues after migration**
   - SQL queries too slow
   - Action: Rollback to KVS

4. **Data integrity issues**
   - Counts don't match
   - Action: Investigate, re-migrate if needed

### Rollback to KVS

**Step 1: Switch storage implementation**

```javascript
// src/storage/index.js
// Revert to KVS
export { putSignature, getSignature, setDeleted, cleanup } from './signatureStore';
```

**Step 2: Redeploy**

```bash
forge deploy --environment production
```

**Step 3: Verify functionality**

- Test all user operations
- Verify KVS data intact
- Monitor logs for errors

### Partial Rollback (Dual Storage)

If you want to keep both systems running:

```javascript
// src/storage/index.js
import * as kvs from './signatureStore';
import * as sql from './signatureStoreSql';

const USE_SQL = process.env.USE_SQL === 'true';

export const putSignature = USE_SQL ? sql.putSignature : kvs.putSignature;
export const getSignature = USE_SQL ? sql.getSignature : kvs.getSignature;
export const setDeleted = USE_SQL ? sql.setDeleted : kvs.setDeleted;
export const cleanup = USE_SQL ? sql.cleanup : kvs.cleanup;
```

Toggle via environment variable:
```bash
forge variables set --environment production USE_SQL true
```

---

## Troubleshooting

### Common Issues

#### Issue: Migration timeout

**Symptom:** Migration fails with timeout error

**Cause:** Large dataset, resolver timeout (25 seconds)

**Solution:** Use async events (900-second timeout) or batch migration

```javascript
// Use scheduled trigger instead of resolver
// manifest.yml
triggers:
  - key: migration-trigger
    function: migrate-data
    events:
      - avi:forge:installed:app
```

#### Issue: Duplicate key error

**Symptom:** `Duplicate entry for key 'PRIMARY'`

**Cause:** Migration run multiple times

**Solution:** Use `INSERT IGNORE` or `ON DUPLICATE KEY UPDATE`

```sql
INSERT IGNORE INTO contract (hash, pageId, createdAt, lastModified, deletedAt)
VALUES (?, ?, ?, ?, ?);
```

#### Issue: Migration partially completed

**Symptom:** Some entities migrated, some not

**Solution:** Re-run migration (idempotent queries)

```javascript
// Migration is idempotent
await migrateFromKvsToSql();  // Safe to run multiple times
```

#### Issue: Performance degradation after migration

**Symptom:** Queries slower than KVS

**Cause:** Missing indexes or inefficient queries

**Solution:** Verify indexes created, optimize queries

```sql
-- Check indexes
SHOW INDEX FROM contract;
SHOW INDEX FROM signature;

-- Analyze query performance
EXPLAIN SELECT * FROM contract WHERE hash = 'test123';
```

### Debug Techniques

#### 1. Enable Verbose Logging

```javascript
export async function runMigrations() {
  console.log('Starting migrations...');

  console.log('Creating contract table...');
  await migrationRunner.enqueue(MIGRATION_ID_SCHEMA, CREATE_CONTRACT_TABLE);

  console.log('Creating indexes...');
  // ...

  console.log('Running migrations...');
  await migrationRunner.run();

  console.log('Migrations complete');
}
```

#### 2. Query Migration Status

```javascript
// Check if tables exist
const tables = await sql.execute('SHOW TABLES');
console.log('Tables:', tables);

// Check row counts
const contractCount = await sql.execute('SELECT COUNT(*) as count FROM contract');
console.log('Contracts:', contractCount[0].count);
```

#### 3. Compare KVS and SQL Data

```javascript
// Fetch same entity from both storages
const kvsEntity = await kvs.entity('signature').get(hash);
const sqlContract = await sql.execute(
  'SELECT * FROM contract WHERE hash = ?',
  [hash]
);
const sqlSignatures = await sql.execute(
  'SELECT * FROM signature WHERE contractHash = ?',
  [hash]
);

console.log('KVS:', kvsEntity);
console.log('SQL Contract:', sqlContract);
console.log('SQL Signatures:', sqlSignatures);
```

---

## References

### Internal Documentation
- [sql-schema-design.md](./sql-schema-design.md) - Complete schema definition
- [sql-data-access-layer.md](./sql-data-access-layer.md) - Repository implementation
- [backup-restore-spec.md](./backup-restore-spec.md) - Data backup/restore format
- [signatureStore.js](../src/storage/signatureStore.js) - Current KVS implementation

### External Documentation
- [Forge SQL Migration Guide](https://developer.atlassian.com/platform/forge/storage-reference/sql-migration-guide/)
- [Forge SQL Schema Management](https://developer.atlassian.com/platform/forge/storage-reference/sql-api-schema/)
- [Forge SQL Tutorial](https://developer.atlassian.com/platform/forge/storage-reference/sql-tutorial/)
- [TiDB Migration Overview](https://docs.pingcap.com/tidb/stable/migration-overview/)

---

## Appendix: Complete Migration Example

Here's a complete, production-ready migration implementation:

```javascript
// src/storage/migrations/index.js

import { migrationRunner } from '@forge/sql';
import { getSchemaStatements, MIGRATION_ID_SCHEMA } from './001_initial_schema';

/**
 * Runs all database migrations
 * Safe to call multiple times (idempotent)
 */
export async function runMigrations() {
  try {
    console.log('=== Starting Database Migrations ===');

    // Version 1: Initial schema
    console.log('Enqueuing schema migration...');
    const statements = getSchemaStatements();

    for (const statement of statements) {
      await migrationRunner.enqueue(MIGRATION_ID_SCHEMA, statement);
    }

    // Execute all migrations
    console.log('Executing migrations...');
    await migrationRunner.run();

    console.log('=== Migrations Completed Successfully ===');
    return { success: true };
  } catch (error) {
    console.error('=== Migration Failed ===');
    console.error('Error:', error);
    throw error;
  }
}
```

---

**Document Version:** 1.0.0
**Last Updated:** 2025-11-23
**Author:** Digital Signature Development Team
