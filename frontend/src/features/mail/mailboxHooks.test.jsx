import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import { useInboxUnread, useMailMessages, useMailSyncStatus } from './mailboxHooks';

const apiMocks = vi.hoisted(() => ({ getInboxUnread: vi.fn() }));

vi.mock('./accountHooks', () => ({
  useMailAccounts: () => ({ mailAccounts: [{ id: 'mail-1' }] }),
}));

vi.mock('./mailboxApi', () => ({ getInboxUnread: apiMocks.getInboxUnread }));

function MailboxProbe({ id, controls = false }) {
  const { emails, syncInboxEmails, appendEmails, markEmailRead, moveEmailToTrash } = useMailMessages();
  const { inboxUnread, adjustInboxUnread } = useInboxUnread();
  const { isSyncingInbox, setIsSyncingInbox } = useMailSyncStatus();
  return (
    <div>
      <span data-testid={`${id}-messages`}>
        {emails.map(email => `${email.id}:${email.parentFolderId}:${email.isRead}`).join(',')}
      </span>
      <span data-testid={`${id}-unread`}>{inboxUnread}</span>
      <span data-testid={`${id}-syncing`}>{String(isSyncingInbox)}</span>
      {controls && (
        <>
          <button onClick={() => syncInboxEmails([{ id: 'mail-1', parentFolderId: 'inbox', isRead: false }])}>sync</button>
          <button onClick={() => appendEmails([{ id: 'mail-1' }, { id: 'mail-2', parentFolderId: 'inbox', isRead: false }])}>append</button>
          <button onClick={() => markEmailRead('mail-1')}>read</button>
          <button onClick={() => moveEmailToTrash('mail-2')}>trash</button>
          <button onClick={() => adjustInboxUnread(-1)}>decrement</button>
          <button onClick={() => setIsSyncingInbox(true)}>start sync</button>
        </>
      )}
    </div>
  );
}

describe('mailbox hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getInboxUnread.mockResolvedValue(5);
  });

  it('shares folder snapshots, unread adjustments, and sync state across consumers', async () => {
    localStorage.setItem('emails', '[{"id":"legacy"}]');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const auth = { authToken: 'token', user: { email: 'person@example.com' } };
    render(
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={auth}>
          <MailboxProbe id="first" controls />
          <MailboxProbe id="second" />
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('first-unread')).toHaveTextContent('5'));
    expect(localStorage.getItem('emails')).toBeNull();
    expect(apiMocks.getInboxUnread).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'sync' }));
    fireEvent.click(screen.getByRole('button', { name: 'append' }));
    await waitFor(() => expect(screen.getByTestId('second-messages')).toHaveTextContent('mail-1:inbox:false,mail-2:inbox:false'));

    fireEvent.click(screen.getByRole('button', { name: 'read' }));
    fireEvent.click(screen.getByRole('button', { name: 'trash' }));
    fireEvent.click(screen.getByRole('button', { name: 'decrement' }));
    fireEvent.click(screen.getByRole('button', { name: 'start sync' }));

    await waitFor(() => expect(screen.getByTestId('second-messages')).toHaveTextContent('mail-1:inbox:true,mail-2:trash:false'));
    expect(screen.getByTestId('second-unread')).toHaveTextContent('4');
    expect(screen.getByTestId('second-syncing')).toHaveTextContent('true');
  });
});
