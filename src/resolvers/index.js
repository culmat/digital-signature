import Resolver from '@forge/resolver';
import { putSignature, getSignature } from '../storage/signatureStore';
import { canUserSign } from '../utils/signatureAuthorization';
import { isValidHash } from '../utils/hash';
import { validationError, successResponse, errorResponse } from '../utils/responseHelper';

const resolver = new Resolver();

/**
 * Validates hash input format.
 *
 * @param {string} hash - The hash to validate
 * @returns {object|null} - Returns validation error response if invalid, null if valid
 */
function validateHashInput(hash) {
  if (!hash) {
    return validationError('Missing required field: hash');
  }
  if (!isValidHash(hash)) {
    return validationError(
      'Invalid hash format: must be 64-character hexadecimal string'
    );
  }
  return null;
}

/**
 * Validates that required fields are present.
 *
 * @param {object} fields - Object with field names as keys and values to check
 * @returns {object|null} - Returns validation error response if any fields are missing, null if all present
 */
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

/**
 * Sign endpoint - Called when user clicks the sign button in the macro.
 * 
 * This resolver:
 * 1. Extracts the current user's accountId from the Forge context
 * 2. Receives pre-computed hash from client
 * 3. Stores the signature using putSignature()
 * 
 * Expected payload:
 * {
 *   hash: string (SHA-256 hex, 64 chars),
 *   pageId: string
 * }
 * 
 * Returns:
 * {
 *   success: boolean,
 *   signature?: SignatureEntity,
 *   message?: string,
 *   error?: string
 * }
 */
resolver.define('sign', async (req) => {
  try {
  // Log the full Forge context for debugging
  console.log('Forge context:', JSON.stringify(req.context, null, 2));
  // Extract user's account ID from Forge context
  const accountId = req.context.accountId;
    if (!accountId) {
      console.error('No accountId found in context');
      return errorResponse('User not authenticated', 403);
    }


    // Extract payload (no config from client)
    const { hash, pageId } = req.payload;

    const fieldsValidation = validateRequiredFields({ hash, pageId });
    if (fieldsValidation) {
      console.error('Missing required fields');
      return fieldsValidation;
    }

    const config = req.context.extension.config;

    // Validate hash format
    const hashValidation = validateHashInput(hash);
    if (hashValidation) {
      console.error('Invalid hash:', hash);
      return hashValidation;
    }

    // Retrieve current signature entity (if any)
    const signatureEntity = await getSignature(hash) || { signatures: [] };

    // Authorization check
    let authResult;
    try {
      authResult = await canUserSign(accountId, pageId, config, signatureEntity);
    } catch (e) {
      console.error('Authorization error:', e);
      return errorResponse('Authorization check failed: ' + (e.message || e.toString()), 500);
    }

    if (!authResult.allowed) {
      return errorResponse(authResult.reason || 'Not authorized to sign', 403);
    }

    // Store signature
    const signature = await putSignature(hash, pageId, accountId);
    return successResponse({
      signature,
      message: `Successfully signed. Total signatures: ${signature.signatures.length}`,
    });
  } catch (error) {
    console.error('Error in sign resolver:', error);
    return errorResponse(error.message || 'An unexpected error occurred', 500);
  }
});

/**
 * Get signatures endpoint - Retrieves existing signatures for display.
 * 
 * Expected payload:
 * {
 *   hash: string (SHA-256 hex, 64 chars)
 * }
 * 
 * Returns:
 * {
 *   success: boolean,
 *   signature?: SignatureEntity,
 *   hash?: string,
 *   error?: string
 * }
 */
resolver.define('getSignatures', async (req) => {
  try {
    const { hash } = req.payload;

    // Validate hash format
    const hashValidation = validateHashInput(hash);
    if (hashValidation) {
      return hashValidation;
    }

    console.log(`Get signatures request: hash=${hash}`);

    // Retrieve signature
    const signature = await getSignature(hash);

    if (!signature) {
      console.log('No signatures found for this content');
      return successResponse({
        signature: null,
        hash,
        message: 'No signatures found for this content'
      });
    }

    console.log(`Found ${signature.signatures.length} signature(s)`);

    return successResponse({
      signature,
      hash
    });

  } catch (error) {
    console.error('Error in getSignatures resolver:', error);
    return errorResponse(error.message || 'An unexpected error occurred');
  }
});

/**
 * Check authorization endpoint - Checks if the current user can sign.
 *
 * Expected payload:
 * {
 *   hash: string (SHA-256 hex, 64 chars),
 *   pageId: string
 * }
 *
 * Returns:
 * {
 *   success: boolean,
 *   allowed: boolean,
 *   reason: string,
 *   error?: string
 * }
 */
resolver.define('checkAuthorization', async (req) => {
  try {
    // Extract user's account ID from Forge context
    const accountId = req.context.accountId;
    if (!accountId) {
      return errorResponse('User not authenticated', 403);
    }

    // Extract payload
    const { hash, pageId } = req.payload;

    const fieldsValidation = validateRequiredFields({ hash, pageId });
    if (fieldsValidation) {
      return fieldsValidation;
    }

    // Validate hash format (already checked in validateRequiredFields, but validates format)
    const hashValidation = validateHashInput(hash);
    if (hashValidation) {
      return hashValidation;
    }

    const config = req.context.extension.config;

    // Retrieve current signature entity (if any)
    const signatureEntity = await getSignature(hash) || { signatures: [] };

    // Authorization check
    const authResult = await canUserSign(accountId, pageId, config, signatureEntity);

    return successResponse({
      allowed: authResult.allowed,
      reason: authResult.reason,
    });

  } catch (error) {
    console.error('Error in checkAuthorization resolver:', error);
    return errorResponse(error.message || 'An unexpected error occurred');
  }
});

// Legacy getText for backwards compatibility
resolver.define('getText', (req) => {
  const seen = new WeakSet();
  console.log(JSON.stringify(req, function (key, value) {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  }, 2));

  return 'Hello, world from resolver!';
});

export const handler = resolver.getDefinitions();
