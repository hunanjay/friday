import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../api/client';
import {
  bindMailAccount,
  getMailAccounts,
  getMailProviders,
  getMicrosoftMailStatus,
  unbindMailAccount,
  verifyMailAccount,
} from './accountsApi';

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }));

describe('mail account API', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['accounts', getMailAccounts, '/api/mail-accounts', { accounts: [{ id: 'mail-1' }] }, [{ id: 'mail-1' }]],
    ['providers', getMailProviders, '/api/mail-providers', { providers: [{ provider: 'custom' }] }, [{ provider: 'custom' }]],
    ['Microsoft status', getMicrosoftMailStatus, '/api/graph/status', { connected: true }, { connected: true }],
  ])('loads %s through the shared client', async (_label, request, path, response, expected) => {
    apiRequest.mockResolvedValueOnce(response);

    await expect(request('token')).resolves.toEqual(expected);
    expect(apiRequest).toHaveBeenCalledWith(path, { token: 'token' });
  });

  it('binds an account without exposing credentials to the URL', async () => {
    const body = { provider: 'custom', email_address: 'me@example.com', auth_code: 'secret' };
    const account = { id: 'mail-1', email_address: 'me@example.com' };
    apiRequest.mockResolvedValueOnce({ account });

    await expect(bindMailAccount('token', body)).resolves.toBe(account);
    expect(apiRequest).toHaveBeenCalledWith('/api/mail-accounts', {
      method: 'POST',
      token: 'token',
      body,
    });
  });

  it('unbinds and returns the removed account id', async () => {
    apiRequest.mockResolvedValueOnce({ status: 'ok' });

    await expect(unbindMailAccount('token', 'mail-1')).resolves.toBe('mail-1');
    expect(apiRequest).toHaveBeenCalledWith('/api/mail-accounts/mail-1', {
      method: 'DELETE',
      token: 'token',
    });
  });

  it('verifies an account', async () => {
    apiRequest.mockResolvedValueOnce({ status: 'ok' });

    await expect(verifyMailAccount('token', 'mail-1')).resolves.toEqual({ status: 'ok' });
    expect(apiRequest).toHaveBeenCalledWith('/api/mail-accounts/mail-1/verify', {
      method: 'POST',
      token: 'token',
    });
  });
});
