# TODO Audit Results

## Feature Status Table

| # | Feature | Status | Specified | Implemented | Tested |
|---|---------|--------|-----------|-------------|--------|
| **SIGNATURE DISPLAY & UX** | | | | | |
| 1 | Optimize for many signatures (sort, paginate, show latest 10) | in progress | no | partial | partial |
| 2 | visibilityLimit (collapse with "Show all" button) | done | no | ✅ | ✅ |
| 3 | Display user full name via users-bulk API | done | no | partial (uses `<User>` component) | ✅ |
| 4 | Panel mode toggle | done | no | won't do | — |
| 5 | Internationalization (i18n) | todo | no | ❌ | — |
| 6 | Review wording/usability | todo | no | ❌ | — |
| **MACRO CONFIGURATION** | | | | | |
| 7 | title | in progress | no | ✅ | ❌ |
| 8 | content | done | no | ✅ | ✅ |
| 9 | signers | done | no | ✅ | ✅ |
| 10 | signerGroups | done | no | ✅ | ✅ |
| 11 | inheritViewers | done | no | ✅ | ✅ |
| 12 | inheritEditors | done | no | ✅ | ✅ |
| 13 | maxSignatures | done | no | ✅ | ✅ |
| 14 | visibilityLimit | done | no | ✅ | ✅ |
| 15 | notified | done | no | won't do (not possible in Forge) | — |
| 16 | panel | done | no | won't do | — |
| 17 | protectedContent | done | no | won't do | — |
| 18 | signaturesVisible (ALWAYS/IF_SIGNATORY/IF_SIGNED) | done | no | ✅ | ✅ |
| 19 | pendingVisible (ALWAYS/IF_SIGNATORY/IF_SIGNED) | done | no | ✅ | ✅ |
| 20 | Petition mode | done | no | ✅ | ✅ |
| 21 | inheritSigners from page permissions (READERS_ONLY etc.) | todo | no | ❌ | ❌ |
| 22 | maxSignatures limit enforcement | done | no | ✅ | ✅ |
| 23 | Visibility controls implementation | done | no | ✅ | ✅ |
| **NOTIFICATIONS & EMAIL** | | | | | |
| 24 | Notified users list | todo | no | ❌ | — |
| 25 | In-app notifications on sign | todo | no | ❌ | — |
| 26 | Email notifications on sign | todo | no | ❌ | — |
| 27 | Mailto links with fallback | in progress | no | ✅ | partial |
| 28 | /emails endpoint | in progress | no | ✅ | partial |
| **EXPORT & SHARING** | | | | | |
| 29 | /export endpoint (printable HTML) | in progress | no | partial (ADF export) | partial |
| 30 | PDF export | in progress | no | partial (via Confluence ADF) | ❌ |
| **PROTECTED CONTENT** | | | | | |
| 31 | protectedContent feature | done | no | won't do | — |
| 32 | Auto-grant VIEW on sign | done | no | won't do | — |
| 33 | Signature hash as protected page key | done | no | won't do | — |
| **LIFECYCLE & CLEANUP** | | | | | |
| 34 | Event listener for page deletion | done | no | ✅ | ✅ |
| **ADMIN UI & BACKUP/RESTORE** | | | | | |
| 35 | Specification completed | done | ✅ backup-restore-spec.md | — | — |
| 36 | confluence:globalSettings module | in progress | ✅ backup-restore-spec.md | ✅ | ❌ |
| 37 | Admin UI (statistics, backup/restore) | in progress | ✅ backup-restore-spec.md | ✅ | ❌ |
| 38 | Admin authorization check | in progress | ✅ backup-restore-spec.md | ✅ | ❌ |
| 39 | Backup manager (SQL dump, gzip, base64) | in progress | ✅ backup-restore-spec.md | ✅ | ❌ |
| 40 | Admin data resolver (GET/PUT) | in progress | ✅ backup-restore-spec.md | ✅ | ❌ |
| 41 | Route in resolvers/index.js | in progress | ✅ backup-restore-spec.md | ✅ | ❌ |
| 42 | Test with large datasets | todo | ✅ backup-restore-spec.md | ❌ | ❌ |
| 43 | Cleanup UI in admin page | in progress | ✅ backup-restore-spec.md | ✅ | ❌ |
| **MISSING SIGNATURES TRACKING** | | | | | |
| 44 | Phase 1: Named signers only | done | ✅ pending-signatures-calculation.md | ✅ | ✅ |
| 45 | Sync missing list on config change | in progress | ✅ pending-signatures-calculation.md | partial | ❌ |
| 46 | Petition mode missing list shows "*" | in progress | ✅ pending-signatures-calculation.md | partial | ❌ |
| 47 | Phase 2: Group resolution for pending | todo | ✅ pending-signatures-calculation.md | ❌ | ❌ |
| 48 | Phase 3: Page permission inheritance for pending | todo | ✅ pending-signatures-calculation.md | ❌ | ❌ |
| **MIGRATION** | | | | | |
| 49 | Write migration specification | todo | partial (cloud-migration-assistant.md) | ❌ | — |
| 50 | Define common format (JSONL.gz) | todo | ✅ backup-restore-spec.md | ❌ | — |
| 51 | Export from legacy macro | todo | partial (cloud-migration-assistant.md) | ❌ | — |
| 52 | Import into forge macro | todo | partial (cloud-migration-assistant.md) | ❌ | — |

## Summary

| Status | Count |
|--------|-------|
| done | 22 |
| in progress | 15 |
| todo | 15 |

"In progress" = implemented but not fully tested, or partially implemented.
