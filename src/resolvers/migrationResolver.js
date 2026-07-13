/**
 * Migration resolver — scan for legacy Server macros and convert to Forge ADF.
 *
 * Reached from two surfaces: the global admin settings page (`isSiteAdmin`) and the per-space
 * Space Settings page (`isSpaceAdmin`). The Space Settings surface locks the scope to its own space
 * (derived server-side from `context.extension.space`, not the client).
 *
 * Discovery and conversion combine BOTH request principals — the app (`asApp`) and the invoking admin
 * (`asUser`) — and union what each can reach, so view-restricted pages the app can't see are still
 * found/healed when the acting user (e.g. a space admin) can. Conversion is idempotent and healing-only
 * (moves the macro body into the `content` guest-param; skips already-converted macros), so reaching
 * more pages can only help.
 *
 * Page reads/writes go through {@link confluenceContentClient}, which auto-detects the available
 * Confluence REST API version (v2 preferred, v1 fallback) so the tool keeps working as Atlassian
 * retires the v1 content API.
 */

import sql from '@forge/sql';
import { FORGE_APP_ID, CONFLUENCE_MACRO_KEY } from '../shared/appIdentifiers';
import { hasLegacyMacros, convertPageBody } from '../services/macroConversionService';
import { getPage, updatePage, searchPagesByCql, unionSpacePageIds } from '../services/confluenceContentClient';
import { successResponse, errorResponse } from '../utils/responseHelper';

/** Pages per CQL search request — one batch per scan invocation (stays under 25s). */
const CQL_PAGE_SIZE = 50;

/** Pages to convert per resolver invocation (within 25s Forge timeout) */
const CONVERT_BATCH_SIZE = 5;

/** Delay between page updates to avoid rate limiting (ms) */
const UPDATE_DELAY_MS = 200;

/** Strict pattern for Confluence space keys */
const SPACE_KEY_PATTERN = /^[A-Za-z0-9_~]+$/;

/** Counts convertible signature macros (legacy names + the CMA-renamed Forge-key form). */
function countLegacyMacros(storageBody) {
  const macroRe = /<ac:structured-macro\s+ac:name="(?:signature|digital-signature|[^"]*\/static\/digital-signature)"/g;
  return (storageBody.match(macroRe) || []).length;
}

export async function migrationResolver(req) {
  const { context, payload } = req;
  const accountId = context.accountId;

  if (!accountId) {
    return errorResponse('error.unauthorized', 401);
  }

  try {
    const action = payload?.action;

    if (action === 'migrationScan') {
      // Space Settings locks scope to its own space (server-derived from context, not client-trusted);
      // the global surface uses the payload spaceKey (or empty → whole-instance).
      const spaceKey = context?.extension?.space?.key || payload?.spaceKey;
      return await handleScan({ ...payload, spaceKey });
    } else if (action === 'migrationConvert') {
      return await handleConvert(payload);
    } else {
      return errorResponse({ key: 'error.unknown_action', params: { action } }, 400);
    }
  } catch (error) {
    console.error('Migration resolver error:', error);
    return errorResponse({ key: 'error.generic', params: { message: error.message } }, 500);
  }
}

/**
 * Discover pages whose signature macros need converting. Incremental: one batch + `{ offset,
 * completed }` per call (the shared frontend loop), under the 25s Forge limit.
 *
 * Space-scoped (the migration workflow): intersect the space's page IDs (v2 list — index-independent,
 * so it sees freshly-migrated pages that CQL doesn't) with the pages that actually carry migrated
 * signatures (SQL `contract` table). Reads NO page bodies during discovery and never touches other
 * spaces. Whole-instance (no spaceKey): best-effort CQL macro search (index-dependent).
 */
async function handleScan(payload) {
  const { spaceKey, offset = 0 } = payload;

  if (spaceKey && !SPACE_KEY_PATTERN.test(spaceKey)) {
    return errorResponse({ key: 'error.invalid_space_key' }, 400);
  }

  if (spaceKey) {
    return handleScanSpace(spaceKey, offset);
  }

  // Whole-instance: CQL macro search (index-dependent; won't see freshly-migrated pages).
  const cql = `type=page AND (macro="signature" OR macro="digital-signature")`;
  if (offset === 0) console.log(`[migration-scan] CQL: ${cql}`);
  let batch;
  try {
    batch = await searchPagesByCql(cql, { start: offset, limit: CQL_PAGE_SIZE });
  } catch (error) {
    console.error(`[migration-scan] ${error.message}`);
    return errorResponse({ key: 'error.generic', params: { message: 'CQL search failed' } }, 500);
  }
  const pages = [];
  let totalMacros = 0;
  for (const page of batch.pages) {
    if (hasLegacyMacros(page.storageValue)) {
      const macroCount = countLegacyMacros(page.storageValue);
      pages.push({ id: page.id, title: page.title, spaceKey: page.spaceKey, macroCount });
      totalMacros += macroCount;
    }
  }
  console.log(`[migration-scan] batch @${offset}: ${pages.length} pages with legacy macros${batch.hasMore ? '' : ' (scan complete)'}`);
  return successResponse({ pages, offset: batch.nextStart, completed: !batch.hasMore, stats: { totalMacros } });
}

