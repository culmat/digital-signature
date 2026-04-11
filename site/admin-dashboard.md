---
title: Admin Dashboard
description: Statistics, backup, restore, migration tools, and data management.
section: digital-signature
order: 30
---

# Admin Dashboard

The admin dashboard is available to Confluence site administrators at **Confluence Settings -> Digital Signature Admin**.

It is organized into tabs:

## Statistics

Shows a summary of all signature data in the database:

- **Total Contracts** — all contracts (active + deleted)
- **Active Contracts** — contracts on existing pages
- **Deleted Contracts** — contracts on trashed/deleted pages (soft-deleted, cleaned up automatically)
- **Total Signatures** — all individual signatures across all contracts

Click **Refresh Statistics** to reload the counts.

## Backup & Restore

### Backup

Click **Generate Backup** to download a compressed SQL dump of all signature data. The file is a base64-encoded `.sql.gz` archive that downloads automatically.

Keep backups before restoring data or deleting anything.

### Restore

Paste backup data into the restore text area and click **Restore Data**.

The restore accepts:

- Base64-encoded content from a backup download (paste as-is from the backup textarea)
- Plain SQL from a decompressed `.sql.gz` file

The restore is non-destructive by default: it only adds or updates records. It will not delete existing data that is absent from the backup. After the import, a summary shows how many contracts and signatures were added or updated.

## Migration

Post-CMA migration tools for converting Server-format signature macros to the Forge ADF format. See [Migrating from Server / Data Center](/digital-signature/migrating-from-server/) for the full migration guide.

1. Optionally enter a **space key** to limit the scan to one space
2. Click **Scan for Legacy Macros** to find pages with unconverted macros
3. Review the results table, then click **Convert All**
4. A progress bar tracks the conversion

The conversion is safe: every page update creates a new version in Confluence, so you can revert via page history. No signature data is modified.

## Danger Zone

When enabled, this tab allows you to permanently delete all signature data. This action is irreversible and requires explicit confirmation.

Always create a backup before using this feature.
