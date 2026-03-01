# Cloud Migration Specification (i0049)

Migration of the Digital Signature plugin from Confluence Server/DC to Cloud using the Atlassian App Migration Platform (AMP).

## Overview

Two things migrate:

1. **Macro rendering** — existing `{signature}` macros re-render in Cloud using the Forge app. CMA rewrites macro keys automatically using the mapping provided by `getServerToForgeMacroMapping()`.
2. **Signature data** — contracts and signatures stored in Bandana are transferred to Forge SQL.

## App Identity

| | Server/DC | Cloud (Forge) |
|---|---|---|
| Plugin/App key | `com.baloise.confluence.digital-signature` | `bab5617e-dc42-4ca8-ad38-947c826fe58c` |
| Macro key | `digital-signature` | `digital-signature-confluence-cloud-culmat` |
| Marketplace listing | [1217404](https://marketplace.atlassian.com/apps/1217404/digital-signature) | same listing |

---

## Export Format (Server → Cloud)

### Produced by

`com.baloise.confluence.digitalsignature.migration.DigitalSignatureMigrationListener` in `digital-signature-legacy`.

### Format

**JSONL compressed with gzip.** Each line is one JSON object representing one signature contract:

```jsonl
{"hash":"<sha256>","pageId":<long>,"title":"<string>","body":"<string>","signatures":{"<username>":"<iso8601>", ...}}
```

Field details:

| Field | Type | Description |
|-------|------|-------------|
| `hash` | string (64 hex chars) | SHA-256 of `"<pageId>:<title>:<body>"` |
| `pageId` | number | Confluence page ID |
| `title` | string | Signature panel title (may be empty) |
| `body` | string | Markdown content of the signature block |
| `signatures` | object | Map of server username → ISO 8601 timestamp with timezone (e.g. `"2024-01-15T10:30:00CET"`) |

Fields intentionally **not exported**: `missingSignatures`, `notify`, `key`, `maxSignatures`, `visibilityLimit`.

The payload is uploaded via `gateway.createAppData("signatures")` with label `"signatures"`. The label is used by the import handler to identify the payload.

### Hash compatibility

The legacy hash formula `SHA-256(<pageId>:<title>:<body>)` equals the Forge formula `SHA-256(<pageId>:<title>:<content>)` — the inputs are identical. Hashes are portable without transformation.

---

## Import Format (Cloud)

### Handled by

`src/migration/index.js` in `digital-signature`, triggered by `avi:app-data-uploaded`.

### Processing steps

1. **Filter** — only processes payloads with `label === "signatures"`. Other labels are acknowledged and skipped.
2. **Decompress** — JSONL.gz → UTF-8 text.
3. **Parse** — each line parsed as JSON.
4. **Resolve user IDs** — all server usernames collected and resolved to Cloud account IDs in batches of 100 via `migration.getMappingById(transferId, "identity:user", batch)`.
5. **Insert contracts** — `INSERT IGNORE INTO contract (hash, pageId, createdAt)`. `createdAt` is set to the earliest signature timestamp in that contract, or `NOW()` if no signatures.
6. **Insert signatures** — `INSERT IGNORE INTO signature (contractHash, accountId, signedAt)` for each resolved signer.
7. **Acknowledge** — `migration.messageProcessed(transferId, messageId)`.

### Idempotency

Both `INSERT IGNORE` statements make the import safe to re-run. Re-running the migration will not duplicate contracts or signatures.

### Target schema

```sql
-- contract: one row per signature block
hash       VARCHAR(64)   PRIMARY KEY   -- SHA-256
pageId     BIGINT        NOT NULL
createdAt  TIMESTAMP(6)  NOT NULL
deletedAt  TIMESTAMP(6)  NULL          -- set by page lifecycle handler

-- signature: one row per signer per contract
contractHash  VARCHAR(64)   NOT NULL   -- FK → contract.hash
accountId     VARCHAR(128)  NOT NULL   -- Cloud account ID
signedAt      TIMESTAMP(6)  NOT NULL
PRIMARY KEY (contractHash, accountId)
```

---

## Macro Parameter Mapping

Migrated macros arrive in Connect-like storage format with legacy parameter names. The Forge frontend normalizes these transparently on first render via `normalizeLegacyConfig()` in `src/shared/normalizeLegacyConfig.js`. On the user's next config save, the macro is permanently written in Forge format.

| Server parameter | Forge field | Transformation |
|-----------------|-------------|----------------|
| `title` | `title` | Direct copy |
| `body` | `content` | Rename |
| `signers` | `signers` | Usernames → account IDs (resolved by CMA) |
| `signerGroups` | `signerGroups` | Group names → group IDs (resolved by CMA) |
| `inheritSigners: "none"` | `inheritViewers: false, inheritEditors: false` | Enum split |
| `inheritSigners: "readers only"` | `inheritViewers: true, inheritEditors: false` | Enum split |
| `inheritSigners: "writers only"` | `inheritViewers: false, inheritEditors: true` | Enum split |
| `inheritSigners: "readers and writers"` | `inheritViewers: true, inheritEditors: true` | Enum split |
| `maxSignatures: "-1"` | `maxSignatures: undefined` | -1 → unlimited |
| `visibilityLimit: "-1"` | `visibilityLimit: undefined` | -1 → unlimited |
| `signaturesVisible` | `signaturesVisible` | Lowercase → uppercase (`"always"` → `"ALWAYS"`, etc.) |
| `pendingVisible` | `pendingVisible` | Same as signaturesVisible |
| `notified` | — | Dropped (email notifications not available in Forge) |
| `panel` | — | Dropped (panel styling always on in Forge) |
| `protectedContent` | — | Dropped (feature not available in Forge) |

---

## User ID Mapping

- Server usernames are exported as-is in the `signatures` map.
- During import, usernames are resolved to Cloud account IDs using `migration.getMappingById(transferId, "identity:user", batch)`.
- Usernames with no mapping are logged as warnings and skipped. Their signatures are not migrated.
- Macro `signers` and `signerGroups` parameters are resolved by the CMA framework automatically before the macro receives its config — no additional handling required.

## Group ID Mapping

Group names in `signerGroups` macro parameters are resolved by the CMA framework to Cloud group IDs. No custom handling is required in this plugin.

---

## Error Handling

| Situation | Behaviour |
|-----------|-----------|
| Corrupt/null Bandana entry | Logged as warning, skipped. Export continues. |
| gzip or JSON parse failure | Exception propagated. CMA retries the export. |
| Username has no account ID mapping | Logged as warning. Signature skipped. Contract still created. |
| Duplicate contract or signature on re-run | `INSERT IGNORE` — silently skipped. |
| SQL error during import | Exception propagated. CMA retries the import. |
| Non-`"signatures"` payload label | Acknowledged immediately, no processing. |

---

## Not Migrated

| Feature | Reason |
|---------|--------|
| `missingSignatures` | Reconstructed at render time from current macro config |
| `notify` (email lists) | Email notifications not available in Forge |
| `panel` toggle | Always on in Forge |
| `protectedContent` | Feature not available in Forge |
| Signers with no Cloud account | Skipped (account no longer exists or not mapped) |

Migrated macros only render in the **modern Confluence editor**. The legacy editor does not support Forge macros. This is an unavoidable platform constraint.

---

## Storage Format Lifecycle

| Stage | Macro storage | Signature data |
|-------|--------------|----------------|
| Before migration | P2 server format | Bandana (GSON-serialized `Signature2`) |
| After CMA migration, not yet edited | Connect-like format (legacy params) | Forge SQL |
| After user edits and saves macro | Forge ADF format | Forge SQL |

---

## Remaining Steps (Phase 5)

1. Release `digital-signature-legacy` with `DigitalSignatureMigrationListener` included.
2. Install `@forge/migrations` in `digital-signature` (`npm install @forge/migrations`).
3. Deploy `digital-signature` Forge app (`forge deploy`).
4. Link Server and Forge apps in the [Atlassian Partner Portal](https://partners.atlassian.com).
5. Test end-to-end in a CCMA development environment.
6. Verify: macro rendering, signature data, user ID resolution, missing-mapping warnings.
7. Publish both apps to production.
