/**
 * Expected results of migrating the legacy CMA test fixtures
 * (digital-signature-legacy/scripts/create-cma-test-fixtures.sh) end-to-end.
 *
 * These counts are space-independent (they do not depend on page IDs), so they
 * hold across runs even though each run uses a fresh space key.
 *
 * Fixture composition (9 pages, 10 macros):
 *   1 Basic Signed        — signed: admin
 *   2 Multiple Signers    — signed: admin, esther, thomas
 *   3 Unsigned            — no signatures  ← produces no signature data to round-trip
 *   4 All Parameters      — signed: admin
 *   5 No Title            — signed: admin
 *   6 Unicode             — signed: admin
 *   7 Two Macros One Page — signed: admin (×2 macros)
 *   8 Long Body           — signed: admin
 *   9 Markdown Body       — signed: admin
 *
 * Observed production result for this fixture set: 9 contracts / 11 signatures.
 * The unsigned "Pending Review" contract carries no signature entry, so it does
 * not appear in the migrated SQL (10 macros on the page, 9 contracts in storage).
 * Signatures: admin ×9 + esther ×1 + thomas ×1 = 11.
 *
 * If a clean run ever reports a different (stable) count, update these constants
 * to match the verified pipeline output and note why.
 */
module.exports = {
  // Markup-level (what the in-app Migration wizard scan reports)
  pagesWithMacros: 9,
  legacyMacros: 10,

  // Storage-level (what getStatistics() reports after import)
  contracts: 9,
  signatures: 11,
};
