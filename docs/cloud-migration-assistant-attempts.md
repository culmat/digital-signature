# CMA App Migration — Troubleshooting Log

This document records the steps taken to get end-to-end CMA (Cloud Migration Assistant) app migration working between the Confluence Server/DC plugin and the Forge cloud app.

## Goal

Migrate signature data from Confluence Server (Bandana storage) to Confluence Cloud (Forge SQL) via CMA, and rewrite macro keys so migrated pages render correctly.

## Environment

| Component | Value |
|-----------|-------|
| Server plugin key | `com.baloise.confluence.digital-signature` |
| Forge app ID | `bab5617e-dc42-4ca8-ad38-947c826fe58c` |
| Forge macro key | `digital-signature` |
| Server macro key (name) | `signature` / key `digital-signature` |
| CMA listener lib | `atlassian-app-cloud-migration-listener:1.8.7` |
| Spring Scanner annotation | `5.1.0` (provided) |
| Spring Scanner Maven plugin | `2.0.1` (build-time) |
| Test Confluence | 9.5.4 (Docker) |
| Target Cloud site | cul.atlassian.net (production) |

## Issue 1: OSGi service registration — `DiscoverableForgeListener` not found by CMA

### Problem
The plugin uses a hand-written `plugin-context.xml` for Spring bean wiring. Spring Scanner does not process `@ExportAsService` when `plugin-context.xml` exists, so the migration listener is never registered as an OSGi service.

### Attempts

| # | Approach | Result |
|---|----------|--------|
| 1 | `@ExportAsService` + `@ConfluenceComponent` | Annotations ignored — `plugin-context.xml` disables Spring Scanner |
| 2 | Delete `plugin-context.xml`, use annotations everywhere | HK2 conflict — macro/REST beans break |
| 3 | `<osgi:service>` in `plugin-context.xml` | Plugin won't start — CCMA doesn't export `.listener` / `.confluence` sub-packages |
| 4 | `<component>` in `atlassian-plugin.xml` | Build fails — forbidden when `Atlassian-Plugin-Key` is set with Spring Scanner |
| 5 | `<scanner:scan-packages>` in a second Spring XML | Plugin won't start — duplicate bean conflicts |
| 6 | Programmatic `BundleContext.registerService()` | ClassLoader mismatch — bundled interfaces ≠ CCMA's interfaces |
| 7 | **Build-time Spring Scanner** (`atlassian-spring-scanner-maven-plugin` v2.0.1) + `<atlassian-scanner:scan-indexes/>` in `plugin-context.xml` | **Works** — plugin starts, `@ExportAsService` processed via pre-built index |

### Resolution
Use `atlassian-spring-scanner-maven-plugin` v2.0.1 to generate `META-INF/plugin-components/exports` at build time. Replace manual beans in `plugin-context.xml` with `<atlassian-scanner:scan-indexes/>`. Add `@ComponentImport` to all constructor-injected dependencies.

### Key files
- `META-INF/plugin-components/exports` — declares `DigitalSignatureMigrationListener#DiscoverableForgeListener,ConfluenceAppCloudMigrationListenerV1`
- `META-INF/plugin-components/imports` — lists all `@ComponentImport` services
- `META-INF/spring/plugin-context.xml` — `<atlassian-scanner:scan-indexes/>`

## Issue 2: CMA dependency scope — `provided` vs `compile`

### Problem
CCMA does **not** export the sub-packages `com.atlassian.migration.app.listener`, `.confluence`, or `.gateway`. Only the flat `com.atlassian.migration.app` package is exported.

### Attempts

| # | Approach | Result |
|---|----------|--------|
| 1 | `provided` scope + `resolution:="optional"` import | `FileNotFoundException: DiscoverableForgeListener.class` — class not in JAR and not importable from CCMA |
| 2 | `compile` scope (bundled) + `!com.atlassian.migration.app.*` import exclusion | **Works** — plugin starts, CMA creates app container |

