# Refactoring TODO

This document outlines the refactoring tasks for the digital-signature codebase, ordered by implementation dependency and impact.

## Overview

- **Total Refactoring Tasks**: 8
- **Estimated Total LOC Impact**: ~300 lines
- **Priority Distribution**: 3 HIGH, 3 MEDIUM, 2 LOW

---

## Implementation Order

### Phase 1: Foundation - Utilities & Shared Functions
These refactorings establish shared utilities that other refactorings depend on.

#### ✅ Task 1: Consolidate Hash Utilities (MEDIUM)
**Priority**: Must do first - other components depend on this
**Estimated Effort**: 30 minutes
**Files affected**:
- [src/utils/hash.js](src/utils/hash.js)
- [src/frontend/utils/signatureClient.js](src/frontend/utils/signatureClient.js)
- [src/resolvers/index.js](src/resolvers/index.js)

**Actions**: ✅ COMPLETED
1. ✅ Keep `isValidHash()` only in `src/utils/hash.js:52-54`
2. ✅ Consolidate `computeHash()` and `computeHashClient()` - kept only `computeHash()` in `src/utils/hash.js:19-26`
3. ✅ Remove duplicate `isValidHash()` from `src/frontend/utils/signatureClient.js:162-164`
4. ✅ Update imports in `src/resolvers/index.js` to use `src/utils/hash.js` (already correct)
5. ✅ Remove unused `computeHashServer()` from `src/utils/hash.js`
6. ✅ Update `src/frontend/utils/signatureClient.js` to import and use `computeClient()` from hash.js

**Benefits**:
- Single source of truth for hash validation
- Easier to update validation logic
- Reduces bundle size

---

#### ✅ Task 2: Create Response Helper Utilities (HIGH)
**Priority**: Must do before resolver refactoring
**Estimated Effort**: 20 minutes
**Files affected**:
- Create new file: `src/utils/responseHelper.js`
- [src/resolvers/index.js](src/resolvers/index.js)

**Actions**: ✅ COMPLETED
1. ✅ Create `src/utils/responseHelper.js` with standardized response functions:
   ```javascript
   export const successResponse = (data = {}) => ({
     success: true,
     ...data
   });

   export const errorResponse = (error, status = 400) => ({
     success: false,
     error,
     status
   });

   export const validationError = (message) =>
     errorResponse(message, 400);
   ```

2. ✅ Document the standard response contract

**Benefits**:
- Consistent API responses across all resolvers
- Easier client-side error handling
- Type-safe responses (future TypeScript migration)

---

### Phase 2: Backend - Resolver Refactoring
With utilities in place, refactor the backend resolvers.

