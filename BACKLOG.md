# Backlog

- i0027: Mailto links with fallback — complete tests
- i0028: /emails endpoint — complete tests
- i0029: /export endpoint (printable HTML)
- i0030: PDF export
- i0036: Admin globalSettings module — add tests
- i0037: Admin UI (statistics, backup/restore) — add tests
- i0038: Admin authorization check — add tests
- i0039: Backup manager (SQL dump, gzip, base64) — add tests
- i0040: Admin data resolver (GET/PUT) — add tests
- i0041: Admin route in resolvers/index.js — add tests
- i0043: Admin cleanup UI — add tests
- i0045: Sync missing signers list on config change
- i0046: Petition mode missing list shows "*"
- i0005: Internationalization (i18n)
- i0006: Review wording/usability
- i0021: inheritSigners from page permissions
- i0024: Notified users list
- i0025: In-app notifications on sign
- i0026: Email notifications on sign
- i0042: Admin: test with large datasets
- i0047: Group resolution for pending signatures
- i0048: Page permission inheritance for pending signatures
- i0049: Write migration specification
- i0050: Define common migration format (JSONL.gz)
- i0051: Export from legacy macro
- i0052: Import into forge macro

## Archive (do not reuse IDs)
- i0007: Macro config: title validation and tests (done)
- i0002: visibilityLimit collapse with "Show all" button (done)
- i0003: Display user full name via users-bulk API (done)
- i0004: Panel mode toggle (wontdo)
- i0008: Macro config: content (done)
- i0009: Macro config: signers (done)
- i0010: Macro config: signerGroups (done)
- i0011: Macro config: inheritViewers (done)
- i0012: Macro config: inheritEditors (done)
- i0013: Macro config: maxSignatures (done)
- i0014: Macro config: visibilityLimit (done)
- i0015: Macro config: notified (wontdo — not possible in Forge)
- i0016: Macro config: panel (wontdo)
- i0017: Macro config: protectedContent (wontdo)
- i0018: Macro config: signaturesVisible (done)
- i0019: Macro config: pendingVisible (done)
- i0020: Petition mode (done)
- i0022: maxSignatures limit enforcement (done)
- i0023: Visibility controls implementation (done)
- i0031: protectedContent feature (wontdo)
- i0032: Auto-grant VIEW on sign (wontdo)
- i0033: Signature hash as protected page key (wontdo)
- i0034: Event listener for page deletion (done)
- i0035: Backup/restore specification (done)
- i0001: Optimize for many signatures; sort by signed timestamp (done)
- i0044: Missing signatures Phase 1: named signers only (done)

<!-- next-id: i0053 -->

<!--
CONVENTIONS

PRIORITY
- Top = highest priority
- Order in Backlog section = priority
- Reprioritize by moving lines up/down

ID FORMAT
- Sequential, fixed width: i0001
- ID is permanent and never changes
- Title is mutable
- Never reuse IDs
- next-id above is authoritative

CREATING A NEW ITEM
1. Use the value in <!-- next-id -->
2. Add the new line at the bottom of the Backlog section
3. Increment next-id

COMMIT MESSAGES
- Preferred: i0001: short description

OPENSPEC MAPPING
- backlog plan i0001 creates openspec change i0001-short-slug
- The i0001 prefix is the shared key between backlog and openspec

ARCHIVING ITEMS
- Move done items to Archive
- Add short reason (e.g. duplicate, wontdo)
- IDs remain reserved forever
-->
