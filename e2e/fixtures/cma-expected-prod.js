/**
 * Expected results of migrating the PRODUCTION baloisenet CMA test fixtures
 * (digital-signature-legacy/scripts/create-baloisenet-fixtures.sh) end-to-end into
 * the production Forge installation on helvetia-baloise-mig1.atlassian.net.
 *
 * Differs from cma-expected.js (the local/dev fixtures) because the production
 * fixtures sign with REAL existing accounts chosen for their Cloud mapping, and
 * deliberately include one unmapped signer to exercise the skip path. The signer
 * entries are written directly into Bandana via ScriptRunner (no REST signing), so
 * any existing username can be referenced; CMA maps username→userKey→Cloud account
 * by email during the "Select all users" phase.
 *
 * Fixture composition (9 pages, 10 macros, 9 contracts):
 *   1 Basic Signed        — B028178
 *   2 Multiple Signers    — B028178, admin_b028178, g004641, L001403
 *   3 Unsigned            — (no signerGroups → no Bandana entry → no contract)
 *   4 All Parameters      — B028178
 *   5 No Title            — B028178
 *   6 Unicode             — B028178
 *   7 Two Macros One Page — B028178 (×2 macros)
 *   8 Long Body           — B028178
 *   9 Markdown Body       — B028178
 *
 * Signer → Cloud mapping (verified 2026-06-16):
 *   B028178       Matthias.Cullmann@baloise.ch  → 557058:6f929496  (active)        ALWAYS maps
 *   g004641       g004641@baloise.com           → 712020:2c8844e2  (managed)       ALWAYS maps
 *   admin_b028178 matthias.cullmann@baloise.com → 557058:3d1776be  (pending invite) UNCERTAIN — verify
 *   L001403       (no email)                    → —                               NEVER maps (skip path)
 *
 * Total signatures written on DC = B028178×9 + admin_b028178×1 + g004641×1 + L001403×1 = 12.
 * Contracts are created on Cloud regardless of signer mapping; only the inserted/skipped
 * split moves with whether admin_b028178 maps. Read the Forge handler's
 *   `[migration] Done: X contracts, Y inserted, Z skipped (no user mapping), W skipped (no page mapping)`
 * line and match against `adminMaps` / `adminUnmapped` below.
 *
 * Caveats:
 *  - `pagesSkipped` (W) counts contracts whose page is NOT in the migration plan. For a clean
 *    fresh-space run it is 0; if the export listener is NOT rebuilt with the space-scope filter,
 *    W will instead equal the number of other `signature.*` keys in the global Bandana store
 *    (thousands on production) — assert `W >= 0` rather than `=== 0` in that case.
 */
module.exports = {
  // Markup-level (what the in-app Migration wizard scan reports)
  pagesWithMacros: 9,
  legacyMacros: 10,

  // Storage-level: contracts are identical in both cases
  contracts: 9,

  // Case A — admin_b028178 maps (intended/expected)
  adminMaps: {
    signaturesInserted: 11, // B028178×9 + admin_b028178 + g004641
    signaturesSkipped: 1,   // L001403 (no email)
    pagesSkipped: 0,        // fresh-space run; see caveat if listener not rebuilt
  },

  // Case B — admin_b028178 does NOT map (pending invite never accepted)
  adminUnmapped: {
    signaturesInserted: 10, // B028178×9 + g004641
    signaturesSkipped: 2,   // admin_b028178 + L001403
    pagesSkipped: 0,
  },
};
