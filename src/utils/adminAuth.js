import api, { route } from '@forge/api';

export async function isConfluenceAdmin(accountId) {
  try {
    const response = await api
      .asApp()
      .requestConfluence(
        route`/wiki/rest/api/user/memberof?accountId=${accountId}`,
        {
          headers: { 'Accept': 'application/json' }
        }
      );

    if (!response.ok) {
      console.error('Failed to check admin status:', response.status);
      return false;
    }

    const data = await response.json();
    const isAdmin = data.results.some(
      group => group.name === 'confluence-administrators'
    );

    return isAdmin;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}
