# Cloud Migration Assistant (CMA) Integration Plan

Enable migration of the Digital Signature macro from Confluence Server/DC to Cloud using Atlassian's App Migration Platform.

## Key Finding: Macro Keys Do NOT Need to Match

Atlassian provides a programmatic mapping mechanism via `getServerToForgeMacroMapping()`. The keys are linked explicitly in code, not by naming convention.

| Component | Server (P2) | Forge Cloud |
|-----------|-------------|-------------|
| Plugin/App Key | `com.baloise.confluence.digital-signature` | `bab5617e-dc42-4ca8-ad38-947c826fe58c` |
| Macro Name | `signature` | `digital-signature` (title) |
| Macro Key | `digital-signature` | `digital-signature-confluence-cloud-culmat` |

## Implementation Steps

### Phase 1: Update Server Plugin (digital-signature-legacy)

#### 1.1 Add Migration Library Dependency

Add to `pom.xml`:

```xml
<dependency>
    <groupId>com.atlassian</groupId>
    <artifactId>atlassian-app-cloud-migration-listener</artifactId>
    <version>1.8.1</version>
</dependency>
```

#### 1.2 Create Migration Listener Class

Implement a class that provides:
- `DiscoverableForgeListener` — For Forge migration support
- `ConfluenceAppCloudMigrationListenerV1` — For macro mapping (v1.8.0+)

Required method implementations:

| Method | Value |
|--------|-------|
| `getForgeAppId()` | `UUID.fromString("bab5617e-dc42-4ca8-ad38-947c826fe58c")` |
| `getForgeEnvironmentName()` | `PRODUCTION` |
| `getCloudAppKey()` | Marketplace app key (TBD) |
| `getServerAppKey()` | `com.baloise.confluence.digital-signature` |
| `getServerToForgeMacroMapping()` | `{"signature": "digital-signature-confluence-cloud-culmat"}` |

#### 1.3 Implement Data Export

Handle signature data export in `onStartAppMigration()` callback.

### Phase 2: Update Forge App (digital-signature)

#### 2.1 Handle Legacy Macro Parameters

Map P2 macro parameters to Forge config:
- `title` → config.title
- `signers` → config.signers
- `signerGroups` → config.signerGroups
- `inheritSigners` → config.inheritSigners
- `maxLevel` → config.maxLevel
- `pendingVisible` → config.pendingVisible
- `visibility` → config.visibility

#### 2.2 Implement Data Import

Handle signature data import via Forge resolver when receiving migrated data.

### Phase 3: Publish & Configure

1. Release new Server plugin version with migration listener
2. Link Server and Cloud apps in Atlassian Partner Portal
3. Test migration in development environment
4. Publish to production

## Technical Notes

### Storage Format Transformation

| Stage | Format |
|-------|--------|
| Before Migration | P2/Server format |
| After Migration (unedited) | Connect-like format |
| After User Edit | Forge format |

### Limitations

- Migrated P2 macros cannot be rendered in Confluence Legacy Editor
- Users must use the modern Confluence editor
- Migration is one-way: once edited in Forge, macro data is transformed permanently

## Open Questions

1. **Signature storage format** — How are signatures stored in legacy plugin? (Content Properties / AO tables?)
2. **Data access scopes** — Which `getDataAccessScopes()` values are needed for export?
3. **Legacy editor impact** — Is the Legacy Editor limitation acceptable for customers?

## Resources

- [App Migration Platform](https://developer.atlassian.com/platform/app-migration/)
- [Migrating P2 Macros to Forge](https://developer.atlassian.com/platform/app-migration/tutorials/p2-to-forge-macros/)
- [Prepare Server App for Forge Migration](https://developer.atlassian.com/platform/app-migration/prepare-server-app-forge/)
- [What Migrates with CMA](https://support.atlassian.com/migration/docs/what-migrates-with-the-confluence-cloud-migration-assistant/)
