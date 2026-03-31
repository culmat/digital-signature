// Resolver for calculating pending signers dynamically.
//
// "Pending" = all users authorized to sign minus those who already signed.
//
// The full authorized set requires server-side API calls because:
//   - Group memberships must be resolved by querying the Confluence groups API
//   - Page permission users must be resolved by querying the restriction API
//
// This is Phase 2+3 of the pending signatures calculation spec
// (docs/pending-signatures-calculation.md).
//
// IMPORTANT: Confluence permission model
// EDIT permission implies VIEW permission. When inheritEditors is false, users
// with EDIT permission must be excluded from the inheritViewers set.

import api, { route } from "@forge/api";
import { successResponse, errorResponse } from '../utils/responseHelper';

/**
 * Makes an authenticated Confluence API request as the current user.
 */
async function fetchConfluenceAPI(routePath, errorContext) {
  const res = await api.asUser().requestConfluence(routePath);
  if (!res.ok) {
    throw new Error(`${errorContext}: HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * Returns all accountIds who are members of the given Atlassian group.
 * Paginates automatically (200 per page) to handle large groups.
 *
 * @param {string} groupId - Atlassian group ID (UUID)
 * @returns {Promise<Set<string>>}
 */
async function getGroupMembers(groupId) {
  const members = new Set();
  let start = 0;
  const limit = 200;

  while (true) {
    const data = await fetchConfluenceAPI(
      route`/wiki/rest/api/group/${groupId}/membersByGroupId?limit=${limit}&start=${start}`,
      `Failed to get members of group ${groupId}`
    );

    const results = data?.results || [];
    results.forEach(user => {
      if (user.accountId) members.add(user.accountId);
    });

    // Fewer results than limit means we've reached the last page
    if (results.length < limit) break;
    start += limit;
  }

  return members;
}

/**
 * Returns all accountIds with a given permission on a page, including users
 * added via group restrictions.
 *
 * Returns null when the page has no restrictions for that operation (meaning
 * all Confluence users have that permission and we can't enumerate them).
 *
 * @param {string} pageId - Confluence page ID
 * @param {"VIEW"|"EDIT"} operation
 * @returns {Promise<Set<string>|null>} null = unrestricted (everyone has it)
 */
async function getPagePermissionUsers(pageId, operation) {
  const op = operation === "VIEW" ? "read" : "update";

  const data = await fetchConfluenceAPI(
    route`/wiki/rest/api/content/${pageId}/restriction/byOperation/${op}`,
    `Failed to get ${op} restrictions for page ${pageId}`
  );

  // If the API response has no restrictions object, assume unrestricted
  if (!data?.restrictions) return null;

  const userResults = data.restrictions.user?.results || [];
  const groupResults = data.restrictions.group?.results || [];

  // If both user and group lists are empty, the page is unrestricted for this operation
  if (userResults.length === 0 && groupResults.length === 0) return null;

  const users = new Set();

  // Add directly listed users
  userResults.forEach(user => {
    if (user.accountId) users.add(user.accountId);
  });

  // Resolve groups listed in the restriction to individual accountIds
  for (const group of groupResults) {
    if (group.id) {
      try {
        const groupMembers = await getGroupMembers(group.id);
        groupMembers.forEach(id => users.add(id));
      } catch (e) {
        // Log and continue — a failed group lookup should not block the entire calculation
        console.error(`Failed to resolve group ${group.id} from page ${pageId} ${op} restrictions:`, e);
      }
    }
  }

  return users;
}

/**
 * Resolver: calculate pending signers for a macro configuration.
 *
 * Config is read from the Forge extension context (server-side), consistent
 * with all other resolvers. This avoids sending the config over the wire and
 * prevents frontend reference-instability from affecting the useEffect that
 * triggers this call.
 *
 * Payload:
 *   pageId          {string}   - Confluence page ID
 *   signedAccountIds {string[]} - AccountIds that have already signed
 *
 * Response:
 *   pending         {string[]} - AccountIds who are authorized but haven't signed yet
 *   isPetitionMode  {boolean}  - True if no restrictions are configured (pending list not applicable)
 */
export async function getPendingSignersResolver(req) {
  // Config lives on the server context, the same as in checkAuthorizationResolver
  const config = req.context?.extension?.config || {};
  const { pageId, signedAccountIds = [] } = req.payload || {};

  console.log('[getPendingSigners] called — pageId:', pageId,
    '| inheritViewers:', config.inheritViewers,
    '| inheritEditors:', config.inheritEditors,
    '| signers:', (config.signers || []).length,
    '| signerGroups:', (config.signerGroups || []).length);

  if (!pageId) {
    return errorResponse({ key: 'error.missing_fields', params: { fields: 'pageId' } }, 400);
  }

  try {
    // Petition mode: no restrictions at all — anyone can sign, pending list is not meaningful
    const hasNoRestrictions =
      (!config.signers || config.signers.length === 0) &&
      (!config.signerGroups || config.signerGroups.length === 0) &&
      !config.inheritViewers &&
      !config.inheritEditors;

    if (hasNoRestrictions) {
      return successResponse({ pending: [], isPetitionMode: true });
    }

    const authorizedUsers = new Set();

    // 1. Named signers — from config directly
    (config.signers || []).forEach(id => authorizedUsers.add(id));

    // 2. Group members — resolve each configured group
    for (const groupId of (config.signerGroups || [])) {
      try {
        const members = await getGroupMembers(groupId);
        members.forEach(id => authorizedUsers.add(id));
      } catch (e) {
        console.error(`Failed to resolve signer group ${groupId}:`, e);
        // Skip this group and continue with the remaining ones
      }
    }

    // 3. Page viewers — only VIEW-only users when inheritEditors is false.
    // Editors appear in both VIEW and EDIT restriction lists (EDIT implies VIEW in Confluence),
    // so we must explicitly exclude them when inheritEditors is disabled.
    if (config.inheritViewers) {
      try {
        const viewerSet = await getPagePermissionUsers(pageId, "VIEW");

        if (viewerSet === null) {
          // Page VIEW is unrestricted — can't enumerate all Confluence users,
          // so we can't calculate a pending list for this dimension.
          // Treat the same as if no inheritViewers were set for pending purposes.
          console.warn(`Page ${pageId} has no VIEW restriction — skipping viewer enumeration`);
        } else {
          if (!config.inheritEditors) {
            // Fetch editors to exclude them from viewer set
            let editorSet;
            try {
              editorSet = await getPagePermissionUsers(pageId, "EDIT");
            } catch (e) {
              console.error(`Failed to fetch editor set for exclusion on page ${pageId}:`, e);
              editorSet = new Set();
            }

            viewerSet.forEach(id => {
              if (!editorSet || !editorSet.has(id)) {
                authorizedUsers.add(id);
              }
            });
          } else {
            // inheritEditors is also enabled — all viewers (incl. editors) may sign
            viewerSet.forEach(id => authorizedUsers.add(id));
          }
        }
      } catch (e) {
        console.error(`Failed to fetch VIEW permissions for page ${pageId}:`, e);
      }
    }

    // 4. Page editors
    if (config.inheritEditors) {
      try {
        const editorSet = await getPagePermissionUsers(pageId, "EDIT");

        if (editorSet === null) {
          // Page EDIT is unrestricted — can't enumerate all editors
          console.warn(`Page ${pageId} has no EDIT restriction — skipping editor enumeration`);
        } else {
          editorSet.forEach(id => authorizedUsers.add(id));
        }
      } catch (e) {
        console.error(`Failed to fetch EDIT permissions for page ${pageId}:`, e);
      }
    }

    // Subtract already-signed users
    const signedSet = new Set(signedAccountIds);
    const pending = Array.from(authorizedUsers).filter(id => !signedSet.has(id));

    return successResponse({ pending, isPetitionMode: false });
  } catch (error) {
    console.error('Error calculating pending signers:', error);
    return errorResponse({ key: 'error.generic', params: { message: error.message } }, 500);
  }
}