#### ✅ Task 3: Extract Hash Validation Helper (HIGH)
**Priority**: Do after Task 1 & 2
**Estimated Effort**: 15 minutes
**Files affected**:
- [src/resolvers/index.js:64-71](src/resolvers/index.js#L64-L71)
- [src/resolvers/index.js:143-148](src/resolvers/index.js#L143-L148)
- [src/resolvers/index.js:220-225](src/resolvers/index.js#L220-L225)

**Actions**: ✅ COMPLETED
1. ✅ Create shared validation function in `src/resolvers/index.js`:
   ```javascript
   function validateHashInput(hash) {
     if (!hash) {
       return validationError('Missing required field: hash');
     }
     if (!isValidHash(hash)) {
       return validationError(
         'Invalid hash format: must be 64-character hexadecimal string'
       );
     }
     return null; // no error
   }
   ```

2. ✅ Replace all 3 validation blocks with calls to `validateHashInput()`
3. ✅ Update error handling to use consistent response format

**Benefits**:
- Eliminates 3 instances of duplicate validation logic
- Consistent error messages
- Single place to update validation rules

---

#### ✅ Task 4: Standardize Resolver Response Structures (HIGH)
**Priority**: Do after Task 2 & 3
**Estimated Effort**: 45 minutes
**Files affected**:
- [src/resolvers/index.js](src/resolvers/index.js) (all 3 resolvers)
- [src/frontend/utils/signatureClient.js](src/frontend/utils/signatureClient.js) (client code)

**Actions**: ✅ COMPLETED
1. ✅ Update all resolver functions to use `successResponse()` and `errorResponse()`
2. ✅ Standardize field naming:
   - Use `error` (not `message`) for error descriptions
   - Use `status` for HTTP status codes
   - Use consistent data field names
3. ⚠️ Update client code to handle new response structure (may need frontend changes)
4. ✅ Ensure error paths return consistent shapes

**Before/After Example**:
```javascript
// Before (inconsistent)
return { success: false, status: 403, message: 'Error' };
return { success: false, error: 'Error' };

// After (consistent)
return errorResponse('Error', 403);
```

**Benefits**:
- API consistency makes client code simpler
- Easier to add middleware for logging/monitoring
- Clearer contract for future API consumers

---

#### ⬜ Task 5: Standardize Field Validation Patterns (MEDIUM)
**Priority**: Do after Task 3
**Estimated Effort**: 30 minutes
**Files affected**:
- [src/resolvers/index.js:47-58](src/resolvers/index.js#L47-L58)
- [src/resolvers/index.js:135-140](src/resolvers/index.js#L135-L140)
- [src/resolvers/index.js:212-217](src/resolvers/index.js#L212-L217)

**Actions**:
1. Create a `validateRequiredFields()` helper:
   ```javascript
   function validateRequiredFields(fields) {
     const missing = [];
     for (const [name, value] of Object.entries(fields)) {
       if (!value) missing.push(name);
     }
     if (missing.length > 0) {
       return validationError(
         `Missing required field(s): ${missing.join(', ')}`
       );
     }
     return null;
   }
   ```

2. Replace all 3 different validation patterns with this helper
3. Use consistent call pattern: `validateRequiredFields({ hash, pageId })`

**Benefits**:
- Single validation approach across codebase
- Easier to extend with additional validation rules
- Better error messages for debugging

---

### Phase 3: Backend - Authorization Helpers (Optional)

#### ⬜ Task 6: Create API Error Wrapper (LOW)
**Priority**: Nice to have - do after resolver refactoring
**Estimated Effort**: 25 minutes
**Files affected**:
- [src/utils/signatureAuthorization.js:16-26](src/utils/signatureAuthorization.js#L16-L26)
- [src/utils/signatureAuthorization.js:29-43](src/utils/signatureAuthorization.js#L29-L43)

**Actions**:
1. Create API request wrapper in `src/utils/signatureAuthorization.js`:
   ```javascript
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
   ```

2. Refactor `getUserGroups()` and `checkPagePermission()` to use wrapper
3. Reduce duplicate try-catch blocks

**Benefits**:
- Centralized API error handling
- Consistent error logging format
- Easier to add retry logic or monitoring

---

### Phase 4: Frontend - Component Refactoring

#### ⬜ Task 7: Extract Context Access Hook (MEDIUM)
**Priority**: Do before state refactoring
**Estimated Effort**: 20 minutes
**Files affected**:
- [src/frontend/index.jsx](src/frontend/index.jsx)

**Actions**:
1. Create custom hook in `src/frontend/index.jsx`:
   ```javascript
   function useContentContext(context) {
     return useMemo(() => ({
       pageId: context?.extension?.content?.id,
       pageTitle: context?.extension?.content?.title || '',
       macroBody: context?.extension?.macro?.body,
       spaceKey: context?.extension?.space?.key,
     }), [context]);
   }
   ```

2. Replace repeated context access patterns throughout component
3. Use destructuring: `const { pageId, pageTitle, macroBody } = useContentContext(context);`

**Benefits**:
- Reduces repetitive null-checking code
- Single source of truth for context extraction
- Memoized for performance
- Easier to mock in tests

---

#### ⬜ Task 8: Refactor React State Management (MEDIUM)
**Priority**: Do after Task 7
**Estimated Effort**: 60 minutes
**Files affected**:
- [src/frontend/index.jsx](src/frontend/index.jsx) (lines with 9 useState calls)

**Actions**:
1. Group related state into logical domains:
   ```javascript
   // Signature domain
   const [signatureState, dispatchSignature] = useReducer(signatureReducer, {
     entity: null,
     isLoading: true,
     contentHash: null,
   });

   // Authorization domain
   const [authState, dispatchAuth] = useReducer(authReducer, {
     status: null,
     isChecking: false,
   });

   // User domain
   const [userState, setUserState] = useState({
     accountId: null,
     locale: DEFAULT_LOCALE,
   });

   // UI domain
   const [uiState, setUIState] = useState({
     isSigning: false,
     actionError: null,
   });
   ```

2. Create reducer functions for signature and auth domains
3. Update all state access to use new structure
4. Consolidate related state updates into single dispatches

**Benefits**:
- Better state cohesion and organization
- Easier to debug state changes
- Reduces re-render complexity
- Clearer separation of concerns
- Easier to extract into custom hooks later

---

### Phase 5: Frontend - Tree Traversal (Optional)

#### ⬜ Task 9: Abstract ADF Tree Traversal (LOW)
**Priority**: Nice to have - independent task
**Estimated Effort**: 40 minutes
**Files affected**:
- [src/frontend/utils/adfValidator.js:12-32](src/frontend/utils/adfValidator.js#L12-L32)
- [src/frontend/utils/adfValidator.js:126-223](src/frontend/utils/adfValidator.js#L126-L223)

**Actions**:
1. Create generic tree traversal utility:
   ```javascript
   function traverseADF(node, visitor, options = {}) {
     const {
       visitMarks = false,
       earlyReturn = false // stop on first truthy result
     } = options;

     const result = visitor(node);
     if (earlyReturn && result) return result;

     if (Array.isArray(node.content)) {
       for (const child of node.content) {
         const childResult = traverseADF(child, visitor, options);
         if (earlyReturn && childResult) return childResult;
       }
     }

     if (visitMarks && Array.isArray(node.marks)) {
       for (const mark of node.marks) {
         const markResult = traverseADF(mark, visitor, options);
         if (earlyReturn && markResult) return markResult;
       }
     }

     return result;
   }
   ```

2. Refactor `extractTextContent()` to use traversal utility
3. Refactor `checkForDynamicContent()` to use traversal utility with `earlyReturn: true`

**Benefits**:
- Reusable for future ADF processing needs
- Easier to test tree operations in isolation
- Reduces duplicate recursive logic
- More declarative code style

---

## Summary Statistics

| Phase | Tasks | Estimated Time | Priority |
|-------|-------|----------------|----------|
| Phase 1: Foundation | 2 | 50 min | HIGH/MEDIUM |
| Phase 2: Backend Resolvers | 3 | 90 min | HIGH/MEDIUM |
| Phase 3: Auth Helpers | 1 | 25 min | LOW |
| Phase 4: Frontend Components | 2 | 80 min | MEDIUM |
| Phase 5: Tree Traversal | 1 | 40 min | LOW |
| **Total** | **9** | **~285 min (~4.75 hours)** | |

---

## Testing Requirements

After each phase:
- [ ] Run existing tests to ensure no regressions
- [ ] Manually test affected functionality in Confluence
- [ ] Verify error handling works as expected
- [ ] Check console for any new warnings or errors

---

## Rollback Plan

Each task should be committed separately with clear commit messages:
- `refactor: consolidate hash utilities`
- `refactor: create response helper utilities`
- `refactor: extract hash validation helper`
- etc.

This allows easy rollback if issues are discovered.

---

## Future Improvements (Beyond This Document)

- Consider TypeScript migration for better type safety
- Add unit tests for utility functions
- Consider splitting large resolver file into separate modules
- Add JSDoc documentation for all public APIs
- Consider adding ESLint rules to prevent duplicate code patterns

---

## Notes

- **Phase 1-2 are critical** for code quality and maintainability
- **Phase 3-5 are optional** but provide incremental improvements
- Tasks are designed to be independent where possible
- Each task includes clear before/after examples
- Estimated times assume familiarity with the codebase

---

**Last Updated**: 2025-10-17
**Status**: Ready for implementation
