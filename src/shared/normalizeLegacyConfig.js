/**
 * Normalizes a macro config that may have arrived in legacy Server/DC (P2)
 * parameter format after a Confluence Cloud Migration Assistant migration.
 *
 * Migrated macros are stored in Connect-like format until the user opens and
 * re-saves the config in Forge, at which point they are permanently written in
 * Forge format. This function handles the first-render case transparently.
 *
 * Parameter mapping:
 *
 *   body                → content          (rename)
 *   inheritSigners      → inheritViewers + inheritEditors  (enum split)
 *   maxSignatures -1    → undefined
 *   visibilityLimit -1  → undefined
 *   signaturesVisible   → uppercase  (e.g. "always" → "ALWAYS")
 *   pendingVisible      → uppercase
 *   notified            → dropped
 *   panel               → dropped
 *   protectedContent    → dropped
 *
 * signers and signerGroups are already resolved to Cloud IDs by the CMA
 * framework before the macro renders, so no transformation is needed here.
 */

const INHERIT_SIGNERS_MAP = {
  'none':                { inheritViewers: false, inheritEditors: false },
  'readers only':        { inheritViewers: true,  inheritEditors: false },
  'writers only':        { inheritViewers: false, inheritEditors: true  },
  'readers and writers': { inheritViewers: true,  inheritEditors: true  },
};

const VISIBILITY_UPPERCASE = {
  'always':       'ALWAYS',
  'if signatory': 'IF_SIGNATORY',
  'if signed':    'IF_SIGNED',
};

/**
 * Returns the config unchanged if it is already in Forge format, or with all
 * legacy fields translated to their Forge equivalents.
 *
 * @param {object|null|undefined} config - Value from useConfig()
 * @returns {object|null|undefined}
 */
export function normalizeLegacyConfig(config) {
  if (!config) return config;

  // Already Forge format: has inheritViewers but no inheritSigners
  if (!('inheritSigners' in config) && 'inheritViewers' in config) return config;

  const out = { ...config };

  // body → content (always drop body; only copy it if content isn't already set)
  if ('body' in out) {
    if (!('content' in out)) out.content = out.body;
    delete out.body;
  }

  // inheritSigners → inheritViewers + inheritEditors
  const inherit = INHERIT_SIGNERS_MAP[out.inheritSigners] ?? { inheritViewers: false, inheritEditors: false };
  out.inheritViewers = inherit.inheritViewers;
  out.inheritEditors = inherit.inheritEditors;
  delete out.inheritSigners;

  // -1 → undefined for numeric limits
  for (const field of ['maxSignatures', 'visibilityLimit']) {
    if (out[field] == null || out[field] === '') continue;
    const n = Number(out[field]);
    out[field] = n === -1 ? undefined : n;
  }

  // Lowercase enum strings → uppercase
  for (const field of ['signaturesVisible', 'pendingVisible']) {
    if (out[field]) {
      out[field] = VISIBILITY_UPPERCASE[out[field].toLowerCase()] ?? out[field];
    }
  }

  // Drop server-only fields
  delete out.notified;
  delete out.panel;
  delete out.protectedContent;

  return out;
}
