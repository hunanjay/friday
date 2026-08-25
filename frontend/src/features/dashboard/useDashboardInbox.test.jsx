import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { AuthContext } from '../auth/auth-context';
import { getMailFolderPage } from '../mail/mailboxApi';
import { useDashboardInbox } from './useDashboardInbox';

const mailState = vi.hoisted(() => ({
  accounts: [{ id: 'account-1' }],
  syncInboxEmails: vi.fn(),
}));

vi.mock('../mail/accountHooks', () => ({
  useMailAccounts: () => ({ mailAccounts: mailState.accounts }),
}));

vi.mock('../mail/mailboxHooks', () => ({
  useMailMessages: () => ({ syncInboxEmails: mailState.syncInboxEmails }),
}));

vi.mock('../mail/mailboxApi', async importOriginal => ({
  ...(await importOriginal()),
  getMailFolderPage: vi.fn(),
}));

function InboxProbe() {
  const inbox = useDashboardInbox();
  return <span data-testid="status">{`${inbox.isLoadingInbox}:${inbox.inboxError}`}</span>;
}

function renderInbox(authOverrides = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const auth = {
    authToken: 'token',
    handleLogout: vi.fn(),
    user: { id: 'user-1' },
    ...authOverrides,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <InboxProbe />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { ...view, auth };
}

describe('useDashboardInbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailState.accounts = [{ id: 'account-1' }];
    getMailFolderPage.mockImplementation(async (_token, { channel }) => ({
      value: [{
        id: channel === 'microsoft' ? 'graph-1' : 'imap:account-1:INBOX:1',
        provider: channel === 'microsoft' ? 'graph' : 'imap',
        subject: channel,
      }],
    }));
  });

  it('loads all mailbox channels and publishes one normalized inbox snapshot', async () => {
    renderInbox();

    await waitFor(() => expect(mailState.syncInboxEmails).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'graph-1', provider: 'microsoft', parentFolderId: 'inbox' }),
      expect.objectContaining({
        id: 'imap:account-1:INBOX:1',
        provider: 'account-1',
        parentFolderId: 'inbox',
      }),
    ]));
    expect(getMailFolderPage).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('status')).toHaveTextContent('false:false');
  });

  it('keeps healthy mailbox results when one provider fails', async () => {
    getMailFolderPage.mockImplementation(async (_token, { channel }) => {
      if (channel === 'microsoft') throw new ApiError('Graph unavailable', { status: 503 });
      return { value: [{ id: 'imap:account-1:INBOX:1', provider: 'imap' }] };
    });
    renderInbox();

    await waitFor(() => expect(mailState.syncInboxEmails).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'imap:account-1:INBOX:1' }),
    ]));
    expect(screen.getByTestId('status')).toHaveTextContent('false:false');
  });

  it('logs out and exposes a panel error on unauthorized access', async () => {
    getMailFolderPage.mockRejectedValue(new ApiError('Unauthorized', { status: 401 }));
    const { auth } = renderInbox();

    await waitFor(() => expect(auth.handleLogout).toHaveBeenCalled());
    expect(screen.getByTestId('status')).toHaveTextContent('false:true');
    expect(mailState.syncInboxEmails).not.toHaveBeenCalled();
  });
});
