import { putSignature, getSignature } from '../storage/signatureStore';
import { canUserSign } from '../utils/signatureAuthorization';
import { successResponse, errorResponse } from '../utils/responseHelper';
import { validateHashInput, validateRequiredFields } from './validation';

/**
 * Serializes a signature entity for transmission to frontend.
 * Converts Date objects to ISO strings.
 */
function serializeEntity(entity) {
  if (!entity) return null;
  return {
    ...entity,
    signatures: entity.signatures.map(sig => ({
      accountId: sig.accountId,
      signedAt: sig.signedAt instanceof Date ? sig.signedAt.toISOString() : sig.signedAt
    })),
    createdAt: entity.createdAt instanceof Date ? entity.createdAt.toISOString() : entity.createdAt,
    deletedAt: entity.deletedAt instanceof Date ? entity.deletedAt.toISOString() : entity.deletedAt,
    lastModified: entity.lastModified instanceof Date ? entity.lastModified.toISOString() : entity.lastModified
  };
}

export async function signResolver(req) {
  try {
    console.log('Forge context:', JSON.stringify(req.context, null, 2));
    
    const accountId = req.context.accountId;
    if (!accountId) {
      console.error('No accountId found in context');
      return errorResponse('User not authenticated', 403);
    }

    const { hash, pageId } = req.payload;

    const fieldsValidation = validateRequiredFields({ hash, pageId });
    if (fieldsValidation) {
      console.error('Missing required fields');
      return fieldsValidation;
    }

    const config = req.context.extension.config;

    const hashValidation = validateHashInput(hash);
    if (hashValidation) {
      console.error('Invalid hash:', hash);
      return hashValidation;
    }

    const signatureEntity = await getSignature(hash) || { signatures: [] };

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

    const signature = await putSignature(hash, pageId, accountId);

    return successResponse({
      signature: serializeEntity(signature),
      message: `Successfully signed. Total signatures: ${signature.signatures.length}`,
    });
  } catch (error) {
    console.error('Error in sign resolver:', error);
    return errorResponse(error.message || 'An unexpected error occurred', 500);
  }
}
