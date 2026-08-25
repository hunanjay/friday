import { apiRequest } from '../../api/client';

export async function getMailAccounts(token) {
  const data = await apiRequest('/api/mail-accounts', { token });
  return data?.accounts || [];
}

export async function getMailProviders(token) {
  const data = await apiRequest('/api/mail-providers', { token });
  return data?.providers || [];
}

export async function bindMailAccount(token, account) {
  const data = await apiRequest('/api/mail-accounts', {
    method: 'POST',
    token,
    body: account,
  });
  return data.account;
}

export async function unbindMailAccount(token, accountId) {
  await apiRequest(`/api/mail-accounts/${accountId}`, {
    method: 'DELETE',
    token,
  });
  return accountId;
}

export async function verifyMailAccount(token, accountId) {
  return apiRequest(`/api/mail-accounts/${accountId}/verify`, {
    method: 'POST',
    token,
  });
}

export async function getMicrosoftMailStatus(token) {
  return apiRequest('/api/graph/status', { token });
}
