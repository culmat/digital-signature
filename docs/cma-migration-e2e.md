# CMA Migration: Bandana → Forge SQL — How it works & the E2E test

This document explains **how signature data migrates from Confluence Server/DC (Bandana) to
Confluence Cloud (Forge SQL)** via the Cloud Migration Assistant (CMA), and describes the
**repeatable end-to-end test** that exercises the whole pipeline.

It also records the answer to a recurring confusion: *"the Migration wizard finds 9 pages but
the stats show only 1 contract."*

---

## TL;DR — the two things that confuse the stats

1. **Two independent mechanisms, only one writes SQL.**
   - The **CMA app-data import** ([`src/migration/index.js`](../src/migration/index.js)) is the **only** code path
     that inserts rows into the `contract` / `signature` tables. It runs **once**, during a real
     CMA migration, when the platform delivers the JSONL the Server plugin exported.
   - The in-app **Migration wizard** ([`src/resolvers/migrationResolver.js`](../src/resolvers/migrationResolver.js)) only **rewrites
     page markup** (Server `<ac:structured-macro>` → Forge `<ac:adf-extension>`). It never
     touches storage. Its "Found N pages with M legacy macros" count comes from a CQL search,
     not the database.

2. **Forge SQL is isolated per installation.** Per Atlassian's docs, *"Forge SQL provisions
   databases for each individual installation, thereby isolating each customer's data."* There
   is **no shared database** across environments (development / staging / production) or across
   sites. The legacy listener routes the migration to the **`production`** environment
   (see below), so a real migration writes rows into the **production** installation's database
   — which is a *different database* from the **development** installation you may be viewing.

> **The "1 contract" case was not data loss.** The production installation
> (`cul.atlassian.net`) holds the migrated **9 contracts / 11 signatures** (matching the
> fixtures). The development installation (`devds.atlassian.net`, env
> `fd9d205a-7091-4573-9f6f-2cbd40db6961`) is a separate, isolated database that only contained 1
> manually-signed contract. The import is idempotent (`ON DUPLICATE KEY UPDATE` / `INSERT
> IGNORE`), so re-runs keep the count stable.

---

## The end-to-end flow

```
┌─ Confluence Server/DC ──────────────────────────────────────────────┐
│ Signature data lives in BANDANA, not on the page.                    │
│   key:   signature.<hash>     hash = SHA-256("<pageId>:<title>:<body>")│
│   value: GSON-serialized Signature2 { signatures: {username→Date} }  │
│                                                                       │
│ The page only carries macro MARKUP:                                  │
│   <ac:structured-macro ac:name="signature"> … params … </…>          │
└───────────────────────────────────────────────────────────────────────┘
                │  CMA migration started (dev mode bypasses assessment)
                ▼
┌─ Server plugin: DigitalSignatureMigrationListener.onStartAppMigration ┐
│ Iterates all `signature.*` Bandana keys → one JSONL line per contract:│
│   {"hash","pageId","title","body","signatures":{userKey→epochMillis}} │
│ gzipped, uploaded via gateway.createAppData("signatures").            │
│   • usernames re-keyed to Confluence userKeys (CMA Mappings needs it) │
│   • dates exported as epoch millis (timezone-safe)                    │
│ Logs: "Migration export complete: N keys scanned, M contracts …"     │
│                                                                       │
│ ROUTING KNOB → getForgeEnvironmentName() decides which Forge          │
│ environment receives the data. Hard-coded to PRODUCTION historically. │
└───────────────────────────────────────────────────────────────────────┘
                │  avi:ecosystem.migration:uploaded:app_data  (label="signatures")
                ▼
┌─ Forge app: src/migration/index.js (trigger handler) ─────────────────┐
│ 1. filter label === "signatures"                                      │
│ 2. gunzip JSONL                                                       │
│ 3. resolve userKeys → Cloud accountIds   (getMappingById identity:user)│
│ 4. resolve Server pageIds → Cloud pageIds (getMappingById confluence:page)
│ 5. RECOMPUTE hash with the Cloud pageId   (Server & Cloud pageIds differ)
│ 6. upsert contract + signature rows into Forge SQL                    │
│ 7. migration.messageProcessed(transferId, messageId)                  │
│ Logs: "[migration] Done: N contracts, M signatures inserted, …"       │
│                                                                       │
│ skips: no page mapping → contract skipped; no user mapping → signature │
│        skipped (contract still created).                              │
└───────────────────────────────────────────────────────────────────────┘
                │  (separate, orthogonal step)
                ▼
┌─ Macro markup conversion ─────────────────────────────────────────────┐
│ CMA migrates the PAGES but leaves Server macro format → "Error loading │
│ the extension". Convert with either:                                  │
│   • in-app Migration wizard (admin → Migration tab), or               │
│   • scripts/rewrite-cma-macros.py <cloud-host> <space>                 │
│ This does NOT touch signature data — it only rewrites markup.          │
└───────────────────────────────────────────────────────────────────────┘
```

Key references:
- Server export schema & fields: [`cloud-migration-spec.md`](cloud-migration-spec.md).
- Every hard-won fix (OSGi registration, manifest `trigger` vs `migration` module, userKey
  mapping, page-id/hash recomputation, epoch-millis dates, macro format): numbered Issues in
  [`cloud-migration-assistant-attempts.md`](cloud-migration-assistant-attempts.md).

