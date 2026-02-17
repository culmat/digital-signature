// Digital Signature Authorization Logic
// Implements the authorization algorithm as specified in docs/signature-authorization.md
//
// This module exports a single async function: canUserSign(accountId, pageId, config, signatureEntity)
//
// - accountId: string (current user)
// - pageId: string (Confluence page)
// - config: object (macro config, see docs)
// - signatureEntity: object (current signature state)
//
// Returns: { allowed: boolean, reason: string }

import api, { route } from "@forge/api";

async function fetchConfluenceAPI(routePath, errorContext) {
  try {
    const res = await api.asUser().requestConfluence(routePath);
    if (!res.ok) {
      throw new Error(`${errorContext}: ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.error(`${errorContext} - API error`, e);
    throw new Error(errorContext);
  }
}

async function getUserGroups(accountId) {
  const data = await fetchConfluenceAPI(
    route`/wiki/rest/api/user/memberof?accountId=${accountId}`,
    "Failed to resolve user groups"
  );
  return (data || []).map(g => g.id);
}

async function checkPagePermission(pageId, accountId, operation) {
  const op = operation === "VIEW" ? "read" : "update";
  const data = await fetchConfluenceAPI(
    route`/wiki/rest/api/content/${pageId}/restriction/byOperation/${op}`,
    "Failed to check page permissions"
  );
  if (!data || !data.restrictions || !data.restrictions.user) return true;
  return data.restrictions.user.results.some(u => u.accountId === accountId);
}

// Main authorization function
export async function canUserSign(accountId, pageId, config, signatureEntity) {
  // 1. Check maximum signatures
  if (config.maxSignatures !== undefined) {
    const currentCount = signatureEntity?.signatures?.length || 0;
    if (currentCount >= config.maxSignatures) {
      return { allowed: false, reason: "error.max_signatures_reached" };
    }
  }

  // 2. Check if user already signed
  const alreadySigned = signatureEntity?.signatures?.some(sig => sig.accountId === accountId);
  if (alreadySigned) {
    return { allowed: false, reason: "error.already_signed" };
  }

  // 3. Petition mode (no restrictions)
  const hasNoRestrictions =
    (!config.signers || config.signers.length === 0) &&
    (!config.signerGroups || config.signerGroups.length === 0) &&
    !config.inheritViewers &&
    !config.inheritEditors;
  if (hasNoRestrictions) {
    return { allowed: true, reason: "Petition mode - no restrictions" };
  }

  // 4. Named users
  if (config.signers?.includes(accountId)) {
    return { allowed: true, reason: "User is a named signer" };
  }

  // 5. Group membership
  if (config.signerGroups?.length > 0) {
    let userGroups;
    try {
      userGroups = await getUserGroups(accountId);
    } catch {
      return { allowed: false, reason: "error.api_failure" };
    }
    for (const groupId of config.signerGroups) {
      if (userGroups.includes(groupId)) {
        return { allowed: true, reason: `User is member of group ${groupId}` };
      }
    }
  }

  // 6. Inherited permissions
  if (config.inheritViewers) {
    let hasView;
    try {
      hasView = await checkPagePermission(pageId, accountId, "VIEW");
    } catch {
      return { allowed: false, reason: "error.api_failure" };
    }
    if (hasView) {
      return { allowed: true, reason: "User has VIEW permission on page" };
    }
  }
  if (config.inheritEditors) {
    let hasEdit;
    try {
      hasEdit = await checkPagePermission(pageId, accountId, "EDIT");
    } catch {
      return { allowed: false, reason: "error.api_failure" };
    }
    if (hasEdit) {
      return { allowed: true, reason: "User has EDIT permission on page" };
    }
  }

  // 7. Default deny
  return { allowed: false, reason: "error.forbidden_criteria" };
}