### Resolution
Keep CMA dependency at `compile` scope (bundled in JAR). Exclude from Import-Package with `!com.atlassian.migration.app.*`.

**Note:** This creates a theoretical classloader mismatch (bundled classes ≠ CCMA's classes), but CMA still discovers the listener and creates app containers. The discovery mechanism may use class-name-based lookup rather than class-identity-based lookup.

## Issue 3: `scanner-runtime` embedding error (March 31)

### Problem
`Incorrect use of atlassian-spring-scanner-runtime: atlassian-spring-scanner-runtime classes are embedded inside the target plugin`

### Resolution
Ensure `atlassian-spring-scanner-annotation` has `<scope>provided</scope>` and there is NO dependency on `atlassian-spring-scanner-runtime`. The build-time Maven plugin (v2.0.1) generates indexes; the runtime scanner is provided by the Confluence host.

## Issue 4: Gson `ClassNotFoundException` on Confluence 9.5.4

### Problem
Confluence 9.5.4 does not export Gson. The plugin fails with `ClassNotFoundException: com.google.gson.GsonBuilder`.

### Resolution
Remove `<scope>provided</scope>` from the Gson dependency (bundle it). Add `!com.google.gson.*` to `Import-Package`. Requires `-Denforcer.skip=true` because Gson is on Atlassian's banned dependency list.

## Issue 5: `getForgeEnvironmentName()` casing

### Problem
The method returned `"PRODUCTION"` (uppercase string literal). The actual constant `ForgeEnvironmentName.PRODUCTION` equals `"production"` (lowercase). The migration orchestrator routes events based on this value — wrong casing means events go to a non-existent environment.

### Discovery
Decompiled `ForgeEnvironmentName.class` from `atlassian-app-cloud-migration-listener-1.8.7.jar`:
```
ConstantValue: String production   (not PRODUCTION)
ConstantValue: String development  (not DEVELOPMENT)
ConstantValue: String staging      (not STAGING)
```

### Resolution
Changed `return "PRODUCTION"` to `return ForgeEnvironmentName.PRODUCTION`.

## Issue 6: Forge manifest — wrong migration module schema

### Problem
The `manifest.yml` declared the migration handler with `function` + `events` fields (trigger-style):
```yaml
migration:
  - key: app-data-migration-listener
    function: migrationHandler
    events:
      - avi:app-data-uploaded
```

The Forge manifest schema for `migration` modules expects a different structure with `appDataUploaded.function`. The old format was silently ignored — the handler was never registered with the platform.

### Discovery
Extracted the manifest JSON schema from `node_modules/@forge/manifest/out/schema/manifest-schema.json`. The `migration` module accepts two handler types:
- `listenerTriggered.function` — when the migration listener is triggered
- `appDataUploaded.function` — when app data is uploaded

### Resolution
```yaml
migration:
  - key: app-data-migration-listener
    appDataUploaded:
      function: migrationHandler
```

## Issue 7: CMA assessment — `hasCloudVersion: false`

### Problem
CMA REST API (`/rest/migration/latest/app`) persistently returns `hasCloudVersion: false` for our app. The assessment UI shows "Cloud availability: No" and "Migration path: Contact vendor". This prevents the app from being selected in the migration wizard (without dev mode).

The Marketplace clearly has 6 cloud versions (latest 2.7.0, Forge) under the same app key. Both `migrationPath: AUTOMATED` and `cloudMigrationAssistantCompatibilityRanges` are declared.

### Root cause
The **installed** Server plugin version (9.1.0) is not published on the Marketplace. The latest published server version is 7.0.7. CMA cannot match the installed version to any known Marketplace version, so the lookup fails.

### Attempted fix
Uploaded 9.1.0 to the Marketplace — **rejected by Atlassian with reason "Server EOL"** (Confluence Server end-of-life Feb 2024). New Server-only versions are no longer accepted.

### Current approach
Added Data Center compatibility params to `atlassian-plugin.xml`:
```xml
<param name="atlassian-data-center-status">compatible</param>
<param name="atlassian-data-center-compatible">true</param>
```
Rebuilt as v9.2.0 for upload as a Data Center version (DC is still supported on Marketplace).

### Workaround
CMA dev mode (`migration-assistant.app-migration.dev-mode` dark feature) bypasses the assessment and auto-includes any app with a `DiscoverableForgeListener`. With dev mode, app containers are created and server-side export works (reaches 80%).

## Issue 8: `avi:app-data-uploaded` event never delivered to Forge app

### Problem
Every migration reaches 80% ("Events are being processed") then times out after 15 minutes. The Forge app receives zero events in any environment (production or development). No logs appear.

### What works
- Server-side: `onStartAppMigration()` runs, data exported as JSONL.gz via `gateway.createAppData()`
- CMA orchestrator: app container created, transfer reaches 80%
- Forge app: deployed to production, installed on cul.atlassian.net, migration module declared

### Fixes applied and tested together (2026-04-05)
1. `getForgeEnvironmentName()` → `"production"` (lowercase) ✅
2. Manifest schema → `appDataUploaded.function` ✅
3. DC compatibility params for Marketplace publishing ✅ (v9.2.0 built, not yet accepted)

### Result
**Still fails.** Tested with all three fixes applied across 6+ migration runs. Events never arrive. The orchestrator appears to refuse event delivery when it cannot verify the installed server version against a published Marketplace version (`hasCloudVersion: false`).

## Issue 9: Webtrigger webhook approach — broke "Runs on Atlassian"

### Problem
As a workaround for the native `migration` module not receiving events, we tried adding a `webtrigger` module to receive migration events via HTTP webhook. This broke "Runs on Atlassian" eligibility because webtriggers involve inbound HTTP which disqualifies the app.

### Attempts
1. Added `webtrigger` module to manifest — deployed, URL generated, test POST worked (handler received and logged the event)
2. Added `connect-confluence:cloudAppMigration` with `migrationWebhookPath` — lint error: requires `app.connect.remote` config
3. Tried registering webhook via Notification API (`PUT /rest/atlassian-connect/1/migration/webhook`) — 403: "This API is only available to Atlassian Connect apps"
4. Triggered migration with all three delivery paths active (native migration module + webtrigger + connectModules) — still zero events received

### Resolution
**Reverted.** The webtrigger approach doesn't work because:
- The Notification API requires Connect JWT auth (not available for native Forge apps)
- The `connect-confluence:cloudAppMigration` manifest module requires `app.connect.remote` (a remote backend)
- Breaking "Runs on Atlassian" eligibility is not acceptable as a workaround

### Key finding from community research
All resolved community cases of migration event delivery involve **Connect apps** with webhook endpoints. No resolved cases involve native Forge apps using the `migration` module. The working path for Connect apps is webhook registration via the Notification API, which is not available to Forge apps.

## Issue 10: Marketplace rejects new Server/DC versions

### Problem
Cannot publish v9.1.0 or v9.2.0 to the Marketplace. v9.1.0 was rejected with "Server EOL". v9.2.0 includes DC compatibility params (`atlassian-data-center-status: compatible`, `atlassian-data-center-compatible: true`) but the upload form still only offers "Confluence Server" as a compatible product. Publishing as Data Center requires an approved technical review (ECOHELP ticket).

### Status
**Blocked.** Opened support ticket referencing ECOHELP-119424 requesting help to publish v9.2.0 as a Data Center version and asking whether `hasCloudVersion: false` is the root cause of event non-delivery.

## Marketplace Migration API Declaration

```bash
curl -X PUT \
  'https://marketplace.atlassian.com/rest/2/addons/com.baloise.confluence.digital-signature/migration' \
  -H 'Content-Type: application/json' \
  -u '<vendor-email>:<api-token>' \
  -d '{
    "migrationPath": "AUTOMATED",
    "cloudMigrationAssistantCompatibility": "7.0.3",
    "cloudMigrationAssistantCompatibilityRanges": [
      {"start": "7.0.3", "end": null}
    ],
    "migrationDocumentation": "https://github.com/baloise/digital-signature/blob/main/docs/cloud-migration-asistant.md",
    "featureDifferenceDocumentation": "https://github.com/baloise/digital-signature/blob/main/docs/what_has_changed.md"
  }'
```

## Related Community Posts

- [How to register DiscoverableForgeListener for CMA app migration in a plugin with plugin-context.xml?](https://community.developer.atlassian.com/t/how-to-register-discoverableforgelistener-for-cma-app-migration-in-a-plugin-with-plugin-context-xml/99936) — our post, answered with build-time scanner approach
- [Forge remote endpoints not called in migration process](https://community.developer.atlassian.com/t/forge-remote-endpoints-not-called-in-migration-process/99951) — another developer with the identical symptom (March 2026, unresolved)
- [Migration event app-data-uploaded not received](https://community.developer.atlassian.com/t/migration-event-app-data-uploaded-not-received/58760) — resolved by switching from descriptor to Notification API webhook registration (Connect app only)
- [Cloud app does not receive migration events](https://community.developer.atlassian.com/t/cloud-app-does-not-receive-migration-events/54933) — resolved: invalid progress values + duplicate webhook bug (MIG-918)
- [Cloud app does not receive Jira migration events](https://community.developer.atlassian.com/t/cloud-app-does-not-receive-jira-migration-events/55189) — resolved: mismatched `getCloudAppKey()` value
- [DC-to-cloud migration: apps not registered to receive notifications](https://community.developer.atlassian.com/t/dc-to-cloud-migration-some-apps-are-not-registered-to-receive-migration-notifications/92299) — resolved by adding `cloudAppMigration` to Connect descriptor
- [Endpoint not registered](https://community.developer.atlassian.com/t/endpoint-not-registered/80248) — resolved: server listener not discoverable/enabled

## Timeline

| Date | Action |
|------|--------|
| 2026-03-29 | First CMA migration attempt to devds.atlassian.net — app container created, timed out at 80% |
| 2026-03-31 | Spring Scanner runtime embedding error, multiple plugin upload attempts |
| 2026-04-04 | Build-time scanner fix, casing fix, manifest fix, DC compatibility params |
| 2026-04-04 | Marketplace rejects v9.1.0 ("Server EOL") |
| 2026-04-04 | Rebuilt as v9.2.0 with DC params for re-submission |
| 2026-04-05 | Webtrigger webhook approach — worked for test POST but CMA never sent events; broke "Runs on Atlassian" — reverted |
| 2026-04-05 | Direct trigger API tested — server export works, events still not delivered |
| 2026-04-05 | Community research: all resolved cases are Connect apps, none are native Forge |
| 2026-04-05 | Opened Atlassian support ticket referencing ECOHELP-119424 |
| 2026-04-07 | **Atlassian support response**: manifest must use `trigger` events (`avi:ecosystem.migration:uploaded:app_data`), not the `migration` module with `appDataUploaded.function` |

## Issue 11: Wrong manifest module type — `migration` vs `trigger` (ROOT CAUSE of event non-delivery)

### Problem
The Forge manifest used a `migration:` module with `appDataUploaded.function` schema. While this passed lint and deploy validation, the platform does not route events to this module type. The correct approach is to use a standard **`trigger`** module with specific event names.

### Root cause
The `migration` module schema exists in `@forge/manifest` but is apparently an older/internal API. The documented and working approach (per [Atlassian docs](https://developer.atlassian.com/platform/app-migration/prepare-cloud-app-forge/)) uses `trigger` events:

```yaml
# WRONG (doesn't receive events)
migration:
  - key: app-data-migration-listener
    appDataUploaded:
      function: migrationHandler

# CORRECT (per Atlassian support + documentation)
trigger:
  - key: migration-trigger
    function: migrationHandler
    events:
      - avi:ecosystem.migration:triggered:listener
      - avi:ecosystem.migration:uploaded:app_data
```

### Resolution
Replaced `migration` module with `trigger` events in `manifest.yml`. Updated handler to check `event.eventType` and only process `avi:ecosystem.migration:uploaded:app_data` events.

### Source
Atlassian support (James Richards) via ECOHELP-119424, referencing https://developer.atlassian.com/platform/app-migration/prepare-cloud-app-forge/

## Issue 12: CMA user mapping requires userKeys, not usernames

### Problem
The Server plugin's `Signature2` stores signatures keyed by **username** (e.g. `admin`). But the CMA Mappings API (`getMappingById` with namespace `identity:user`) requires keys in `confluence.userkey/<userKey>` format, where userKey is the internal Confluence user key (e.g. `2c9680839d34a92c019d34add3010000`).

### Discovery
Debug logging showed `getMappingById` returned `{}` for `confluence.userkey/admin` but returned a valid Cloud account ID for `confluence.userkey/2c9680839d34a92c019d34add3010000`.

### Resolution
Added `UserAccessor` to `DigitalSignatureMigrationListener`. In `toJsonLine()`, resolve each username to its userKey via `userAccessor.getUserByName(username).getKey().getStringValue()` before writing to JSONL. The Forge import handler uses `confluence.userkey/<userKey>` for lookups.

## Issue 13: Server→Cloud page ID mismatch breaks contract hash lookup

### Problem
Contracts are stored with `hash = SHA-256(pageId:title:body)`. The Server export uses the **Server pageId** (e.g. `164005`), but the Forge macro on Cloud computes the hash with the **Cloud pageId** (e.g. `4489219`). Different pageIds → different hashes → signatures don't display on migrated pages.

### Resolution
In the Forge migration handler, resolve Server pageIds → Cloud pageIds via CMA Mappings API (`confluence:page` namespace), then recompute the hash with the Cloud pageId before inserting into Forge SQL.

## Issue 14: Bundled Gson breaks Velocity template rendering

### Problem
After bundling Gson (Issue 4), the `Signature2.getSignatures()` map returns Gson-internal `StringMap$LinkedEntry` objects instead of standard `HashMap$Node`. Confluence's Velocity allowlist blocks `StringMap$LinkedEntry#getKey()` and `#getValue()`, causing signature dates and usernames to render as raw Velocity expressions: `$dateFormatter.formatDateTime($date2userName.value) - $profile.getFullName()`.

### Resolution
In `ContextHelper.getOrderedSignatures()`, copy the Gson map to a plain `LinkedHashMap` before iterating:
```java
Map<String, Date> plain = new LinkedHashMap<>(signature.getSignatures());
```
This produces standard `HashMap$Node` entries that pass the Velocity allowlist.

## Issue 15: Epoch millis for timezone-safe date migration

### Problem
Server Gson serializes dates with Java timezone abbreviations (e.g. `2026-03-29T15:01:33UTC`) via `setDateFormat("yyyy-MM-dd'T'HH:mm:ssz")`. JavaScript's `new Date()` cannot reliably parse timezone abbreviations like `CEST`, causing "Invalid date" in the Cloud UI.

### Resolution
Export signature dates as **epoch milliseconds** (`entry.getValue().getTime()`) instead of formatted strings. The Forge handler parses with `new Date(epochMillis)` which is timezone-safe.

**Note:** Server displays dates in the JVM timezone (UTC in Docker). Cloud displays in the user's browser timezone. A signature at `15:01 UTC` shows as `17:01 CEST` — this is correct behavior, not a bug.

## Issue 16: Macro storage format — Server XML vs Forge ADF

### Problem
CMA dev mode migrates pages but doesn't convert the macro storage format. Migrated pages have Server/Connect format (`<ac:structured-macro>`) but Forge macros require ADF extension format (`<ac:adf-extension>`). Pages show "Error loading the extension!" because Confluence Cloud can't bridge the legacy format to the Forge macro renderer.

### Resolution
Post-migration script `scripts/rewrite-cma-macros.py` converts all signature macros in a space from Server XML to Forge ADF format, including:
- Macro storage format conversion (`<ac:structured-macro>` → `<ac:adf-extension>`)
- Parameter name normalization (Server → Forge naming conventions)
- Locked-macro detection: macros with no signers/groups/inheritance get `max-signatures=0` to prevent unintended petition mode in Cloud

## Issue 17: DC version cannot be published (Atlassian response)

### Problem
Atlassian support confirmed DC is approaching end-of-life and new DC app registrations are no longer accepted. The Server plugin version with CMA support cannot be published to the Marketplace.

### Resolution
Distribute the plugin JAR directly to customers. CMA dev mode must be enabled on their Server instance for app migration to work. The post-migration macro conversion script must be run after each migration.

### Atlassian support summary (James Richards, ECOHELP-119424)
- Can't register new DC apps — DC approaching EOL
- Can distribute plugin directly to customers
- Trigger events (`avi:ecosystem.migration:*`) are correct and unrelated to dev mode
- Dev mode just bypasses assessment checks and always calls the listener

## Current Status (2026-04-10)

**Working end-to-end with manual steps:**
1. Server-side export via `onStartAppMigration()` ✅
2. Forge receives `avi:ecosystem.migration:uploaded:app_data` trigger events ✅
3. Page ID mapping (Server → Cloud) ✅
4. User key mapping (userKey → Cloud account ID) ✅
5. Contract hash recomputation with Cloud pageId ✅
6. Epoch millis date migration ✅
7. Post-migration macro format conversion script ✅
8. Signatures display correctly on Cloud ✅

**Remaining manual steps required:**
- Enable CMA dev mode on Server (`migration-assistant.app-migration.dev-mode` dark feature)
- Run post-migration macro conversion: `python3 scripts/rewrite-cma-macros.py <host> <space>`
- Disable `ENABLE_DELETE_ALL` env var after testing

## Timeline

| Date | Action |
|------|--------|
| 2026-03-29 | First CMA migration attempt to devds.atlassian.net — app container created, timed out at 80% |
| 2026-03-31 | Spring Scanner runtime embedding error, multiple plugin upload attempts |
| 2026-04-04 | Build-time scanner fix, casing fix, manifest schema fix, DC compatibility params |
| 2026-04-04 | Marketplace rejects v9.1.0 ("Server EOL") |
| 2026-04-04 | Rebuilt as v9.2.0 with DC params for re-submission |
| 2026-04-05 | Webtrigger webhook approach — worked for test POST but CMA never sent events; broke "Runs on Atlassian" — reverted |
| 2026-04-05 | Direct trigger API tested — server export works, events still not delivered |
| 2026-04-05 | Community research: all resolved cases are Connect apps, none are native Forge |
| 2026-04-05 | Opened Atlassian support ticket referencing ECOHELP-119424 |
| 2026-04-07 | **Atlassian support response**: manifest must use `trigger` events, not `migration` module |
| 2026-04-07 | Trigger fix deployed — **events received for the first time!** 11 contracts, handler error (mapping format) |
| 2026-04-07 | Atlassian confirms DC registration no longer possible |
| 2026-04-09 | UserKey mapping fix — 11 signatures imported with correct Cloud account IDs |
| 2026-04-09 | Page ID mapping + hash recomputation — signatures display on correct Cloud pages |
| 2026-04-09 | Macro format conversion script — migrated macros render in Cloud |
| 2026-04-10 | Gson/Velocity fix — Server plugin renders signatures again after bundled Gson change |
| 2026-04-10 | Epoch millis date fix — timezone-safe date migration |
| 2026-04-10 | **End-to-end CMA migration working** |
