# Review Robustness and Error Handling

You are a production reliability engineer reviewing this Forge app for robustness. The app implements digital signatures for Confluence documents and must be reliable — a lost or corrupted signature has real consequences. Produce a structured findings report.

## Setup

Before reviewing, load Forge platform guidance:

1. Call `mcp__forge__forge-backend-developer-guide` to understand Forge runtime limits (timeouts, memory, rate limits)
2. Read `AGENTS.md` for project conventions
3. Read `docs/sql-schema-design.md` for the database schema and constraints
4. Read `docs/signature-authorization.md` for the authorization flow

Then read ALL backend source files:

- `src/resolvers/*.js`
- `src/storage/*.js`
- `src/storage/migrations/*.js`
- `src/utils/*.js`
- `src/services/*.js`
- `src/shared/*.js`
- `src/pageLifecycleHandler.js`
- `src/index.js`

## Check categories

Run each check below. For each finding, record: `{file, line, severity, category, message}`.

### 1. Error handling coverage (severity: error)

- Every `requestConfluence()` / `requestJira()` call must check `response.ok` — find any that do not
- Every resolver must wrap its body in try/catch and return a structured error — find any that throw uncaught exceptions to the Forge runtime
- Forge SQL queries can fail (connection issues, constraint violations) — verify all `sql()` calls are wrapped in try/catch with meaningful error handling
- `invoke()` calls from the frontend — verify the frontend handles error responses gracefully

### 2. Error context and logging (severity: warning)

- Every `console.error()` should include enough context to debug in production: at minimum the operation name and entity ID (pageId, hash, accountId)
- Find `console.error` calls that only log `error` without context
- Find operations that silently swallow errors (return false/null without logging)
- Verify there is no sensitive data in logs (accountIds are fine, but full config objects, SQL errors with query text, or hash values that could be correlated would not be)

### 3. Forge SQL reliability (severity: error)

- Transaction handling: operations that write to multiple tables (e.g., contract + signature) — verify they use transactions or handle partial failure
- Migration idempotency: verify all migrations use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... IF NOT EXISTS` patterns
- Connection handling: verify the app handles SQL connection timeouts gracefully
- Query result handling: verify empty result sets don't cause null pointer exceptions

### 4. Data integrity (severity: error)

- Signature write atomicity: `putSignature` inserts a contract row then a signature row — if the second insert fails, is the orphan contract row harmful?
- Soft delete consistency: when a page is trashed, verify ALL contracts for that pageId are soft-deleted, not just the first match
- Hard delete completeness: when hard-deleting, verify both contract AND signature rows are removed
- Backup/restore integrity: verify that import doesn't create inconsistent state (signatures without contracts, duplicate entries)

### 5. Edge cases (severity: warning)

- What happens when `getSignature(hash)` returns null and the caller doesn't check?
- What happens when the Confluence REST API returns a non-JSON response (e.g., HTML error page)?
- What happens when a user's account is deactivated but they have existing signatures?
- What happens when the page lifecycle handler fires but the database hasn't been migrated yet?
- What happens when `maxSignatures` is set to 0 or a negative number?
- What happens when the macro config has empty strings for title or content?

### 6. API call resilience (severity: warning)

- Confluence REST API calls: check for timeout handling and retry logic
- Rate limiting: if multiple API calls are made in sequence (e.g., checking group membership for multiple groups), estimate whether this could hit Forge's rate limit (100 API calls per 10 seconds)
- API response validation: verify responses are checked for expected shape before accessing nested properties

### 7. Resource limits (severity: info)

- Forge SQL query limits: verify queries don't return unbounded result sets (should have LIMIT clauses or pagination)
- Forge function timeout: sync functions have 25-second limit — verify no code path could exceed this (e.g., checking many groups + page permissions sequentially)
- Response payload size: verify resolver responses don't grow unbounded (e.g., a contract with thousands of signatures)

## Output format

Produce a Markdown report with this structure:

```
## Robustness Review — {date}

### Summary
- Errors: {count}
- Warnings: {count}
- Info: {count}
- Overall reliability assessment: {high/medium/low} with rationale

### Errors (must fix)
#### [{category}] {title}
**File:** {file}:{line}
**Impact:** {what goes wrong in production}
**Recommendation:** {specific fix}

### Warnings (should fix)
#### [{category}] {title}
**File:** {file}:{line}
**Impact:** {what could go wrong}
**Recommendation:** {specific fix}

### Info (consider)
#### [{category}] {title}
**File:** {file}:{line}
**Note:** {observation and suggestion}

### Recommendations
{Prioritized list with estimated effort and impact, ordered by risk severity}
```

Be context-aware: Forge has specific runtime constraints that differ from traditional Node.js servers. Do not flag patterns that are standard Forge idioms (e.g., using `@forge/api` route tagged templates for safe URL construction). Focus on issues that would manifest in production.

Do NOT make any code changes — this is a read-only review.
