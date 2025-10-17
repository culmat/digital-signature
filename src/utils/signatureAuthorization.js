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

// Helper: Get user group IDs for a given accountId
async function getUserGroups(accountId) {
  try {
    const res = await api.asUser().requestConfluence(route`/wiki/rest/api/user/memberof?accountId=${accountId}`);
    if (!res.ok) throw new Error(`Failed to fetch user groups: ${res.status}`);
    const data = await res.json();
    return (data || []).map(g => g.id);
  } catch (e) {
    console.error("Group API error", e);
    throw new Error("Failed to resolve user groups");
  }
}

// Helper: Check if user has VIEW or EDIT permission on a page
async function checkPagePermission(pageId, accountId, operation) {
  try {
    const op = operation === "VIEW" ? "read" : "update";
    const res = await api.asUser().requestConfluence(route`/wiki/rest/api/content/${pageId}/restriction/byOperation/${op}`);
    if (!res.ok) throw new Error(`Failed to fetch page restrictions: ${res.status}`);
    const data = await res.json();
    // If no restrictions, fallback to true (open page)
    if (!data || !data.restrictions || !data.restrictions.user) return true;
    // Check if user is in the allowed list
    return data.restrictions.user.results.some(u => u.accountId === accountId);
  } catch (e) {
    console.error("Permission API error", e);
    throw new Error("Failed to check page permissions");
  }
}

// Main authorization function
export async function canUserSign(accountId, pageId, config, signatureEntity) {
  // 1. Check maximum signatures
  if (config.maxSignatures !== undefined) {
    const currentCount = signatureEntity?.signatures?.length || 0;
    if (currentCount >= config.maxSignatures) {
      return { allowed: false, reason: "Maximum signatures reached" };
    }
  }

  // 2. Check if user already signed
  const alreadySigned = signatureEntity?.signatures?.some(sig => sig.accountId === accountId);
  if (alreadySigned) {
    return { allowed: false, reason: "User has already signed" };
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
    } catch (e) {
      return { allowed: false, reason: "API failure (group check)" };
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
    } catch (e) {
      return { allowed: false, reason: "API failure (permission check)" };
    }
    if (hasView) {
      return { allowed: true, reason: "User has VIEW permission on page" };
    }
  }
  if (config.inheritEditors) {
    let hasEdit;
    try {
      hasEdit = await checkPagePermission(pageId, accountId, "EDIT");
    } catch (e) {
      return { allowed: false, reason: "API failure (permission check)" };
    }
    if (hasEdit) {
      return { allowed: true, reason: "User has EDIT permission on page" };
    }
  }

  // 7. Default deny
  return { allowed: false, reason: "User does not meet any authorization criteria" };
}
