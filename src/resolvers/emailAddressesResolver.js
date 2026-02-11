import { getEmailAddresses, buildMailtoUrl } from '../services/emailService';
import { successResponse, errorResponse } from '../utils/responseHelper';

export async function emailAddressesResolver(req) {
  try {
    const { accountIds, subject } = req.payload;

    if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
      return errorResponse('accountIds must be a non-empty array', 400);
    }

    const users = await getEmailAddresses(accountIds);
    const emails = users.map(u => u.email).filter(Boolean);
    const mailto = buildMailtoUrl(emails, subject || 'Digital Signature');

    return successResponse({
      users,
      mailto,
    });
  } catch (error) {
    console.error('Error in email addresses resolver:', error);
    return errorResponse(error.message || 'Failed to fetch email addresses', 500);
  }
}
