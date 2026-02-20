# Cloud Migration Assistant (CMA) Integration Plan

Migrate the Digital Signature macro and its signature data from Confluence Server/DC to Cloud using Atlassian's App Migration Platform.

Two things must be migrated:
1. **Macro rendering** — The Forge app must render macros originally created by the P2 plugin
2. **Signature data** — Existing signatures must be transferred from Bandana to Forge SQL

## App and Macro Identity

Atlassian provides a programmatic mapping via `getServerToForgeMacroMapping()`. Keys are linked in code, not by naming convention.

| Component | Server (P2) | Forge Cloud |
|-----------|-------------|-------------|
| Plugin/App Key | `com.baloise.confluence.digital-signature` | `bab5617e-dc42-4ca8-ad38-947c826fe58c` |
| Macro Name | `signature` | `digital-signature` (title) |
| Macro Key | `digital-signature` | `digital-signature-confluence-cloud-culmat` |

## Macro Parameter Mapping

Migrated P2 macros arrive in Connect-like storage format. The Forge app must accept legacy parameters and map them to the current config shape.

| Server parameter | Forge config field | Transformation |
|------------------|--------------------|----------------|
| `title` | `panelTitle` | Direct copy |
| `signers` | `signers` | Usernames → account IDs (via CMA user mapping) |
| `signerGroups` | `signerGroups` | Group names → group IDs (via CMA group mapping) |
| `inheritSigners` | `inheritViewers` + `inheritEditors` | Enum split: `none` → both false, `readers only` → viewers true, `writers only` → editors true, `readers and writers` → both true |
| `maxSignatures` | `maxSignatures` | `-1` → `undefined` (empty), other values kept as-is |
| `visibilityLimit` | `visibilityLimit` | `-1` → `undefined` (empty), other values kept as-is |
| `signaturesVisible` | `signaturesVisible` | Lowercase → uppercase (`always` → `ALWAYS`, `if signatory` → `IF_SIGNATORY`, `if signed` → `IF_SIGNED`) |
| `pendingVisible` | `pendingVisible` | Same as signaturesVisible |
| `notified` | — | Dropped. Email notifications not available in Forge. |
| `panel` | — | Dropped. Panel styling is always on. |
| `protectedContent` | — | Dropped. Feature not available in Forge. |

## Signature Data Migration

### Legacy Storage Format

Signatures are stored in Confluence's **Bandana** persistence layer (global context).

- Key format: `signature.{SHA256_HASH}`
- Value: GSON-serialized `Signature2` object
- Hash formula: `SHA-256(pageId:title:body)`

Each `Signature2` object contains:

```
{
  key: "signature.{hash}",
  hash: "{hash}",
  pageId: long,
  title: "panel title",
  body: "markdown content",
  maxSignatures: long,           // -1 = unlimited
  visibilityLimit: long,         // -1 = unlimited
  signatures: { "username": "2024-01-15T10:30:00CET", ... },
  missingSignatures: ["username1", "username2"],
  notify: ["username3"]
}
```

### Target Storage Format (Forge SQL)

Two tables:

**contract**
- `hash` VARCHAR(64) PRIMARY KEY — SHA-256
- `pageId` BIGINT
- `createdAt` TIMESTAMP(6)
- `deletedAt` TIMESTAMP(6), nullable

**signature**
- `contractHash` VARCHAR(64) — FK to contract.hash
- `accountId` VARCHAR(128) — Cloud account ID
- `signedAt` TIMESTAMP(6)
- PRIMARY KEY: (contractHash, accountId)

### Hash Compatibility

The legacy hash formula `SHA-256(pageId:title:body)` is identical to the Forge formula `SHA-256(pageId:panelTitle:content)` — same algorithm, same input pattern, different field names. Hashes are portable as-is.

### Data Transformations Required

1. **User IDs**: Server usernames → Cloud account IDs. Use the CMA Mappings API (`gateway.getPaginatedMapping()`) to resolve mappings.
2. **Date format**: Legacy ISO 8601 with timezone (`2024-01-15T10:30:00CET`) → MySQL TIMESTAMP(6).
3. **Contract creation**: Each unique Bandana key becomes one row in the `contract` table. Use the earliest signature timestamp as `createdAt`.
4. **Signature rows**: Each entry in the `signatures` map becomes one row in the `signature` table.
5. **Missing signatures**: The `missingSignatures` set is NOT migrated. The Forge app reconstructs this from the current macro config at render time.

## Implementation Phases

These correspond to backlog items i0049–i0052.

### Phase 1: Define Common Migration Format (i0050)

Define a JSONL.gz interchange format for signature data. Each line is one contract with its signatures:

