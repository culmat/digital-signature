import api, { route } from '@forge/api';

const MAX_USERS_PER_BATCH = 200;

// Fetches email addresses for a list of accountIds using the Confluence bulk user API.
// Returns [{ accountId, email, displayName }] — users without emails are included with email: null.
export async function getEmailAddresses(accountIds) {
  const uniqueIds = [...new Set(accountIds)];
  if (uniqueIds.length === 0) return [];

  const results = [];

  for (let i = 0; i < uniqueIds.length; i += MAX_USERS_PER_BATCH) {
    const batch = uniqueIds.slice(i, i + MAX_USERS_PER_BATCH);
    const batchResults = await fetchUserBatch(batch);
    results.push(...batchResults);
  }

  return results;
}

async function fetchUserBatch(accountIds) {
  const queryParams = accountIds.map(id => `account-ids=${encodeURIComponent(id)}`).join('&');

  const response = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/users-bulk?${queryParams}`);

  if (!response.ok) {
    console.error(`Failed to fetch user emails: ${response.status}`);
    return accountIds.map(id => ({ accountId: id, email: null, displayName: null }));
  }

  const data = await response.json();
  const userMap = new Map();

  for (const user of (data.results || [])) {
    userMap.set(user.accountId, {
      accountId: user.accountId,
      email: user.email || null,
      displayName: user.publicName || user.displayName || null,
    });
  }

  // Ensure every requested accountId appears in results
  return accountIds.map(id => userMap.get(id) || { accountId: id, email: null, displayName: null });
}

export function buildMailtoUrl(emailAddresses, subject) {
  const validEmails = emailAddresses.filter(Boolean);
  if (validEmails.length === 0) return null;

  const mailto = `mailto:${validEmails.join(',')}?subject=${encodeURIComponent(subject)}`;
  return mailto.length <= 2000 ? mailto : null;
}
