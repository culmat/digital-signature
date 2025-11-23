/**
 * SQL Schema Migrations for Digital Signatures
 *
 * See: docs/sql-schema-design.md
 */

import { migrationRunner } from '@forge/sql';

// Table: contract
export const CREATE_CONTRACT_TABLE = `
  CREATE TABLE IF NOT EXISTS contract (
    hash VARCHAR(64) PRIMARY KEY COMMENT 'SHA-256 hash of pageId:title:body',
    pageId BIGINT NOT NULL COMMENT 'Confluence page ID',
    createdAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'When contract was created',
    deletedAt TIMESTAMP(6) NULL DEFAULT NULL COMMENT 'When page was deleted, NULL if active'
  ) COMMENT = 'Contract entities representing signed Confluence pages'
`;

// Indexes for contract table
export const CREATE_CONTRACT_INDEX_PAGE_ID = `
  CREATE INDEX IF NOT EXISTS idx_pageId ON contract(pageId)
`;

export const CREATE_CONTRACT_INDEX_DELETED_AT = `
  CREATE INDEX IF NOT EXISTS idx_deletedAt ON contract(deletedAt)
`;

// Table: signature
export const CREATE_SIGNATURE_TABLE = `
  CREATE TABLE IF NOT EXISTS signature (
    contractHash VARCHAR(64) NOT NULL COMMENT 'Reference to contract.hash',
    accountId VARCHAR(128) NOT NULL COMMENT 'Atlassian account ID of signer',
    signedAt TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'When user signed (UTC, microseconds)',
    PRIMARY KEY (contractHash, accountId)
  ) COMMENT = 'Individual signatures for contracts'
`;

// Indexes for signature table
export const CREATE_SIGNATURE_INDEX_CONTRACT = `
  CREATE INDEX IF NOT EXISTS idx_contract ON signature(contractHash)
`;

export const CREATE_SIGNATURE_INDEX_ACCOUNT_ID = `
  CREATE INDEX IF NOT EXISTS idx_accountId ON signature(accountId)
`;

export const CREATE_SIGNATURE_INDEX_SIGNED_AT = `
  CREATE INDEX IF NOT EXISTS idx_signedAt ON signature(signedAt)
`;

// Enqueue all migrations in order
const migrations = migrationRunner
  .enqueue('v001_create_contract_table', CREATE_CONTRACT_TABLE)
  .enqueue('v002_create_contract_index_page_id', CREATE_CONTRACT_INDEX_PAGE_ID)
  .enqueue('v003_create_contract_index_deleted_at', CREATE_CONTRACT_INDEX_DELETED_AT)
  .enqueue('v004_create_signature_table', CREATE_SIGNATURE_TABLE)
  .enqueue('v005_create_signature_index_contract', CREATE_SIGNATURE_INDEX_CONTRACT)
  .enqueue('v006_create_signature_index_account_id', CREATE_SIGNATURE_INDEX_ACCOUNT_ID)
  .enqueue('v007_create_signature_index_signed_at', CREATE_SIGNATURE_INDEX_SIGNED_AT);

/**
 * Run all schema migrations
 * Should be called during app initialization
 *
 * @returns {Promise<void>}
 */
export async function runSchemaMigrations() {
  try {
    console.log('Starting database schema migrations...');
    const successfulMigrations = await migrations.run();
    console.log('Migrations applied:', successfulMigrations);

    const migrationHistory = (await migrationRunner.list())
      .map((m) => `${m.id}, ${m.name}, ${m.migratedAt.toUTCString()}`)
      .join('\n');
    console.log('Migration history:\nid, name, migrated_at\n', migrationHistory);

    console.log('Database schema migrations completed successfully');
  } catch (error) {
    console.error('Schema migration failed:', error);
    throw new Error(`Database schema migration failed: ${error.message}`);
  }
}
