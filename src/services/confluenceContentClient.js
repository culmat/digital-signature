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

/**
 * Pick the request principal. Default `asApp` (the app's identity). Pass `asUser: true` to act as the
 * invoking user — used by the migration tool so a space admin can reach view-restricted pages the app
 * itself can't. Combining both principals (union of what each can see/edit) maximizes migration coverage.
 */
function client(asUser) {
  return asUser ? api.asUser() : api.asApp();
}

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

function getPageRequest(version, pageId, asUser) {
  const url = version === 'v2'
    ? route`/wiki/api/v2/pages/${pageId}?body-format=storage`
    : route`/wiki/rest/api/content/${pageId}?expand=body.storage,version,space`;
  return client(asUser).requestConfluence(url, { headers: { Accept: 'application/json' } });
}

function updatePageRequest(version, pageId, { title, status, storageValue, versionNumber, message }, asUser) {
  const nextVersion = (versionNumber || 0) + 1;
  if (version === 'v2') {
    return client(asUser).requestConfluence(route`/wiki/api/v2/pages/${pageId}`, {
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
  return client(asUser).requestConfluence(route`/wiki/rest/api/content/${pageId}`, {
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
export async function getPage(pageId, { asUser = false } = {}) {
  const { version, response } = await withVersion('getPage', (v) => getPageRequest(v, pageId, asUser));
  return normalizePage(version, await response.json());
}

/**
 * Update a page's storage body. Bumps version to `versionNumber + 1`.
 * @param {string|number} pageId
 * @param {{title:string,status?:string,storageValue:string,versionNumber:number,message?:string}} update
 */
export async function updatePage(pageId, update, { asUser = false } = {}) {
  const { response } = await withVersion('updatePage', (v) => updatePageRequest(v, pageId, update, asUser));
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
export async function searchPagesByCql(cql, { start = 0, limit = 50, asUser = false } = {}) {
  const url = route`/wiki/rest/api/content/search?cql=${cql}&limit=${limit}&start=${start}&expand=body.storage,space,version`;
  const response = await client(asUser).requestConfluence(url, { headers: { Accept: 'application/json' } });
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

/**
 * List page IDs/titles in a space via the REST **v2** API — index-independent (unlike CQL search,
 * which lags for freshly-migrated pages). Returns IDs only (no bodies) so callers can cheaply
 * intersect against a known set (e.g. SQL contract pageIds) before fetching full bodies.
 *
 * @param {string} spaceKey
 * @param {{cursor?:string, limit?:number}} opts  opaque v2 `cursor` from a prior call; default limit 250
 * @returns {Promise<{pages:Array<{id:string,title:string}>, nextCursor:string|null}>}
 */
export async function listSpacePageIds(spaceKey, { cursor, limit = 250, asUser = false } = {}) {
  // Resolve space key → numeric id (v2 has no list-by-key for pages). Requires read:space:confluence.
  const spaceResp = await client(asUser).requestConfluence(
    route`/wiki/api/v2/spaces?keys=${spaceKey}`, { headers: { Accept: 'application/json' } });
  if (!spaceResp.ok) {
    throw new Error(`space lookup failed: ${spaceResp.status} ${(await safeText(spaceResp)).slice(0, 200)}`);
  }
  const spaceId = (await spaceResp.json()).results?.[0]?.id;
  if (!spaceId) return { pages: [], nextCursor: null }; // space not found / not visible to the app

  const url = cursor
    ? route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&limit=${limit}&cursor=${cursor}`
    : route`/wiki/api/v2/spaces/${spaceId}/pages?status=current&limit=${limit}`;
  const resp = await client(asUser).requestConfluence(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    throw new Error(`list space pages failed: ${resp.status} ${(await safeText(resp)).slice(0, 200)}`);
  }
  const data = await resp.json();
  const pages = (data.results || []).map((p) => ({ id: String(p.id), title: p.title }));
  const next = data._links?.next;
  const m = next && /[?&]cursor=([^&]+)/.exec(next);
  return { pages, nextCursor: m ? decodeURIComponent(m[1]) : null };
}

/**
 * Union a space's current page IDs discovered under BOTH principals — the app (`asApp`) and the
 * invoking user (`asUser`) — so view-restricted pages one principal can't see are still included when
 * the other can. Fully paginates each principal (bounded by `maxPages`), never throws (a failing
 * principal — e.g. `asUser` not consented — is logged and skipped). Returns Map(pageId → title).
 */
export async function unionSpacePageIds(spaceKey, { maxPages = 10000 } = {}) {
  const into = new Map();
  for (const asUser of [false, true]) {
    let listed = 0;
    try {
      let cursor;
      do {
        const { pages, nextCursor } = await listSpacePageIds(spaceKey, { cursor, asUser });
        for (const p of pages) { into.set(String(p.id), p.title); listed += 1; }
        cursor = nextCursor;
      } while (cursor && listed < maxPages);
    } catch (error) {
      console.warn(`[content-client] unionSpacePageIds ${spaceKey} (asUser=${asUser}): ${error.message}`);
    }
    console.log(`[content-client] unionSpacePageIds ${spaceKey}: asUser=${asUser} listed ${listed}`);
  }
  return into;
}
