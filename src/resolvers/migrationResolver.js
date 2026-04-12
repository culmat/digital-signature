/**
 * Migration resolver — scan for legacy Server macros and convert to Forge ADF.
 *
 * Hidden admin feature: only accessible when admin appends ?migration=true to the
 * admin settings URL. No environment variables or CLI setup required.
 */

import api, { route } from '@forge/api';
import { FORGE_APP_ID, CONFLUENCE_MACRO_KEY } from '../shared/appIdentifiers';
import { hasLegacyMacros, convertPageBody } from '../services/macroConversionService';
import { successResponse, errorResponse } from '../utils/responseHelper';
import { isConfluenceAdmin } from '../utils/adminAuth';

/** Pages per CQL search request */
const CQL_PAGE_SIZE = 50;

/** Pages to convert per resolver invocation (within 25s Forge timeout) */
const CONVERT_BATCH_SIZE = 5;

/** Delay between page updates to avoid rate limiting (ms) */
const UPDATE_DELAY_MS = 200;

/** Strict pattern for Confluence space keys */
const SPACE_KEY_PATTERN = /^[A-Za-z0-9_~]+$/;

export async function migrationResolver(req) {
  const { context, payload } = req;
  const accountId = context.accountId;

  if (!accountId) {
    return errorResponse('error.unauthorized', 401);
  }

  const isAdmin = await isConfluenceAdmin(accountId);
  if (!isAdmin) {
    console.warn(`Non-admin user ${accountId} attempted to access migration`);
    return errorResponse('error.forbidden', 403);
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
 * Scan for pages with legacy Server-format signature macros via CQL.
 */
async function handleScan(payload) {
  const { spaceKey } = payload;

  // Validate spaceKey to prevent CQL injection
  if (spaceKey && !SPACE_KEY_PATTERN.test(spaceKey)) {
    return errorResponse({ key: 'error.invalid_space_key' }, 400);
  }

  const spaceCql = spaceKey ? ` AND space="${spaceKey}"` : '';
  const cql = `type=page${spaceCql} AND (macro="signature" OR macro="digital-signature")`;

  console.log(`[migration-scan] CQL: ${cql}`);

  const pages = [];
  let start = 0;
  let hasMore = true;

  while (hasMore) {
    const searchUrl = route`/wiki/rest/api/content/search?cql=${cql}&limit=${CQL_PAGE_SIZE}&start=${start}&expand=body.storage,space,version`;
    const response = await api.asApp().requestConfluence(searchUrl);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[migration-scan] CQL search failed: ${response.status} ${text}`);
      return errorResponse({ key: 'error.generic', params: { message: `CQL search failed: ${response.status}` } }, 500);
    }

    const data = await response.json();
    const results = data.results || [];

    for (const page of results) {
      const body = page.body?.storage?.value || '';
      if (hasLegacyMacros(body)) {
        // Count macros in page
        const macroRe = /<ac:structured-macro\s+ac:name="(?:signature|digital-signature)"/g;
        const macroCount = (body.match(macroRe) || []).length;

        pages.push({
          id: page.id,
          title: page.title,
          spaceKey: page.space?.key || '?',
          macroCount,
        });
      }
    }

    start += results.length;
    hasMore = results.length === CQL_PAGE_SIZE;
  }

  console.log(`[migration-scan] Found ${pages.length} pages with legacy macros`);

  return successResponse({
    pages,
    totalPages: pages.length,
    totalMacros: pages.reduce((sum, p) => sum + p.macroCount, 0),
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
      // Fetch current page body and version
      const getUrl = route`/wiki/rest/api/content/${pageId}?expand=body.storage,version`;
      const getResponse = await api.asApp().requestConfluence(getUrl);

      if (!getResponse.ok) {
        const text = await getResponse.text();
        console.error(`[migration-convert] Failed to fetch page ${pageId}: ${getResponse.status} ${text.substring ? text.substring(0,200) : text}`);
        results.push({ pageId, status: 'error', error: `Fetch failed: ${getResponse.status}` });
        errors++;
        continue;
      }

      const pageData = await getResponse.json();
      const body = pageData.body?.storage?.value || '';
      const version = pageData.version?.number || 1;
      const title = pageData.title;

      // Convert macros
      const conversion = convertPageBody(body, FORGE_APP_ID, envId, CONFLUENCE_MACRO_KEY);

      if (!conversion.converted) {
        results.push({ pageId, title, status: 'skipped', macroCount: 0 });
        skipped++;
        continue;
      }

      // Update page with converted body
      const putUrl = route`/wiki/rest/api/content/${pageId}`;
      const putResponse = await api.asApp().requestConfluence(putUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pageId,
          type: 'page',
          title,
          version: { number: version + 1 },
          body: {
            storage: {
              value: conversion.body,
              representation: 'storage',
            },
          },
        }),
      });

      if (!putResponse.ok) {
        const text = await putResponse.text();
        console.error(`[migration-convert] Failed to update page ${pageId}: ${putResponse.status} ${text.substring(0, 200)}`);
        results.push({ pageId, title, status: 'error', error: `Update failed: ${putResponse.status}` });
        errors++;
        continue;
      }

      console.log(`[migration-convert] Converted page ${pageId} "${title}" (${conversion.macroCount} macros)`);
      results.push({ pageId, title, status: 'converted', macroCount: conversion.macroCount });
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
