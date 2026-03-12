import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAppId, getMacroKey } from '../e2e/helpers/manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const identifiersModulePath = path.resolve(__dirname, '../src/shared/appIdentifiers.js');

async function loadIdentifiers() {
  if (!existsSync(identifiersModulePath)) {
    return null;
  }

  return import(pathToFileURL(identifiersModulePath).href);
}

describe('canonical app identifiers', () => {
  it('keeps the canonical identifiers stable', async () => {
    const identifiers = await loadIdentifiers();

    expect(identifiers).not.toBeNull();
    expect(identifiers.MARKETPLACE_APP_KEY).toBe('com.baloise.confluence.digital-signature');
    expect(identifiers.CONFLUENCE_MACRO_KEY).toBe('digital-signature');
    expect(identifiers.FORGE_APP_ID).toBe('bab5617e-dc42-4ca8-ad38-947c826fe58c');
  });

  it('keeps the manifest aligned with the canonical macro and app IDs', () => {
    expect(getMacroKey()).toBe('digital-signature');
    expect(getAppId()).toBe('bab5617e-dc42-4ca8-ad38-947c826fe58c');
  });
});