```jsonl
{"hash":"abc...","pageId":12345,"title":"...","body":"...","signatures":{"user1":"2024-01-15T10:30:00Z",...}}
```

This format is used by both the export (legacy) and import (Forge) sides.

### Phase 2: Export from Legacy Plugin (i0051)

Update the Server plugin (`digital-signature-legacy`):

1. Add dependency:
   ```xml
   <dependency>
       <groupId>com.atlassian</groupId>
       <artifactId>atlassian-app-cloud-migration-listener</artifactId>
       <version>1.8.7</version>
   </dependency>
   ```

2. Implement `DiscoverableForgeListener` + `ConfluenceAppCloudMigrationListenerV1`:

   | Method | Value |
   |--------|-------|
   | `getForgeAppId()` | `UUID.fromString("bab5617e-dc42-4ca8-ad38-947c826fe58c")` |
   | `getForgeEnvironmentName()` | `PRODUCTION` |
   | `getCloudAppKey()` | Marketplace app key (TBD) |
   | `getServerAppKey()` | `com.baloise.confluence.digital-signature` |
   | `getServerToForgeMacroMapping()` | `{"digital-signature": "digital-signature-confluence-cloud-culmat"}` |

3. Implement `onStartAppMigration()`:
   - Iterate all Bandana keys matching `signature.*`
   - Deserialize each `Signature2` object
   - Write JSONL.gz to the App Data transfer payload
   - Include user ID mapping requests for all usernames found

### Phase 3: Import into Forge App (i0052)

Update the Forge app (`digital-signature`):

1. Add a migration resolver that:
   - Receives JSONL.gz data from the App Data Retrieval API
   - Decompresses and parses each line
   - Maps usernames to Cloud account IDs via CMA Mappings API
   - Inserts rows into `contract` and `signature` tables
   - Handles duplicates gracefully (idempotent import)

2. Update the macro renderer to accept legacy parameter names:
   - When the config contains `title` instead of `panelTitle`, treat it as legacy format
   - Apply the parameter mapping table above
   - On first user edit, the config is saved in Forge format (automatic conversion)

### Phase 4: Write Migration Specification (i0049)

Document the complete migration contract:
- Export format specification
- Import format specification
- User/group ID mapping requirements
- Error handling and retry behavior
- Validation and verification steps

### Phase 5: Publish and Test

1. Release new Server plugin version with migration listener
2. Link Server and Cloud apps in Atlassian Partner Portal
3. Test migration in development environment using CMA
4. Verify: macro rendering, signature data, user ID resolution
5. Publish to production

## Storage Format Lifecycle

| Stage | Macro Storage | Signature Data |
|-------|---------------|----------------|
| Before migration | P2 server format | Bandana (GSON) |
| After CMA migration (not yet edited) | Connect-like format | Forge SQL |
| After user edits macro | Forge ADF format | Forge SQL |

## Limitations

- Migrated macros only render in the modern Confluence editor, not the Legacy Editor
- Migration is one-way: once a macro is edited in Cloud, it cannot be moved back to Server
- Features not migrated: protected content, panel toggle, email notifications, in-app notifications
- The `notified`, `panel`, and `protectedContent` parameters are silently dropped

## Resolved Questions

1. **Signature storage format** — Bandana global context, key `signature.{hash}`, GSON-serialized `Signature2` objects. Not Content Properties or Active Objects.
2. **Legacy editor impact** — Unavoidable platform limitation. All Forge macros require the modern editor.

## Open Questions

1. **Marketplace app key** — The `getCloudAppKey()` value depends on the Marketplace listing (TBD).
2. **Data access scopes** — Which `getDataAccessScopes()` values are needed for Bandana read access during export.
3. **Group ID mapping** — Confirm that CMA provides group name → group ID mappings, or whether a separate lookup is needed.

## Resources

- [App Migration Platform](https://developer.atlassian.com/platform/app-migration/)
- [Migrating P2 Macros to Forge](https://developer.atlassian.com/platform/app-migration/tutorials/p2-to-forge-macros/)
- [Prepare Server App for Forge Migration](https://developer.atlassian.com/platform/app-migration/prepare-server-app-forge/)
- [Export App Data and Access in Cloud](https://developer.atlassian.com/platform/app-migration/app-data/)
- [Retrieve Data Mappings](https://developer.atlassian.com/platform/app-migration/mappings/)
- [Forge SQL Migration Guide](https://developer.atlassian.com/platform/forge/storage-reference/sql-migration-guide/)
- [What Migrates with CMA](https://support.atlassian.com/migration/docs/what-migrates-with-the-confluence-cloud-migration-assistant/)
- [App Migration Changelog](https://developer.atlassian.com/platform/app-migration/changelog/)
