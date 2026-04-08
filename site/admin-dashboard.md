---
title: Admin Dashboard
description: Backup, restore, statistics, and data management.
section: digital-signature
order: 30
---

# Admin Dashboard

The admin dashboard is available to Confluence site administrators at **Confluence Settings -> Digital Signature Admin**.

It provides statistics, backup and restore.

## Backup

Click **Generate Backup** to download a compressed SQL dump of all signature data. The file is a base64-encoded `.sql.gz` archive.

Keep backups before restoring data or deleting anything.

## Restore

Paste backup data into the restore text area and click **Restore Data**.

The restore accepts:

- Base64-encoded content from a backup download (paste as-is from the backup textarea)
- Plain SQL from a decompressed `.sql.gz` file

The restore is non-destructive by default: it only adds or updates records. It will not delete existing data that is absent from the backup. After the import, a summary shows how many contracts and signatures were added or updated.
