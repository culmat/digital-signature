import { getSignature } from '../storage/signatureStore';
import { successResponse, errorResponse } from '../utils/responseHelper';
import { validateHashInput } from './validation';

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
        signatures: [],
        message: 'No signatures found for this content',
      });
    }

    return successResponse({
      signatures: signature.signatures || [],
      message: `Found ${(signature.signatures || []).length} signatures`,
    });
  } catch (error) {
    console.error('Error in getSignatures resolver:', error);
    return errorResponse(error.message || 'An unexpected error occurred', 500);
  }
}
