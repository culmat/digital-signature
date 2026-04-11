---
title: Migrating from Server / Data Center
description: What changed, what was removed, and how to migrate your signature data.
section: digital-signature
order: 50
slug: migrating-from-server
---

# Migrating from Server / Data Center

This page is for teams moving from the legacy Confluence Server/DC plugin to the Confluence Cloud app.

## What stays the same

The core signing experience is unchanged:

- Users sign with one click; signatures are permanent and cannot be revoked
- Named signers and signer groups
- Maximum signatures limit
- Visibility limit with "Show more" button
- Signature visibility controls (always, if signatory, if signed)
- Markdown contract content
- Content integrity - each contract version is identified by a SHA-256 hash of its title and body. Changing the content starts a new signing round.
- English, German, French, and Japanese UI

## What has been removed

| Feature | Reason |
| --- | --- |
| **Protected content** (hidden child page revealed on signing) | The Forge platform cannot grant page-level permissions programmatically |
| **Panel toggle** (`panel=true/false`) | The Cloud macro always renders with a panel; the toggle has no equivalent |
| **Email notifications on sign** (automatic emails to configured users) | Forge apps cannot send email via SMTP |
| **In-app notifications** (WorkBox) | Already removed in Confluence 9.x; no equivalent in Cloud |
| **HTML export endpoint** | Not yet available; planned for a future release |

The email list export REST endpoint (`/rest/signature/1.0/emails`) is replaced by the built-in **Email signers** / **Email pending** buttons in the macro.

## Configuration parameter changes

Re-create your macros using the new parameter names and formats:

| Server parameter | Cloud equivalent | Notes |
| --- | --- | --- |
| `title` | `panelTitle` | Renamed |
| `signers` | `signers` | Server used usernames; Cloud uses Atlassian account IDs |
| `signerGroups` | `signerGroups` | Server used group names; Cloud uses group IDs (UUIDs) |
| `inheritSigners` (enum) | `inheritViewers` + `inheritEditors` (two booleans) | "readers only" -> `inheritViewers=true`. "writers only" -> `inheritEditors=true`. "readers and writers" -> both `true`. |
| `maxSignatures: -1` | leave `maxSignatures` empty | -1 is not valid in Cloud; empty means unlimited |
| `visibilityLimit: -1` | leave `visibilityLimit` empty | Same as above |
| `signaturesVisible: always` | `signaturesVisible: ALWAYS` | Casing changed (uppercase in Cloud) |
| `pendingVisible: always` | `pendingVisible: ALWAYS` | Same |
| `notified` | - | Dropped; no email notifications |
| `panel` | - | Dropped; always on |
| `protectedContent` | - | Dropped; feature not available |

### Finding group IDs

Atlassian group IDs are UUIDs, not the display names you may have used on Server. Find them in **Atlassian Admin -> Directory -> Groups** - click a group to see its ID in the URL or details panel.

### Finding account IDs

User account IDs can be found via the Atlassian Admin user list or via the Confluence REST API.

## Petition mode

On Server, petition mode (any user can sign) was activated by setting `signerGroups="*"`.

On Cloud, petition mode is automatic: if you configure no named signers, no groups, and no permission inheritance, any logged-in user who can view the page can sign. The configuration panel shows a notice when petition mode is active.

### Petition mode behavior change

| Config | Server behavior | Cloud behavior |
|--------|----------------|----------------|
| No signers, no groups, no inheritance | Locked (nobody can sign) | Petition mode (anyone can sign) |
| `signerGroups = "*"` | Petition mode | Petition mode |

The macro conversion tool detects locked Server macros and sets `maxSignatures=0` to preserve the locked behavior in Cloud. You can manually edit the macro config to re-enable signing if needed.

## Migrating existing signature data

Signature history from Server can be migrated to Cloud using the Atlassian Cloud Migration Assistant (CMA). The migration happens in three phases:

1. **CMA migration** — Migrates spaces, users, pages, and exports signature data from Bandana to Forge SQL
2. **Macro format conversion** — Converts migrated macro storage format from Server XML to Forge ADF
3. **Verification** — Check that signatures display correctly on Cloud

### Prerequisites

**Server/DC side:**
- Confluence Server 7.x+ or Data Center
- Digital Signature plugin **v9.2.0+** installed (contains the CMA migration listener)
- Admin access to Confluence Server

**Cloud side:**
- Confluence Cloud site with the **Digital Signature for Confluence** app installed via [Atlassian Marketplace](https://marketplace.atlassian.com/apps/1217404/digital-signature-for-confluence)
- Admin access to the Cloud site

### Step 1: Enable CMA dev mode

CMA dev mode is required because the Server plugin version is not published on the Marketplace. Dev mode bypasses the version check and includes any app that implements the migration listener.

On the Server instance:
1. Go to **Administration -> Developer Features** (`/admin/darkfeatures.action`)
2. Add dark feature: `migration-assistant.app-migration.dev-mode`
3. Click **Submit**

Remove dev mode after migration is complete.

### Step 2: Run CMA migration

1. Go to **Administration -> Migration Assistant** (`/admin/migration.action`)
2. Click **Create new migration**
3. Configure:
   - **Name:** descriptive name
   - **Stage:** Production
   - **Destination:** your Cloud site
4. Select what to migrate:
   - **Spaces:** Select the spaces containing signature macros
   - **Users and groups:** Select all (required for user mapping)
   - **Apps:** Skip — dev mode auto-includes the digital-signature app
5. Run pre-flight checks, review, and **Run now**

During migration, the Server plugin exports all signature data as compressed JSONL. The Forge app receives this data, maps Server page IDs and usernames to their Cloud equivalents, and inserts the contracts and signatures into Forge SQL.

### Step 3: Convert macro format

Migrated pages have Server-format XML that Forge can't render. The macro format must be converted to Forge ADF.

The Forge app includes a built-in migration tool on the admin settings page:

1. Open the app's **Admin Settings** page in Confluence Cloud (Confluence Settings -> Digital Signature Admin)
2. Go to the **Migration** tab
3. Optionally enter a **space key** to limit the scan to one space (leave empty for all spaces)
4. Click **Scan for Legacy Macros** — this is read-only and shows a table of pages with unconverted macros
5. Review the results, then click **Convert All**
6. A progress bar tracks the conversion. Each page is updated individually — partial failures don't affect already-converted pages
7. Reload any converted page to verify the macro renders correctly

The conversion is safe and reversible: every page update creates a new version, so you can revert via Confluence page history if needed. No signature data is modified — only the macro XML in the page body changes.

### Step 4: Verify

1. **Check pages** — Open migrated pages on Cloud. Signature macros should render with the contract title and body, signed signatures with date and Cloud username, and correct signing permissions (locked macros should not allow new signatures).

2. **Check statistics** — On the admin settings page, the **Statistics** tab shows contract and signature counts. These should match your Server data (minus any unmapped users).

3. **Check for unmapped users** — If some Server users don't have matching Cloud accounts (different email or not migrated), their signatures are skipped during import. Check Forge logs for details.

### Troubleshooting

**"Error loading the extension!" on migrated pages**
The macro format hasn't been converted yet. Use the Migration tab in Admin Settings (Step 3).

**Signatures don't display (macro renders but empty)**
Contract hashes may not match. Check Forge logs for page ID mapping issues. Re-trigger the app migration from the CMA UI.

**"0 apps will be migrated"**
Dev mode is not enabled. See Step 1.

To be notified of updates, watch the [GitHub repository](https://github.com/culmat/digital-signature) or open an issue there.
