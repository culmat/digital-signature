/**
 * Migration resolver — scan for legacy Server macros and convert to Forge ADF.
 *
 * Reached from the admin settings page (migration tab). Access is gated in the
 * manifest by `displayConditions.isSiteAdmin` on the globalSettings module — only
 * site admins reach this surface.
 *
 * Page reads/writes go through {@link confluenceContentClient}, which auto-detects the
 * available Confluence REST API version (v2 preferred, v1 fallback) so the tool keeps
 * working as Atlassian retires the v1 content API.
 */

import { FORGE_APP_ID, CONFLUENCE_MACRO_KEY } from '../shared/appIdentifiers';
import { hasLegacyMacros, convertPageBody } from '../services/macroConversionService';
import { getPage, updatePage, searchPagesByCql } from '../services/confluenceContentClient';
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
      return await handleScan(payload);
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
 * Scan one page of CQL results for pages with legacy Server-format signature macros.
 *
 * Incremental: returns a single batch plus `{ offset, completed }` so the frontend can
 * loop (the same offset/`completed` contract used by backup-export and convert). This
 * keeps every invocation well under the 25s Forge function limit, even when scanning all
 * spaces.
 */
async function handleScan(payload) {
  const { spaceKey, offset = 0 } = payload;

  // Validate spaceKey to prevent CQL injection
  if (spaceKey && !SPACE_KEY_PATTERN.test(spaceKey)) {
    return errorResponse({ key: 'error.invalid_space_key' }, 400);
  }

  // CMA renames the macro to the full Forge extension key (…/static/digital-signature) during
  // migration, which a `macro="…"` CQL clause may not match — and freshly-migrated pages lag the
  // macro index. So for a SPACE-scoped scan, enumerate the space's pages and let the storage regex
  // (hasLegacyMacros, which matches legacy + the CMA-renamed form) decide — robust + bounded by the
  // space size. For a whole-instance scan, keep the macro filter so we don't read every page.
  const cql = spaceKey
    ? `type=page AND space="${spaceKey}"`
    : `type=page AND (macro="signature" OR macro="digital-signature")`;

  if (offset === 0) {
    console.log(`[migration-scan] CQL: ${cql}`);
  }

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

  return successResponse({
    pages,
    offset: batch.nextStart,
    completed: !batch.hasMore,
    stats: { totalMacros },
  });
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
      // Fetch current page body and version (auto-detects v2/v1)
      let page;
      try {
        page = await getPage(pageId);
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

      // Update page with converted body
      try {
        await updatePage(pageId, {
          title: page.title,
          status: page.status,
          storageValue: conversion.body,
          versionNumber: page.versionNumber,
        });
      } catch (updateErr) {
        console.error(`[migration-convert] Failed to update page ${pageId}: ${updateErr.message}`);
        results.push({ pageId, title: page.title, status: 'error', error: 'Update failed' });
        errors++;
        continue;
      }

      console.log(`[migration-convert] Converted page ${pageId} "${page.title}" (${conversion.macroCount} macros)`);
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
