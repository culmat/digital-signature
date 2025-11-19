import { isValidHash } from '../utils/hash';
import { validationError } from '../utils/responseHelper';

export function validateHashInput(hash) {
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

export function validateRequiredFields(fields) {
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
