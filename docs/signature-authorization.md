## HTTP Status Codes

- All successful authorization checks (user is allowed to sign) must return HTTP status **200**.
- All authorization denials (user is not allowed to sign) must return HTTP status **403** (Forbidden), regardless of the denial reason.
- API or server errors (unexpected failures, e.g., network or internal errors) should return HTTP status **500** (Internal Server Error) with an appropriate error message.

# Signature Authorization Specification

## Overview
This document defines the authorization logic for determining whether a user can sign a document in the Digital Signature macro.

## Configuration Model

The macro configuration stores the following signer restrictions:

```javascript
{
  signers: Array<string>,          // Array of accountIds (specific named users)
  signerGroups: Array<string>,     // Array of Atlassian group IDs
  inheritViewers: boolean,         // Allow users with VIEW permission on the page
  inheritEditors: boolean,         // Allow users with EDIT permission on the page
  maxSignatures: number|undefined  // Maximum number of signatures allowed (undefined = unlimited)
}
```

## Authorization Check Algorithm

When a user attempts to sign, perform the following checks **in order**:

### 1. Check Maximum Signatures (if configured)
```javascript
if (config.maxSignatures !== undefined) {
  const currentCount = signatureEntity.signatures.length;
  if (currentCount >= config.maxSignatures) {
    return DENY; // Maximum signatures reached
  }
}
```

**Special cases:**
- `maxSignatures = undefined` → No limit (skip this check)
- `maxSignatures = 0` → Signing completely disabled (0 >= 0 = true, blocks all)
- `maxSignatures < 0` → Signing completely disabled (any negative blocks all)
- `maxSignatures > 0` → Hard limit on total number of signatures

### 2. Check for Petition Mode (No Restrictions)
```javascript
const hasNoRestrictions = 
  (config.signers === undefined || config.signers.length === 0) &&
  (config.signerGroups === undefined || config.signerGroups.length === 0) &&
  !config.inheritViewers &&
  !config.inheritEditors;

if (hasNoRestrictions) {
  return ALLOW; // Petition mode - any authenticated user can sign
}
```

### 3. Check Named Users
```javascript
if (config.signers && config.signers.includes(currentUserAccountId)) {
  return ALLOW; // User is explicitly listed as a required signer
}
```

### 4. Check Atlassian Groups
```javascript
if (config.signerGroups && config.signerGroups.length > 0) {
  const userGroups = await getUserGroups(currentUserAccountId);
  for (const groupId of config.signerGroups) {
    if (userGroups.includes(groupId)) {
      return ALLOW; // User is member of at least one configured group
    }
  }
}
```

### 5. Check Inherited Page Permissions
```javascript
if (config.inheritViewers) {
  const hasViewPermission = await checkPagePermission(pageId, currentUserAccountId, 'VIEW');
  if (hasViewPermission) {
    return ALLOW; // User has VIEW permission on the page
  }
}

if (config.inheritEditors) {
  const hasEditPermission = await checkPagePermission(pageId, currentUserAccountId, 'EDIT');
  if (hasEditPermission) {
    return ALLOW; // User has EDIT permission on the page
  }
}
```


### 6. Default Deny
```javascript
return DENY; // User does not meet any authorization criteria
```

## Denial Reasons and Error Handling

- All denials must return a custom message describing the specific reason for denial.
- The HTTP status code for all denials must always be **403** (Forbidden).
- Possible denial reasons include:
  - Maximum signatures reached
  - User has already signed
  - User is not a named signer
  - User is not a member of any allowed group
  - User lacks required page permissions (VIEW/EDIT)
  - API failure (group or permission check)
  - Malformed or missing configuration
  - User does not meet any authorization criteria

## Logging and Caching

- Log a warning if an invalid or deleted group ID is encountered, but continue checking other criteria.
- Log an error and reject the signature if the configuration is missing or malformed.
- Caching for group and permission checks should be **per request** only.

## Response Format

All authorization denials must return:

```javascript
{
  message: '<custom denial message in users locale / language>',
}
```

## Complete Authorization Function

```javascript
async function canUserSign(currentUserAccountId, pageId, config, signatureEntity) {
  // 1. Check maximum signatures limit
  if (config.maxSignatures !== undefined) {
    const currentCount = signatureEntity?.signatures?.length || 0;
    if (currentCount >= config.maxSignatures) {
      return {
        allowed: false,
        reason: 'Maximum signatures reached'
      };
    }
  }

  // 2. Check if user already signed
  const alreadySigned = signatureEntity?.signatures?.some(
    sig => sig.accountId === currentUserAccountId
  );
  if (alreadySigned) {
    return {
      allowed: false,
      reason: 'User has already signed'
    };
  }

  // 3. Check for petition mode (no restrictions)
  const hasNoRestrictions = 
    (!config.signers || config.signers.length === 0) &&
    (!config.signerGroups || config.signerGroups.length === 0) &&
    !config.inheritViewers &&
    !config.inheritEditors;

  if (hasNoRestrictions) {
    return {
      allowed: true,
      reason: 'Petition mode - no restrictions'
    };
  }

  // 4. Check named users
  if (config.signers?.includes(currentUserAccountId)) {
    return {
      allowed: true,
      reason: 'User is a named signer'
    };
  }

  // 5. Check group membership
  if (config.signerGroups?.length > 0) {
    const userGroups = await getUserGroups(currentUserAccountId);
    for (const groupId of config.signerGroups) {
      if (userGroups.includes(groupId)) {
        return {
          allowed: true,
          reason: `User is member of group ${groupId}`
        };
      }
    }
  }

  // 6. Check inherited permissions
  if (config.inheritViewers) {
    const hasViewPermission = await checkPagePermission(pageId, currentUserAccountId, 'VIEW');
    if (hasViewPermission) {
      return {
        allowed: true,
        reason: 'User has VIEW permission on page'
      };
    }
  }

  if (config.inheritEditors) {
    const hasEditPermission = await checkPagePermission(pageId, currentUserAccountId, 'EDIT');
    if (hasEditPermission) {
      return {
        allowed: true,
        reason: 'User has EDIT permission on page'
      };
    }
  }

  // 7. Default deny
  return {
    allowed: false,
    reason: 'User does not meet any authorization criteria'
  };
}
```

## Implementation Notes

### Group Resolution
- Use Confluence REST API: `/wiki/rest/api/user/memberof?accountId={accountId}`
- Returns array of group objects with `id` field
- Cache results to avoid repeated API calls

### Permission Checks
- Use Confluence REST API: `/wiki/rest/api/content/{pageId}/restriction/byOperation/{operation}`
- Operations: `read` (VIEW) and `update` (EDIT)
- Check if user's accountId appears in the restrictions list
- If no restrictions exist, check space-level permissions

### Performance Considerations
- Group membership and permissions are dynamic and must be checked at runtime
- Consider caching permission checks per request (not across requests)
- Batch API calls when possible
- Handle API failures with clear error messages without ever compromising securtity

## Error Handling

- **API failures**: Return appropriate error message, don't silently allow/deny
- **Invalid group IDs**: Log warning, continue checking other criteria
- **Missing permissions**: Handle as "permission denied" (fail closed)

# Important

Authorisaton must happen server side relying only on config that is retrieved from the trusted forge api on the server. Client must not be able to spoof config.
