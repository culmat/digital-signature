import { getSignature } from '../storage/signatureStore';
import { successResponse, errorResponse } from '../utils/responseHelper';
import { validateHashInput } from './validation';

/**
 * Serializes signature data for transmission to frontend.
 * Converts Date objects to ISO strings.
 */
function serializeSignatures(signatures) {
  if (!signatures) return [];
  return signatures.map(sig => ({
    accountId: sig.accountId,
    signedAt: sig.signedAt instanceof Date ? sig.signedAt.toISOString() : sig.signedAt
  }));
}

export async function getSignaturesResolver(req) {
  try {
    const { hash } = req.payload;

    const hashValidation = validateHashInput(hash);
    if (hashValidation) {
      console.error('Invalid hash in getSignatures:', hash);
      return hashValidation;
    }

    const signature = await getSignature(hash);

    if (!signature) {
      return successResponse({
        signature: null,
      });
    }

    return successResponse({
      signature: {
        ...signature,
        signatures: serializeSignatures(signature.signatures || []),
        createdAt: signature.createdAt instanceof Date ? signature.createdAt.toISOString() : signature.createdAt,
        deletedAt: signature.deletedAt instanceof Date ? signature.deletedAt.toISOString() : signature.deletedAt,
        lastModified: signature.lastModified instanceof Date ? signature.lastModified.toISOString() : signature.lastModified
      },
      hash,
    });
  } catch (error) {
    console.error('Error in getSignatures resolver:', error);
    return errorResponse({
      key: 'error.generic',
      params: { message: error.message }
    }, 500);
  }
}
