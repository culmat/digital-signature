import { isValidHash } from '../utils/hash';
import { validationError } from '../utils/responseHelper';

export function validateHashInput(hash) {
  if (!hash) {
    return validationError('error.missing_hash');
  }
  if (!isValidHash(hash)) {
    return validationError('error.invalid_hash');
  }
  return null;
}

export function validateRequiredFields(fields) {
  const missing = [];
  for (const [name, value] of Object.entries(fields)) {
    if (!value) missing.push(name);
  }
  if (missing.length > 0) {
    // Return key and metadata for frontend translation
    return errorResponse({
      key: 'error.missing_fields',
      params: { fields: missing.join(', ') }
    }, 400);
  }
  return null;
}
