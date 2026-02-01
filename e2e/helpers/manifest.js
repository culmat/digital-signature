/**
 * Parse manifest.yml to extract app configuration.
 * Avoids hardcoding app IDs and macro keys in test code.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Path to manifest.yml (relative to project root)
const MANIFEST_PATH = path.resolve(__dirname, '../../manifest.yml');

let manifestCache = null;

/**
 * Load and parse manifest.yml.
 * @returns {object} Parsed manifest
 */
function loadManifest() {
  if (manifestCache) return manifestCache;

  const content = fs.readFileSync(MANIFEST_PATH, 'utf8');
  manifestCache = yaml.load(content);
  return manifestCache;
}

/**
 * Extract the app UUID from manifest.yml.
 * Parses the app.id field: "ari:cloud:ecosystem::app/{uuid}"
 * @returns {string} App UUID (e.g., "bab5617e-dc42-4ca8-ad38-947c826fe58c")
 */
function getAppId() {
  const manifest = loadManifest();
  const appAri = manifest.app?.id;

  if (!appAri) {
    throw new Error('app.id not found in manifest.yml');
  }

  // Extract UUID from ARI: "ari:cloud:ecosystem::app/{uuid}"
  const match = appAri.match(/app\/([a-f0-9-]+)$/);
  if (!match) {
    throw new Error(`Could not parse app UUID from: ${appAri}`);
  }

  return match[1];
}

/**
 * Get the first macro key from manifest.yml.
 * @returns {string} Macro key (e.g., "digital-signature-confluence-cloud-culmat")
 */
function getMacroKey() {
  const manifest = loadManifest();
  const macros = manifest.modules?.macro;

  if (!macros || macros.length === 0) {
    throw new Error('No macros found in manifest.yml');
  }

  return macros[0].key;
}

module.exports = {
  loadManifest,
  getAppId,
  getMacroKey,
};
