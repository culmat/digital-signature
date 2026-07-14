/**
 * Convert-storage resolver — the pure macro-body transform behind the page-editor "Convert" button.
 *
 * The macro view (src/frontend/index.jsx), on detecting an unconverted (post-CMA) signature macro,
 * reads the page storage via @forge/bridge `requestConfluence` (the viewer's own product session, which
 * reaches even view-restricted pages the app's server principals can't) and hands the raw storage here.
 * This resolver runs the pure {@link convertPageBody} transform and returns the converted storage; the
 * frontend writes it back with `requestConfluence` and calls `view.refresh()`.
 *
 * It makes ZERO Confluence calls — no `api.asUser()`, no `api.asApp()` — so it triggers no Forge 3LO
 * consent prompt, and the (legal/compliance) contract text only passes through in memory: it is never
 * stored in the DB, only moved back into the page body where it belongs.
 *
 * Wired UNWRAPPED in ./index.js (no DB access → skip schema-migration init), mirroring getVersionInfo.
 */

import { FORGE_APP_ID, CONFLUENCE_MACRO_KEY } from '../shared/appIdentifiers';
import { convertPageBody } from '../services/macroConversionService';
import { successResponse, errorResponse } from '../utils/responseHelper';

export function convertStorageResolver(req) {
  const { storage, envId } = req?.payload || {};
  if (!storage) {
    return errorResponse({ key: 'error.generic', params: { message: 'Missing storage' } }, 400);
  }
  if (!envId) {
    return errorResponse({ key: 'error.generic', params: { message: 'Missing envId' } }, 400);
  }

  // Pure, idempotent transform: legacy `<ac:structured-macro>` → Forge `<ac:adf-extension>` with the
  // body moved into the `content` guest-param. `converted` is false (no write needed) when the storage
  // holds no legacy macros — e.g. an already-healed page or a genuinely empty macro.
  const { converted, body, macroCount } = convertPageBody(
    storage,
    FORGE_APP_ID,
    envId,
    CONFLUENCE_MACRO_KEY,
  );

  return successResponse({ converted, body, macroCount });
}