### Why dev mode is required

The Forge app is **not registered against the installed Server version** on the Marketplace
(`hasCloudVersion: false`; new Server/DC versions can no longer be published). Without help, CMA
won't offer the app for migration. The **`migration-assistant.app-migration.dev-mode`** dark
feature bypasses that assessment and always invokes any `DiscoverableForgeListener`. Per
Atlassian support, dev mode **only** bypasses the assessment — it is **unrelated to event
routing**. Routing is governed entirely by `getForgeEnvironmentName()`.

### The environment routing knob

```java
// digital-signature-legacy …/migration/DigitalSignatureMigrationListener.java
@Override public String getForgeEnvironmentName() {
    return System.getProperty("ds.forge.migration.environment", ForgeEnvironmentName.PRODUCTION);
}
```

Default is `production` (the shipping behaviour). For the **e2e test we override it to
`development`** via a JVM system property so the migration targets the development installation
on the test site — keeping production data untouched and matching where we iterate.

---

## The repeatable E2E test

A bash **orchestrator** (`scripts/cma-e2e-test.sh`) drives the infrastructure/state phases and
shells out to **Playwright** (`e2e/tests/cma-migration.spec.js`) for the browser-driven phases,
reusing the existing CDP browser session (`npm run test:e2e:save-auth`).

### Prerequisites (one-time)

1. **Docker** running; **forge CLI** authenticated.
2. A **CDP browser** logged into **both** the local Server (`admin`/`admin`) and the Cloud test
   site. Launch it with `npm run test:e2e:browser`, log into both, then
   `npm run test:e2e:save-auth`.
3. A **valid Server license** in `digital-signature-legacy/licenses/`, named
   `SERVERID_YYYY_MM_DD.txt`. The **server ID is taken from the filename** and injected into the
   container (`confluence.setup.server.id`) — the container **must** run with that ID or the
   license won't apply. ⚠️ New trial licenses are no longer self-service; if the only license is
   past-dated the test will try it and report whatever Confluence does (it may refuse to start —
   a hard blocker until a valid license is obtained).
4. The Forge **development** build deployed and installed on the Cloud test site:
   `forge deploy -e development` then `forge install -e development`.
5. A **one-time CMA Server↔Cloud connection** established in the Server's Migration Assistant
   (interactive Atlassian sign-in). Subsequent runs reuse it.
6. `e2e/.env` populated — see `e2e/.env.example` (note `FORGE_ENV_ID` must be the **development**
   environment id, and the new `SERVER_*` / `MIGRATION_SPACE_PREFIX` / `CONFLUENCE_VERSION`
   vars).

### Phases

```
scripts/cma-e2e-test.sh  [all | <phase>]

preflight   docker + forge CLI; CDP browser; warn if newest license past-dated (try anyway);
            dev build installed; CMA connection present
reset       wipe dev SQL (danger zone) + delete prior Cloud test space
server-up   test-plugin.sh build/start/upload (Confluence + Postgres, Docker);
            resolve_license + inject_server_id; JVM prop ds.forge.migration.environment=development
fixtures    create-cma-test-fixtures.sh <fresh-space-key> → signed Server macros
darkon      enable  migration-assistant.app-migration.dev-mode   (Playwright on Server)
migrate     drive Server CMA UI → run migration to the dev install (Playwright);
            capture `forge logs -e development | grep '[migration]'` to an artifact
darkoff     disable migration-assistant.app-migration.dev-mode    (Playwright on Server)
wizard      Forge admin (dev) Migration tab → scan space → Convert All (Playwright)
verify      assert dev-env stats == expected (e2e/fixtures/cma-expected.js);
            spot-check a migrated page renders
```

Each browser phase is one step of the serial Playwright spec, selected by the `CMA_PHASE` env
var (the orchestrator runs one phase at a time under `workers: 1`).

### Repeatability

CMA migrates a space once; re-migrating into an existing Cloud space is messy. So **each run
uses a fresh space key** (`<MIGRATION_SPACE_PREFIX><runid>`): the fixtures are created in that
space on the Server, migrated, verified, and then `reset` deletes the Cloud space and wipes the
development SQL. Runs are therefore independent and idempotent.

### Run it

```bash
# full run
npm run test:e2e:cma
# or a single phase while debugging
bash scripts/cma-e2e-test.sh server-up
bash scripts/cma-e2e-test.sh migrate
```

### What "green" proves

- `verify` asserts the development installation's `getStatistics()` equals the counts derived
  from the fixtures (`e2e/fixtures/cma-expected.js`).
- The captured `forge logs -e development` artifact shows
  `[migration] Done: N contracts, M signatures inserted, 0 … skipped`.
- A migrated page on the test site renders the Forge macro with the migrated signatures.
- A second `all` run (fresh space) yields identical results after `reset`.

---

## Known constraints / gotchas

- **No `forge tunnel` during `migrate`.** A running tunnel re-routes development trigger events
  to your machine; the deployed handler then never runs. Stop tunnels first; read
  `forge logs -e development`.
- **CMA wizard selectors are Confluence-version-specific** and are the most fragile part of the
  automation. The spec uses role/text locators with generous timeouts and screenshots on
  failure; the `migrate` phase can be run as a manual checkpoint if the UI automation drifts.
- **Expired license** is a potential hard blocker (see prerequisites).
- **Production is never touched** by the test — it targets the development environment only.
