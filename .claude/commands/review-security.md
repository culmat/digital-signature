# Review Security

You are a security engineer reviewing this digital signature Forge app. The app lets users sign Confluence documents — security is its core value proposition. Produce a structured findings report.

## Setup

Before reviewing, load Forge platform guidance:

1. Call `mcp__forge__forge-backend-developer-guide` to understand Forge runtime, resolver context, and trust boundaries
2. Read `AGENTS.md` for project conventions
3. Read `docs/signature-authorization.md` for the authorization algorithm
4. Read `docs/sql-schema-design.md` for the database schema

Then read ALL security-relevant source files:

- `src/resolvers/*.js` (all resolvers — the trust boundary between client and server)
- `src/utils/signatureAuthorization.js` (authorization decision logic)
- `src/utils/hash.js` (hash computation and validation)
- `src/resolvers/validation.js` (input validation)
- `src/storage/signatureStore.js` (database operations)
- `src/frontend/utils/signatureClient.js` (what the client sends to the server)
- `src/resolvers/adminDataResolver.js` (admin backup/restore — privileged operations)
- `src/pageLifecycleHandler.js` (signature deletion triggers)
- `src/shared/visibilityCheck.js` (visibility logic)

## Check categories

Run each check below. For each finding, record: `{file, line, severity, category, message}`.

### 1. Signature integrity (severity: error)

- Hash computation: verify SHA-256 input format is consistent (`pageId:title:content`) across frontend and backend — any inconsistency means signatures could be invalidated or forged
- Hash validation: verify the hash format regex is enforced on ALL code paths that accept a hash from the client (sign, getSignatures, checkAuthorization)
- Content normalization: verify that the same logical content always produces the same hash — check for whitespace normalization issues, encoding differences, or ADF/markdown transformation inconsistencies
- Verify that the hash is computed from raw content (not transformed or rendered content) so that display changes don't invalidate signatures

### 2. Authorization bypass prevention (severity: error)

- Config source: verify that ALL resolvers get macro configuration from `req.context.extension.config` (server-provided by Forge) and NEVER from `req.payload` — a client sending fake config could bypass signer restrictions entirely
- Identity source: verify `accountId` always comes from `req.context.accountId` (Forge-provided), never from client payload
- Double-check authorization: verify that `signResolver` re-checks `canUserSign()` before writing to the database, not relying solely on a prior `checkAuthorization` call from the frontend
- Permission escalation: verify that group membership and page permission checks use `api.asUser()` (not `api.asApp()`) to respect the current user's actual permissions
- Verify that petition mode (open signing) cannot be triggered by manipulating client data when the macro is configured to restrict signers

### 3. Data minimization — client exposure (severity: warning)

- Enumerate exactly what data each resolver returns to the client — list each field
- Flag any resolver that sends more data than the frontend strictly needs
- Verify macro configuration (signers list, group names, permission settings) is NEVER sent to the client — leaking this reveals who is expected to sign
- Verify admin endpoints (backup, restore, statistics) are properly gated and not accessible to non-admin users
- Check that error messages don't leak internal state: no stack traces, no SQL error details, no config values in error responses
- Check that the `reason` field in authorization responses doesn't reveal sensitive configuration (e.g., listing specific authorized signers in the denial message)

### 4. Signature immutability (severity: error)

- Verify no code path allows modifying or deleting an individual signature — only soft-delete of entire contracts via page lifecycle events should be possible
- Verify the DB schema enforces uniqueness: PRIMARY KEY on (contractHash, accountId) prevents duplicate signatures
- Check for SQL injection vectors: examine all SQL query construction for string interpolation or concatenation with user input — all queries must use parameterized statements
- Verify that `INSERT IGNORE` or duplicate key handling doesn't silently overwrite existing signature timestamps
- Verify that the backup/restore (import) flow cannot overwrite existing signatures or inject fabricated ones

### 5. Timing and race conditions (severity: warning)

- TOCTOU between authorization check and sign: if maxSignatures is set to N and N users sign simultaneously, can more than N signatures be recorded? Check whether the count + insert is atomic
- Duplicate signing: if two identical sign requests arrive before the first DB write completes, does the PRIMARY KEY constraint prevent both from succeeding?
- Content hash staleness: the frontend computes the hash, but the page could be edited between hash computation and the sign request — document whether this is by design (signing the content the user saw) or a vulnerability

### 6. Backup/restore security (severity: warning)

- Admin data export: verify it's gated behind admin authorization (Confluence globalSettings module or explicit admin check)
- Import validation: verify that imported data is validated — hash format (64-char hex), accountId format, timestamp validity — malicious import could inject arbitrary signatures
- Check for injection in import SQL parsing (if raw SQL is parsed from the backup)
- Verify that restore doesn't bypass the normal signature flow (e.g., inserting signatures for users who wouldn't have been authorized)

### 7. Forge platform trust boundaries (severity: error)

- Verify that `req.context` properties (accountId, extension.config, siteUrl) are treated as trusted (server-provided by Forge runtime) and not overridable by the client
- Verify that `req.payload` properties are treated as untrusted and validated before use
- Check that no resolver passes client payload data directly to Confluence REST API calls without validation
- Verify scopes in `manifest.yml` are minimal — no unnecessary read/write permissions

## Output format

Produce a Markdown report with this structure:

```
## Security Review — {date}

### Summary
- Critical: {count}
- Errors: {count}
- Warnings: {count}
- Info: {count}
- Overall security posture: {strong/adequate/weak} with rationale

### Trust Boundary Map
{Brief description of what the client can and cannot control}

### Critical / Errors (must fix)
#### [{category}] {title}
**File:** {file}:{line}
**Attack vector:** {how an attacker could exploit this}
**Impact:** {what goes wrong}
**Recommendation:** {specific fix}

### Warnings (should fix)
#### [{category}] {title}
**File:** {file}:{line}
**Risk:** {what could go wrong}
**Recommendation:** {specific fix}

### Info (observations)
#### [{category}] {title}
**File:** {file}:{line}
**Note:** {observation}

### Data Exposure Inventory
| Resolver | Data returned to client | Sensitive? | Notes |
|----------|----------------------|------------|-------|
| sign | ... | ... | ... |
| getSignatures | ... | ... | ... |
| ... | ... | ... | ... |

### Recommendations
{Prioritized list with estimated effort and impact}
```

Be context-aware: Forge provides built-in protections (tenant isolation, signed context, CSRF protection). Do not flag standard Forge patterns as vulnerabilities. Focus on application-level security issues specific to this digital signature use case.

## Apply changes

After completing the review, implement all fixes from the "Critical / Errors" and "Warnings" sections. Apply changes directly — do not ask for confirmation on individual fixes. Run `npx vitest run` after all changes to verify nothing is broken.
