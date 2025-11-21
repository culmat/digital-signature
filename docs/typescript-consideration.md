# TypeScript Migration - Consideration & Recommendation

**Date:** November 2025  
**Status:** Not Recommended for Production  
**Codebase Size:** ~1,500 LOC

---

## Current Forge Support

TypeScript is available in Forge via **Early Access Program (EAP)**:
- Requires `bundler: typescript` in manifest.yml
- EAP status = experimental, unsupported, subject to change
- Not recommended for production environments
- Requires app registration for EAP access
- Bundles all dependencies (larger package size, potential deployment failures)

---

## Migration Impact Assessment

### Effort Required
- **20-30 hours** full migration
- 1,503 lines of JavaScript/JSX to convert
- Type definitions needed for: SignatureEntity, AuthResult, Config, ADF nodes, Forge APIs
- Frontend JSX → TSX conversion
- All resolver request/response types

### High-Impact Files
- `src/frontend/index.jsx` (411 lines) - Complex state, effects, JSX
- `src/frontend/config.jsx` (194 lines) - Form validation
- `src/frontend/utils/adfValidator.js` (206 lines) - ADF types
- `src/utils/signatureAuthorization.js` (119 lines) - Authorization logic

---

## Recommendation: **Wait**

### Why NOT Now

1. **EAP Risk:** Experimental feature in production app = stability risk
2. **Low ROI:** Codebase already well-structured after recent refactoring:
   - Modular architecture (small, focused files)
   - ESLint configured with strict rules
   - Clean naming conventions
   - No complexity issues
3. **Bundle Size Risk:** TypeScript bundler includes all dependencies (no tree-shaking)
4. **Effort vs. Benefit:** 20-30 hours for marginal improvement

### When TO Migrate

✅ When TypeScript bundler becomes stable (exits EAP)  
✅ When team scales to multiple developers  
✅ When codebase grows significantly (>5,000 LOC)  
✅ When comprehensive test suite exists to validate migration

---

## Alternative: JSDoc Type Checking (Recommended)

Get 80% of TypeScript benefits with zero migration effort:

```javascript
/**
 * @typedef {Object} SignatureEntity
 * @property {string} hash
 * @property {Array<{accountId: string, signedAt: number}>} signatures
 */

/**
 * @param {string} hash
 * @param {string} pageId
 * @param {string} accountId
 * @returns {Promise<SignatureEntity>}
 */
export async function putSignature(hash, pageId, accountId) {
  // VS Code provides full autocomplete and type checking
}
```

**Benefits:**
- Type checking in VS Code (same developer experience)
- No build changes
- Works with current Forge setup
- Easy migration path to TypeScript later
- Zero risk

---

## Conclusion

TypeScript migration is **premature** for this codebase. The code quality gains from recent refactoring provide most benefits that TypeScript would offer. Consider JSDoc type annotations as a pragmatic middle ground until TypeScript support matures in Forge.
