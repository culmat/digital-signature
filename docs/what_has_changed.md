# What Has Changed — Server/DC to Cloud

This document describes the differences between the legacy Confluence Server/Data Center plugin and the new Confluence Cloud (Forge) app.

## What Stays the Same

These features work the same way in Cloud:

- **Signing workflow** — Users sign documents by clicking a button. Signatures are permanent and cannot be revoked.
- **Named signers** — You can restrict signing to specific users.
- **Signer groups** — You can allow members of Confluence groups to sign.
- **Maximum signatures** — You can limit how many users can sign a document.
- **Visibility limit** — You can collapse the signature list and let users expand it with a "Show more" button.
- **Signature visibility controls** — You can control who sees the signed and pending lists (always, if signatory, if signed).
- **Markdown content** — The document body supports markdown formatting.
- **Languages** — English, German, French, and Japanese are supported.
- **Content integrity** — Each document is identified by a SHA-256 hash of its content. If the content changes, a new signature round starts.

## What's New in Cloud

- **Admin dashboard** — Site administrators can view signature statistics, create backups, restore data, and delete all data via a dedicated admin page.
- **PDF and Word export** — Signature panels are included when exporting Confluence pages to PDF or Word.
- **Page lifecycle handling** — When a page is trashed, signatures are soft-deleted. When a page is permanently deleted, signatures are removed.
- **Email links** — You can email signers or pending signers directly from the macro, with a fallback for large recipient lists.

## What's Been Removed

| Feature | Why |
|---------|-----|
| **Protected content** (hidden child page revealed on signing) | The Forge platform does not support granting page-level permissions programmatically in the same way. |
| **Panel mode toggle** (`panel=true/false`) | The Cloud macro always renders with panel styling. The toggle has no equivalent in Forge UI Kit. |
| **Email notifications on sign** (automatic SMTP emails to configured users) | Forge apps do not have access to SMTP. There is no built-in mechanism to send emails from a Forge app. |
| **In-app notifications** (WorkBox) | Removed in Confluence 9.x on Server already. No equivalent in Cloud. |
| **Email list export** (`/rest/signature/1.0/emails`) | Replaced by the built-in mailto links with copy-paste fallback. |
| **HTML export endpoint** (`/rest/signature/1.0/export`) | Not yet available. Planned for a future release. |

## Configuration Differences

If you are re-creating macros manually, note these parameter changes:

| Server parameter | Cloud equivalent | Notes |
|-----------------|-----------------|-------|
| `title` | `title` | Unchanged |
| `signers` | `signers` | Server uses usernames, Cloud uses account IDs |
| `signerGroups` | `signerGroups` | Server uses group names, Cloud uses group IDs |
| `inheritSigners` (enum: none / readers only / writers only / readers and writers) | `inheritViewers` + `inheritEditors` (two booleans) | Split into two separate toggles. "readers only" = inheritViewers on. "writers only" = inheritEditors on. "readers and writers" = both on. |
| `maxSignatures` (default: -1) | `maxSignatures` (optional) | Server uses -1 for unlimited, Cloud leaves the field empty |
| `visibilityLimit` (default: -1) | `visibilityLimit` (optional) | Server uses -1 for unlimited, Cloud leaves the field empty |
| `signaturesVisible` | `signaturesVisible` | Same values, different casing (server: `always`, Cloud: `ALWAYS`) |
| `pendingVisible` | `pendingVisible` | Same values, different casing |
| `notified` | — | Dropped. Email notifications are not available. |
| `panel` | — | Dropped. Panel styling is always on. |
| `protectedContent` | — | Dropped. Feature not available. |

## Behavioral Differences

### Petition Mode

In the Server plugin, petition mode (any user can sign) is activated by setting `signerGroups` to `*`.

In the Cloud app, petition mode activates automatically when no signing restrictions are configured — meaning no named signers, no groups, and no permission inheritance. The result is the same: any authenticated user who can view the page can sign.

### Signature Storage

Server stores signatures in Confluence's Bandana persistence layer (a global key-value cache). Cloud stores signatures in a dedicated SQL database (Forge SQL) with proper schema, indexes, and backup/restore support.

### Existing Signatures After Migration

Automated migration of existing signatures from Server to Cloud is planned but not yet available. When available, the Cloud Migration Assistant (CMA) will handle the transfer. Until then, signature history from Server is not carried over to Cloud.
