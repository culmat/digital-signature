---
title: Migrating from Server / Data Center
description: What changed, what was removed, and how to re-create your macros.
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

## Existing signature data

Automated migration of signature history from Server to Cloud is planned but not yet available. The Cloud Migration Assistant (CMA) will handle this transfer when ready.

Until migration tooling is available, existing signatures from your Server instance are not carried over. If you need your signature history preserved, hold off on decommissioning your Server instance until migration is supported.

To be notified when migration becomes available, watch the [GitHub repository](https://github.com/baloise/digital-signature) or open an issue there.
