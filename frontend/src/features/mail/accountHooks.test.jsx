import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useMailAccounts } from './accountHooks';

const apiMocks = vi.hoisted(() => ({
  bindMailAccount: vi.fn(),
  getMailAccounts: vi.fn(),
  unbindMailAccount: vi.fn(),
  verifyMailAccount: vi.fn(),
}));

vi.mock('./accountsApi', () => ({
  bindMailAccount: apiMocks.bindMailAccount,
  getMailAccounts: apiMocks.getMailAccounts,
  getMailProviders: vi.fn(),
  getMicrosoftMailStatus: vi.fn(),
  unbindMailAccount: apiMocks.unbindMailAccount,
  verifyMailAccount: apiMocks.verifyMailAccount,
}));

function MailAccountsProbe({ id, controls = false }) {
  const { mailAccounts, bindMailAccount, unbindMailAccount } = useMailAccounts();
  return (
    <div>
      <span data-testid={id}>{mailAccounts.map(account => account.id).join(',')}</span>
      {controls && (
        <>
          <button onClick={() => bindMailAccount({ email_address: 'second@example.com' })}>bind</button>
          <button onClick={() => unbindMailAccount('mail-1')}>unbind</button>
        </>
      )}
    </div>
  );
}

describe('mail account hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getMailAccounts.mockResolvedValue([{ id: 'mail-1' }]);
    apiMocks.bindMailAccount.mockResolvedValue({ id: 'mail-2' });
    apiMocks.unbindMailAccount.mockResolvedValue('mail-1');
    apiMocks.verifyMailAccount.mockResolvedValue({ status: 'ok' });
  });

  it('deduplicates account loading and synchronizes bind and unbind mutations', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = { authToken: 'token', user: { email: 'person@example.com' } };

    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <MailAccountsProbe id="first" controls />
          <MailAccountsProbe id="second" />
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('mail-1'));
    expect(apiMocks.getMailAccounts).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'bind' }));
    await waitFor(() => expect(screen.getByTestId('second')).toHaveTextContent('mail-1,mail-2'));
    expect(apiMocks.bindMailAccount).toHaveBeenCalledWith('token', { email_address: 'second@example.com' });

    fireEvent.click(screen.getByRole('button', { name: 'unbind' }));
    await waitFor(() => expect(screen.getByTestId('first')).toHaveTextContent('mail-2'));
    expect(apiMocks.unbindMailAccount).toHaveBeenCalledWith('token', 'mail-1');
  });
});
