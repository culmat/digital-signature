# Pending Signatures Calculation Specification

## Overview
This document defines how to calculate the list of pending signatures (users who haven't signed yet but are authorized to sign).

## Key Principle

**Pending signatures CANNOT be pre-calculated or stored statically** because:
- Group memberships can change at any time
- Page permissions can change at any time
- Users can be added/removed from groups
- Page access can be granted/revoked

Therefore, pending signatures must be **calculated dynamically** every time the macro is loaded.

## Calculation Algorithm

The pending list is calculated as follows:

```
Pending = (All Authorized Users) - (Already Signed Users)
```

### Step 1: Collect All Authorized Users

Build a set of accountIds who are authorized to sign based on configuration:

```javascript
async function getAllAuthorizedUsers(pageId, config) {
  const authorizedUsers = new Set();

  // 1. Add named signers
  if (config.signers) {
    config.signers.forEach(accountId => authorizedUsers.add(accountId));
  }

  // 2. Add group members
  if (config.signerGroups && config.signerGroups.length > 0) {
    for (const groupId of config.signerGroups) {
      const members = await getGroupMembers(groupId);
      members.forEach(accountId => authorizedUsers.add(accountId));
    }
  }

  // 3. Add page viewers (if inheritViewers enabled)
  if (config.inheritViewers) {
    const viewers = await getPageViewers(pageId);
    viewers.forEach(accountId => authorizedUsers.add(accountId));
  }

  // 4. Add page editors (if inheritEditors enabled)
  if (config.inheritEditors) {
    const editors = await getPageEditors(pageId);
    editors.forEach(accountId => authorizedUsers.add(accountId));
  }

  return Array.from(authorizedUsers);
}
```

### Step 2: Remove Already Signed Users

```javascript
function calculatePending(authorizedUsers, signatureEntity) {
  const signedAccountIds = new Set(
    (signatureEntity?.signatures || []).map(sig => sig.accountId)
  );

  return authorizedUsers.filter(accountId => !signedAccountIds.has(accountId));
}
```

### Complete Calculation Function

```javascript
async function calculatePendingSignatures(pageId, config, signatureEntity) {
  // Special case: Petition mode (no restrictions)
  const hasNoRestrictions = 
    (!config.signers || config.signers.length === 0) &&
    (!config.signerGroups || config.signerGroups.length === 0) &&
    !config.inheritViewers &&
    !config.inheritEditors;

  if (hasNoRestrictions) {
    // In petition mode, there's no definable "pending" list
    // Anyone can sign, so we return null or a special indicator
    return {
      isPetitionMode: true,
      pending: null,
      message: 'Any authenticated user can sign'
    };
  }

  // Special case: Max signatures reached
  if (config.maxSignatures !== undefined) {
    const currentCount = signatureEntity?.signatures?.length || 0;
    if (currentCount >= config.maxSignatures) {
      return {
        isPetitionMode: false,
        pending: [],
        message: 'Maximum signatures reached'
      };
    }
  }

  // Get all authorized users
  const authorizedUsers = await getAllAuthorizedUsers(pageId, config);

  // Remove already signed users
  const pending = calculatePending(authorizedUsers, signatureEntity);

  return {
    isPetitionMode: false,
    pending,
    message: null
  };
}
```

## API Calls Required

### 1. Get Group Members
```
GET /wiki/rest/api/group/{groupId}/membersByGroupId
```
Returns array of user objects with `accountId` field.

### 2. Get Page Viewers
```
GET /wiki/rest/api/content/{pageId}/restriction/byOperation/read
```
Parse restrictions to get list of users/groups with VIEW permission.
Resolve groups to individual users.

### 3. Get Page Editors
```
GET /wiki/rest/api/content/{pageId}/restriction/byOperation/update
```
Parse restrictions to get list of users/groups with EDIT permission.
Resolve groups to individual users.

## Performance Considerations

### Caching Strategy
- Cache group memberships for duration of single request only
- Cache page permissions for duration of single request only
- Do NOT cache across requests (data becomes stale)

### Large Groups
When a group has many members (e.g., > 1000 users):

1. **Option A: Limit Resolution**
   - Only resolve first N users (e.g., 100)
   - Show "Group XYZ (100+ members)" instead of individual names
   - Display full list on user request

2. **Option B: Lazy Loading**
   - Calculate pending count but don't load all names
   - Load names only when user expands the pending section
   - Paginate large lists

3. **Option C: Group Display**
   - Don't resolve groups to individual users for display
   - Show groups as units: "Pending Groups: confluence-users (500 members)"
   - Only resolve for authorization checks

### Recommended Approach
- For named signers: Always show individual users
- For groups with < 50 members: Resolve and show individual users
- For groups with >= 50 members: Show group name with member count
- For page permissions: Show as "Page Viewers" / "Page Editors" with count

## Display Format

```javascript
{
  pending: {
    namedUsers: [
      { accountId: "...", name: "...", avatarUrl: "..." }
    ],
    groups: [
      { groupId: "...", name: "confluence-users", memberCount: 500, resolved: false },
      { groupId: "...", name: "developers", memberCount: 12, resolved: true, members: [...] }
    ],
    pageViewers: {
      count: 25,
      resolved: false
    },
    pageEditors: {
      count: 5,
      resolved: true,
      members: [...]
    }
  }
}
```

## UI Display Examples

### Compact View (Default)
```
Pending (37)
- John Doe
- Jane Smith
- confluence-users (500 members) [Show all]
- Page Viewers (25 users) [Show all]
```

### Expanded View
```
Pending (37)

Named Signers (2):
- John Doe
- Jane Smith

Group Members (500):
- Alice Anderson
- Bob Brown
... (498 more) [Load more]

Page Viewers (25):
- Charlie Chen
- Diana Davis
... (23 more) [Load more]
```

## Error Handling

### API Failures
If group/permission API calls fail:
- Log error details
- Show placeholder: "Group XYZ (Unable to load members)"
- Don't block signature collection from working users
- Retry on next page load

### Invalid Group IDs
- Log warning
- Skip invalid groups
- Continue with remaining groups
- Show warning in config UI if possible

### Performance Timeouts
If calculation takes too long:
- Set timeout (e.g., 5 seconds)
- Return partial results
- Show "Calculating..." state in UI
- Allow signing to proceed (fail open)

## Implementation Phases

### Phase 1: Named Signers Only
- Only calculate pending from `config.signers`
- No group resolution needed
- Simple, fast, reliable

### Phase 2: Add Group Support
- Resolve Atlassian groups
- Handle large groups with display limits
- Add caching within request

### Phase 3: Add Page Permissions
- Resolve page viewers/editors
- Handle space-level permissions
- Optimize API calls

### Phase 4: Optimization
- Implement lazy loading
- Add pagination
- Optimize for large groups
- Add user-triggered refresh
