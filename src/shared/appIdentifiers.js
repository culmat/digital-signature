export const MARKETPLACE_APP_KEY = 'com.baloise.confluence.digital-signature';
export const CONFLUENCE_MACRO_KEY = 'digital-signature';
export const FORGE_APP_ID = 'bab5617e-dc42-4ca8-ad38-947c826fe58c';

/**
 * Sentinel `accountId` prefix for a migrated signature whose signer has no Cloud account — typically
 * a user who left the company: gone from the CMA `identity:user` mapping, so their DC userKey resolves
 * to no accountId. Rather than dropping the signature (losing the audit trail on a legal secrecy
 * declaration), the import preserves it as `${LEGACY_SIGNER_PREFIX}<dcUserKey>` in the EXISTING
 * `signature.accountId` column — no schema change, `(contractHash, accountId)` stays unique, and a
 * future cleanup can delete `legacy:*` rows in one statement. The render layer shows it as a
 * former-user chip; the live pending calc excludes it (see getPendingSignersResolver).
 *
 * This is a legacy migration corner case only — new signatures always store a real accountId.
 */
export const LEGACY_SIGNER_PREFIX = 'legacy:';

/** True when a stored signature `accountId` is a preserved legacy (former-user) signer. */
export const isLegacySigner = (accountId) =>
  typeof accountId === 'string' && accountId.startsWith(LEGACY_SIGNER_PREFIX);

/** The DC userKey/username preserved behind a legacy `accountId` (for display); pass-through otherwise. */
export const legacySignerLabel = (accountId) =>
  isLegacySigner(accountId) ? accountId.slice(LEGACY_SIGNER_PREFIX.length) : accountId;
