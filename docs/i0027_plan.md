# i0027: Mailto links with fallback — complete tests

## Context

The mailto-with-fallback feature is fully implemented but only partially tested. The service layer (`emailService.js`) has good unit tests, but the resolver (`emailAddressesResolver.js`) has zero test coverage. The backlog item asks to "complete tests" — the resolver is the missing piece.

Frontend component tests are out of scope (Forge UI Kit components can't be unit-tested with vitest; the frontend is covered by e2e tests in `e2e/`).

## What exists

- **Service tests** (`test/services/emailService.test.js`): 8 tests covering `getEmailAddresses` and `buildMailtoUrl` — all edge cases covered
- **No resolver tests**: `emailAddressesResolver` has no test file

## Gap: resolver test coverage

The resolver at `src/resolvers/emailAddressesResolver.js` has these code paths to test:

1. **Validation** — rejects missing/empty/non-array `accountIds` → returns `errorResponse` with 400
2. **Happy path** — calls `getEmailAddresses`, builds mailto URL, returns `successResponse` with `users` + `mailto`
3. **Fallback path** — when mailto URL exceeds 2000 chars, `mailto` is `null` in response (users still returned)
4. **Default subject** — uses `'Digital Signature'` when no subject provided
5. **Error handling** — catches thrown errors and returns `errorResponse` with 500

## Plan

### Step 1: Create `test/resolvers/emailAddressesResolver.test.js`

Mock `../services/emailService` (both `getEmailAddresses` and `buildMailtoUrl`). Import real response helpers (they're pure functions — keeps assertions simple).

Tests to write:

```
describe('emailAddressesResolver')
  it('returns error when accountIds is missing')
  it('returns error when accountIds is empty array')
  it('returns error when accountIds is not an array')
  it('returns users and mailto url on success')
  it('returns null mailto when url exceeds limit')
  it('defaults subject to Digital Signature when not provided')
  it('filters null emails before building mailto url')
  it('returns error 500 when service throws')
```

### Step 2: Run tests and verify

```bash
npm test
```

## Files to modify

| Action | File |
|--------|------|
| Create | `test/resolvers/emailAddressesResolver.test.js` |

## Verification

- `npm test` passes with all new tests green
- No existing tests broken
