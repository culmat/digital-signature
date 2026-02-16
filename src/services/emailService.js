import api, { route } from '@forge/api';

// Fetches email addresses for a list of accountIds using the dedicated Confluence email API.
// Requires the read:user:email scope in manifest.yml.
// Returns [{ accountId, email, displayName }] — users without emails are included with email: null.
export async function getEmailAddresses(accountIds) {
  const uniqueIds = [...new Set(accountIds)];
  if (uniqueIds.length === 0) return [];

  const results = await Promise.all(uniqueIds.map(fetchUserEmail));
  return results;
}

async function fetchUserEmail(accountId) {
  try {
    const response = await api
      .asApp()
      .requestConfluence(route`/wiki/rest/api/user/email?accountId=${accountId}`, {
        headers: { 'Accept': 'application/json' },
      });

    if (!response.ok) {
      console.error(`Failed to fetch email for ${accountId}: ${response.status}`);
      return { accountId, email: null, displayName: null };
    }

    const data = await response.json();
    // Handle both single user and results array formats
    const user = data.results && data.results.length > 0 ? data.results[0] : data;
    return {
      accountId: user.accountId || accountId,
      email: user.email || null,
      displayName: user.publicName || user.displayName || null,
    };
  } catch (error) {
    console.error(`Error fetching email for ${accountId}:`, error);
    return { accountId, email: null, displayName: null };
  }
}

export function buildMailtoUrl(emailAddresses, subject) {
  const validEmails = emailAddresses.filter(Boolean);
  if (validEmails.length === 0) return null;

  const mailto = `mailto:${validEmails.join(',')}?subject=${encodeURIComponent(subject)}`;
  return mailto.length <= 2000 ? mailto : null;
}
