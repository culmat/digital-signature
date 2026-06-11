/**
 * Version-aware Confluence content client.
 *
 * Confluence Cloud has begun removing the v1 content REST API on some sites:
 * `GET/PUT /wiki/rest/api/content/{id}` now returns `410 Gone`
 * ("This deprecated endpoint has been removed"). This client prefers the REST API
 * **v2** (`/wiki/api/v2/pages/{id}`) and transparently **falls back to v1** when v2 is
 * unavailable, **memoizing** the detected version so a warm function instance probes at
 * most once.
 *
 * Fallback only happens on 404/410 (the version is gone / not here). Auth (401/403),
 * rate-limit (429) and server (5xx) errors are surfaced as real errors so we never mask
 * a permission or transient problem behind a version switch.
 *
 * CQL search has no v2 equivalent, so `searchPagesByCql` stays on the (still-supported)
 * CQL search endpoint; its robustness comes from offset pagination, not version probing.
 */

import api, { route } from '@forge/api';

/** Detected content-API version for this warm instance: 'v2' | 'v1' | null (unknown). */
let contentApiVersion = null;

/** Status codes meaning "this API version is gone / not here" → try the other one. */
const VERSION_GONE_CODES = new Set([404, 410]);

/** Test/diagnostic hook — reset the memoized version. */
export function __resetContentApiVersion() {
  contentApiVersion = null;
}

/** Try the memoized version first (then the other as a self-healing fallback). */
function candidateVersions() {
  if (contentApiVersion === 'v1') return ['v1', 'v2'];
  return ['v2', 'v1']; // prefer v2 by default
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Run an operation against the candidate API versions, falling back on 404/410 only.
 * Returns `{ version, response }` for the first OK response and memoizes that version.
 */
async function withVersion(opName, runForVersion) {
  const versions = candidateVersions();
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i];
    const response = await runForVersion(version);

    if (response.ok) {
      if (contentApiVersion !== version) {
        console.log(`[content-client] using ${version} content API`);
        contentApiVersion = version;
      }
      return { version, response };
    }

    const status = response.status;
    const isLast = i === versions.length - 1;
    if (VERSION_GONE_CODES.has(status) && !isLast) {
      console.warn(`[content-client] ${opName}: ${version} returned ${status}, falling back to ${versions[i + 1]}`);
      continue;
    }
    throw new Error(`${opName} failed on ${version}: ${status} ${(await safeText(response)).slice(0, 200)}`);
  }
  throw new Error(`${opName} failed: no Confluence content API version available`);
}

function getPageRequest(version, pageId) {
  const url = version === 'v2'
    ? route`/wiki/api/v2/pages/${pageId}?body-format=storage`
    : route`/wiki/rest/api/content/${pageId}?expand=body.storage,version,space`;
  return api.asApp().requestConfluence(url, { headers: { Accept: 'application/json' } });
}

function updatePageRequest(version, pageId, { title, status, storageValue, versionNumber, message }) {
  const nextVersion = (versionNumber || 0) + 1;
  if (version === 'v2') {
    return api.asApp().requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        id: String(pageId),
        status: status || 'current',
        title,
        body: { representation: 'storage', value: storageValue },
        version: { number: nextVersion, message: message || 'Digital Signature macro migration' },
      }),
    });
  }
  return api.asApp().requestConfluence(route`/wiki/rest/api/content/${pageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      id: String(pageId),
      type: 'page',
      title,
      version: { number: nextVersion },
      body: { storage: { value: storageValue, representation: 'storage' } },
    }),
  });
}

function normalizePage(version, data) {
  if (version === 'v2') {
    return {
      id: String(data.id),
      title: data.title,
      status: data.status || 'current',
      versionNumber: data.version?.number ?? 1,
      storageValue: data.body?.storage?.value || '',
      spaceId: data.spaceId,
    };
  }
  return {
    id: String(data.id),
    title: data.title,
    status: data.status || 'current',
    versionNumber: data.version?.number ?? 1,
    storageValue: data.body?.storage?.value || '',
    spaceKey: data.space?.key,
  };
}

/**
 * Fetch a page's storage body + version.
 * @returns {Promise<{id,title,status,versionNumber,storageValue,spaceKey?,spaceId?}>}
 */
export async function getPage(pageId) {
  const { version, response } = await withVersion('getPage', (v) => getPageRequest(v, pageId));
  return normalizePage(version, await response.json());
}

/**
 * Update a page's storage body. Bumps version to `versionNumber + 1`.
 * @param {string|number} pageId
 * @param {{title:string,status?:string,storageValue:string,versionNumber:number,message?:string}} update
 */
export async function updatePage(pageId, update) {
  const { response } = await withVersion('updatePage', (v) => updatePageRequest(v, pageId, update));
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * One page of a CQL search. Offset-based to match the frontend batch contract.
 * @param {string} cql
 * @param {{start?:number, limit?:number}} opts
 * @returns {Promise<{pages:Array<{id,title,spaceKey,storageValue}>, nextStart:number, hasMore:boolean}>}
 */
export async function searchPagesByCql(cql, { start = 0, limit = 50 } = {}) {
  const url = route`/wiki/rest/api/content/search?cql=${cql}&limit=${limit}&start=${start}&expand=body.storage,space,version`;
  const response = await api.asApp().requestConfluence(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`CQL search failed: ${response.status} ${(await safeText(response)).slice(0, 200)}`);
  }
  const data = await response.json();
  const results = data.results || [];
  const pages = results.map((p) => ({
    id: String(p.id),
    title: p.title,
    spaceKey: p.space?.key || '?',
    storageValue: p.body?.storage?.value || '',
  }));
  return { pages, nextStart: start + results.length, hasMore: results.length === limit };
}
