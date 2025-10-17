import Resolver from '@forge/resolver';
import { putSignature, getSignature } from '../storage/signatureStore';
import { canUserSign } from '../utils/signatureAuthorization';
import { isValidHash } from '../utils/hash';

const resolver = new Resolver();

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
      return {
        success: false,
        status: 403,
        message: 'User not authenticated',
      };
    }


    // Extract payload (no config from client)
    const { hash, pageId } = req.payload;
    const missingFields = [];
    if (!hash) missingFields.push('hash');
    if (!pageId) missingFields.push('pageId');
    if (missingFields.length > 0) {
      console.error('Missing required fields:', missingFields);
      return {
        success: false,
        status: 403,
        message: `Missing required field(s): ${missingFields.join(', ')}`,
      };
    }

    const config = req.context.extension.config;
    

    // Validate hash format
    if (!isValidHash(hash)) {
      console.error('Invalid hash format:', hash);
      return {
        success: false,
        status: 403,
        message: 'Invalid hash format: must be 64-character hexadecimal string',
      };
    }

    // Retrieve current signature entity (if any)
    const signatureEntity = await getSignature(hash) || { signatures: [] };

    // Authorization check
    let authResult;
    try {
      authResult = await canUserSign(accountId, pageId, config, signatureEntity);
    } catch (e) {
      console.error('Authorization error:', e);
      return {
        success: false,
        status: 500,
        message: 'Authorization check failed: ' + (e.message || e.toString()),
      };
    }

    if (!authResult.allowed) {
      // Denied: always 403
      return {
        success: false,
        status: 403,
        message: authResult.reason || 'Not authorized to sign',
      };
    }

    // Store signature
    const signature = await putSignature(hash, pageId, accountId);
    return {
      success: true,
      signature,
      message: `Successfully signed. Total signatures: ${signature.signatures.length}`,
    };
  } catch (error) {
    console.error('Error in sign resolver:', error);
    return {
      success: false,
      status: 500,
      message: error.message || 'An unexpected error occurred',
    };
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

    if (!hash) {
      return {
        success: false,
        error: 'Missing required field: hash is required'
      };
    }

    // Validate hash format
    if (!isValidHash(hash)) {
      return {
        success: false,
        error: 'Invalid hash format: must be 64-character hexadecimal string'
      };
    }

    console.log(`Get signatures request: hash=${hash}`);

    // Retrieve signature
    const signature = await getSignature(hash);

    if (!signature) {
      console.log('No signatures found for this content');
      return {
        success: true,
        signature: null,
        hash,
        message: 'No signatures found for this content'
      };
    }

    console.log(`Found ${signature.signatures.length} signature(s)`);

    return {
      success: true,
      signature,
      hash
    };

  } catch (error) {
    console.error('Error in getSignatures resolver:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
    };
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
      return {
        success: false,
        error: 'User not authenticated',
      };
    }

    // Extract payload
    const { hash, pageId } = req.payload;
    if (!hash || !pageId) {
      return {
        success: false,
        error: 'Missing required fields: hash and pageId are required',
      };
    }

    // Validate hash format
    if (!isValidHash(hash)) {
      return {
        success: false,
        error: 'Invalid hash format: must be 64-character hexadecimal string',
      };
    }

    const config = req.context.extension.config;

    // Retrieve current signature entity (if any)
    const signatureEntity = await getSignature(hash) || { signatures: [] };

    // Authorization check
    const authResult = await canUserSign(accountId, pageId, config, signatureEntity);

    return {
      success: true,
      allowed: authResult.allowed,
      reason: authResult.reason,
    };

  } catch (error) {
    console.error('Error in checkAuthorization resolver:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred',
    };
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
