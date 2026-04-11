# Review Refactoring Opportunities

You are a senior JavaScript architect reviewing this Forge app codebase for refactoring opportunities. Produce a structured findings report.

## Setup

Before reviewing, load Forge backend guidance for context:

1. Call `mcp__forge__forge-backend-developer-guide` to understand Forge backend patterns
2. Read `AGENTS.md` for project conventions and guardrails
3. Read `CONTRIBUTING.md` for code quality principles
4. Read `docs/sql-schema-design.md` for the storage architecture

Then read ALL source files:

- `src/resolvers/*.js`
- `src/services/*.js`
- `src/storage/*.js`
- `src/utils/*.js`
- `src/shared/*.js`
- `src/shared/markdown/*.js`
- `src/pageLifecycleHandler.js`
- `src/index.js`

Also read all frontend files:

- `src/frontend/*.jsx`
- `src/frontend/**/*.jsx`

## Check categories

Run each check below. For each finding, record: `{file, line, severity, category, message}`.

### 1. Duplicate functions (severity: warning)

- Find ALL instances of identical or near-identical functions across files — flag duplicates that should import from a shared module
- Look for repeated patterns: error response construction, hash validation, config extraction from context, API call wrappers
- Any other functions with identical or near-identical bodies across files

### 2. Repeated structural patterns (severity: warning)

- Resolver boilerplate: compare how resolvers extract context, validate input, call services, and return responses — flag inconsistencies and consolidation opportunities
- Error response patterns: compare how resolvers handle try/catch — are they consistent? Flag inconsistencies
- API call patterns: repeated `requestConfluence` call + response check + JSON parsing sequences

### 3. Overly complex functions (severity: warning)

- Functions longer than ~60 lines that mix multiple concerns — flag with specific decomposition suggestions
- Deeply nested control flow (3+ levels of nesting) — flag and suggest flattening
- Functions with more than 4 parameters — suggest an options object
- `signatureAuthorization.js` likely has complex branching — review for simplification

### 4. Dead code and unused exports (severity: info)

- Exported functions that are never imported anywhere else in the codebase
- Unreachable code branches (conditions that can never be true based on call sites)
- Variables assigned but never read
- Parameters prefixed with `_` indicate intentionally unused — skip these

### 5. Module boundary improvements (severity: info)

- Files in `src/resolvers/` that contain business logic instead of delegating to `src/services/` or `src/utils/`
- Check if `src/shared/` modules are truly shared (used by 2+ consumers) or if some are single-use
- Flag any circular or surprising dependency patterns between layers
- Verify clear separation: resolvers (request handling) -> services (business logic) -> storage (data access)

### 6. Simplification opportunities (severity: info)

- Independent async operations that run sequentially but could use `Promise.all`
- Conversely, flag places where sequential execution is required but `Promise.all` is used (correctness check)
- Overly defensive code: null checks on values that can never be null based on the call chain
- Complex conditionals that could be simplified with early returns or guard clauses

### 7. Frontend-specific patterns (severity: info)

- State management: multiple `useState` calls that could be consolidated into a single state object or `useReducer`
- Effect dependencies: `useEffect` calls with missing or overly broad dependency arrays
- Inline `xcss()` calls that recreate styles on every render (should be extracted to module scope)
- Similar JSX blocks across frontend files that could be extracted into shared components

## Output format

Produce a Markdown report with this structure:

```
## Refactoring Review — {date}

### Summary
- Warnings: {count}
- Info: {count}
- Estimated total refactoring effort: {low/medium/high}

### Warnings
#### {category}: {title}
**Files:** {file1}, {file2}, ...
**Lines:** {file1}:{n}, {file2}:{n}
{Description of the duplication/complexity and concrete refactoring suggestion}

### Info / Opportunities
#### {category}: {title}
**Files:** {file1}, {file2}, ...
{Description and suggestion}

### Recommendations
{Prioritized list of refactoring actions, grouped by effort (quick wins vs. larger changes), with estimated impact on maintainability}
```

Be context-aware: if two functions look similar but serve intentionally different purposes (e.g., different auth contexts, different validation rules), explain WHY they are similar rather than blindly flagging them. Only flag genuinely consolidatable code.

Do NOT make any code changes — this is a read-only review.