/**
 * Space-scoped scan. Unions the space's page IDs discovered under BOTH principals (app + invoking
 * admin) so view-restricted pages the app can't see are still found when the acting user can, then
 * intersects the union with SQL `contract` pageIds to return the signed pages needing conversion.
 * Fully paginated per call (spaces are small); returns `completed: true` in one shot.
 */
async function handleScanSpace(spaceKey) {
  const counts = await contractPageCounts();
  const idToTitle = await unionSpacePageIds(spaceKey);

  const pages = [];
  let totalMacros = 0;
  for (const [id, title] of idToTitle) {
    const cnt = counts.get(id);
    if (cnt) {
      pages.push({ id, title, spaceKey, macroCount: cnt });
      totalMacros += cnt;
    }
  }

  console.log(`[migration-scan] space=${spaceKey}: ${idToTitle.size} unique pages (asApp∪asUser), ${pages.length} with migrated signatures`);
  return successResponse({ pages, offset: 0, completed: true, stats: { totalMacros } });
}

/** Map of Cloud pageId → number of non-deleted migrated contracts on that page. */
async function contractPageCounts() {
  const result = await sql
    .prepare('SELECT pageId, COUNT(*) AS cnt FROM contract WHERE deletedAt IS NULL GROUP BY pageId')
    .execute();
  const rows = result?.rows || result || [];
  const map = new Map();
  for (const r of rows) map.set(String(r.pageId), Number(r.cnt));
  return map;
}

/**
 * Read a page as the app first; if the app can't see it (restricted → 404/error), retry as the
 * invoking admin (e.g. a space admin who can). Returns the page + which principal succeeded, so the
 * subsequent write uses the same principal. Throws only if BOTH principals fail.
 */
async function fetchPageAnyPrincipal(pageId) {
  try {
    return { page: await getPage(pageId, { asUser: false }), asUser: false };
  } catch (appErr) {
    try {
      return { page: await getPage(pageId, { asUser: true }), asUser: true };
    } catch (userErr) {
      throw new Error(`app: ${appErr.message}; user: ${userErr.message}`);
    }
  }
}

/**
 * Convert legacy macros on a batch of pages to Forge ADF format.
 * Called repeatedly by the frontend until all pages are processed.
 */
async function handleConvert(payload) {
  const { pageIds, offset = 0, envId } = payload;

  if (!envId) {
    return errorResponse({ key: 'error.generic', params: { message: 'Missing envId' } }, 400);
  }

  if (!pageIds || pageIds.length === 0) {
    return successResponse({ completed: true, results: [], offset: 0, stats: { processed: 0, converted: 0, skipped: 0, errors: 0 } });
  }

  const batch = pageIds.slice(offset, offset + CONVERT_BATCH_SIZE);
  const results = [];
  let converted = 0;
  let skipped = 0;
  let errors = 0;

  for (const pageId of batch) {
    try {
      // Fetch current page body + version, as the app or (if restricted) the invoking admin.
      let page;
      let asUser;
      try {
        ({ page, asUser } = await fetchPageAnyPrincipal(pageId));
      } catch (fetchErr) {
        console.error(`[migration-convert] Failed to fetch page ${pageId}: ${fetchErr.message}`);
        results.push({ pageId, status: 'error', error: 'Fetch failed' });
        errors++;
        continue;
      }

      // Convert macros
      const conversion = convertPageBody(page.storageValue, FORGE_APP_ID, envId, CONFLUENCE_MACRO_KEY);

      if (!conversion.converted) {
        results.push({ pageId, title: page.title, status: 'skipped', macroCount: 0 });
        skipped++;
        continue;
      }

      // Update page with converted body — as the SAME principal that could read it.
      try {
        await updatePage(pageId, {
          title: page.title,
          status: page.status,
          storageValue: conversion.body,
          versionNumber: page.versionNumber,
        }, { asUser });
      } catch (updateErr) {
        console.error(`[migration-convert] Failed to update page ${pageId}: ${updateErr.message}`);
        results.push({ pageId, title: page.title, status: 'error', error: 'Update failed' });
        errors++;
        continue;
      }

      console.log(`[migration-convert] Converted page ${pageId} "${page.title}" (${conversion.macroCount} macros, asUser=${asUser})`);
      results.push({ pageId, title: page.title, status: 'converted', macroCount: conversion.macroCount });
      converted++;

      // Rate limit delay
      await new Promise(r => setTimeout(r, UPDATE_DELAY_MS));

    } catch (err) {
      console.error(`[migration-convert] Error on page ${pageId}:`, err);
      results.push({ pageId, status: 'error', error: err.message });
      errors++;
    }
  }

  const nextOffset = offset + batch.length;
  const completed = nextOffset >= pageIds.length;

  return successResponse({
    completed,
    results,
    offset: nextOffset,
    stats: { processed: batch.length, converted, skipped, errors },
  });
}
