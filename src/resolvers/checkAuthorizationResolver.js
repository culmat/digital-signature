import { canUserSign } from '../utils/signatureAuthorization';
import { successResponse, errorResponse } from '../utils/responseHelper';
import { validateHashInput, validateRequiredFields } from './validation';
import { getSignature } from '../storage/signatureStore';

export async function checkAuthorizationResolver(req) {
  try {
    const accountId = req.context.accountId;
    if (!accountId) {
      return successResponse({
        allowed: false,
        reason: 'User not authenticated',
      });
    }

    const { hash, pageId } = req.payload;

    const fieldsValidation = validateRequiredFields({ hash, pageId });
    if (fieldsValidation) {
      return fieldsValidation;
    }

    const hashValidation = validateHashInput(hash);
    if (hashValidation) {
      return hashValidation;
    }

    const config = req.context.extension.config;
    console.log('[checkAuthorization] accountId:', accountId);
    console.log('[checkAuthorization] pageId:', pageId);
    console.log('[checkAuthorization] config:', JSON.stringify(config, null, 2));
    
    const signatureEntity = await getSignature(hash) || { signatures: [] };
    const authResult = await canUserSign(accountId, pageId, config, signatureEntity);

    console.log('[checkAuthorization] authResult:', authResult);
    
    return successResponse({
      allowed: authResult.allowed,
      reason: authResult.reason,
    });
  } catch (error) {
    console.error('Error in checkAuthorization resolver:', error);
    return errorResponse(error.message || 'An unexpected error occurred', 500);
  }
}
