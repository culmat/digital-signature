import Resolver from '@forge/resolver';
import { putSignature, getSignature } from '../storage/signatureStore';
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
    // Extract user's account ID from Forge context
    // The context.accountId is automatically provided by Forge for authenticated users
    const accountId = req.context.accountId;

    if (!accountId) {
      console.error('No accountId found in context');
      return {
        success: false,
        error: 'User not authenticated'
      };
    }

    // Extract payload
    const { hash, pageId } = req.payload;

    // Validate required fields
    if (!hash || !pageId) {
      console.error('Missing required fields:', { hash, pageId });
      return {
        success: false,
        error: 'Missing required fields: hash and pageId are required'
      };
    }

    // Validate hash format
    if (!isValidHash(hash)) {
      console.error('Invalid hash format:', hash);
      return {
        success: false,
        error: 'Invalid hash format: must be 64-character hexadecimal string'
      };
    }

    console.log(`Sign request: user=${accountId}, page=${pageId}, hash=${hash}`);

    // Store signature
    const signature = await putSignature(hash, pageId, accountId);

    console.log(`Signature stored successfully. Total signatures: ${signature.signatures.length}`);

    return {
      success: true,
      signature,
      message: `Successfully signed. Total signatures: ${signature.signatures.length}`
    };

  } catch (error) {
    console.error('Error in sign resolver:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred'
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
