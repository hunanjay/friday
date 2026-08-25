import { apiRequest } from '../../api/client';

export async function getInboxUnread(token, accountIds) {
  const requests = [
    apiRequest('/api/graph/mail/folders/inbox', { token }),
    ...accountIds.map(accountId => (
      apiRequest(`/api/mail-accounts/${accountId}/mail/folders/inbox`, { token })
    )),
  ];
  const counts = await Promise.all(requests.map(request => request.catch(() => null)));
  return counts.reduce((total, count) => total + (count?.unread || 0), 0);
}
