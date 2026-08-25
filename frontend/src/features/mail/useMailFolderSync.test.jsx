import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { AuthContext } from '../auth/auth-context';
import { getMailFolderPage } from './mailboxApi';
import { useMailFolderSync } from './useMailFolderSync';

const mailState = vi.hoisted(() => ({
  accounts: [{ id: 'mail-1' }],
  appendEmails: vi.fn(),
  setIsSyncingInbox: vi.fn(),
  syncInboxEmails: vi.fn(),
  syncSentEmails: vi.fn(),
}));

vi.mock('./accountHooks', () => ({
  useMailAccounts: () => ({ mailAccounts: mailState.accounts }),
}));

vi.mock('./mailboxHooks', () => ({
  useMailMessages: () => ({
    appendEmails: mailState.appendEmails,
    syncInboxEmails: mailState.syncInboxEmails,
    syncSentEmails: mailState.syncSentEmails,
  }),
  useMailSyncStatus: () => ({ setIsSyncingInbox: mailState.setIsSyncingInbox }),
}));

vi.mock('./mailboxApi', async (importOriginal) => ({
  ...(await importOriginal()),
  getMailFolderPage: vi.fn(),
}));

function FolderProbe({ activeFolder = 'inbox', onError = vi.fn() }) {
  const {
    canLoadMoreFolder,
    isLoadingMoreFolder,
    isSyncingSent,
    loadMoreFolder,
    syncSent,
  } = useMailFolderSync({ activeFolder, onError });
  return (
    <div>
      <span data-testid="status">
        {`${canLoadMoreFolder}:${isLoadingMoreFolder}:${isSyncingSent}`}
      </span>
      <button onClick={loadMoreFolder}>more</button>
      <button onClick={syncSent}>sync-sent</button>
    </div>
  );
}

function renderFolder(activeFolder = 'inbox', authOverrides = {}) {
  const auth = {
    authToken: 'token',
    handleLogout: vi.fn(),
    user: { id: 'user-1' },
    ...authOverrides,
  };
  const onError = vi.fn();
  const view = render(
    <AuthContext.Provider value={auth}>
      <FolderProbe activeFolder={activeFolder} onError={onError} />
    </AuthContext.Provider>,
  );
  return { ...view, auth, onError };
}

describe('useMailFolderSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailState.accounts = [{ id: 'mail-1' }];
    getMailFolderPage.mockImplementation(async (_token, { channel, folder, cursor }) => {
      if (cursor === 'next-microsoft') {
        return { value: [{ id: 'graph-2', subject: 'Next' }], next_cursor: null };
      }
      const id = channel === 'microsoft' ? 'graph-1' : `imap:${channel}:INBOX:1`;
      return {
        value: [{ id, provider: channel === 'microsoft' ? 'graph' : 'imap', subject: folder }],
        next_cursor: channel === 'microsoft' ? 'next-microsoft' : null,
      };
    });
  });

  it('syncs all inbox channels and appends the next available page', async () => {
    renderFolder();

    await waitFor(() => expect(mailState.syncInboxEmails).toHaveBeenCalledOnce());
    expect(mailState.syncInboxEmails).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'graph-1', provider: 'microsoft', parentFolderId: 'inbox' }),
      expect.objectContaining({ id: 'imap:mail-1:INBOX:1', provider: 'mail-1', parentFolderId: 'inbox' }),
    ]);
    expect(screen.getByTestId('status')).toHaveTextContent('true:false:false');

    fireEvent.click(screen.getByRole('button', { name: 'more' }));
    await waitFor(() => expect(mailState.appendEmails).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'graph-2', parentFolderId: 'inbox' }),
    ]));
    expect(getMailFolderPage).toHaveBeenCalledWith('token', {
      channel: 'microsoft',
      folder: 'inbox',
      cursor: 'next-microsoft',
    });
  });

  it('lazily syncs sent mail once when the folder becomes active', async () => {
    const { rerender, auth, onError } = renderFolder('inbox');
    await waitFor(() => expect(mailState.syncInboxEmails).toHaveBeenCalledOnce());

    rerender(
      <AuthContext.Provider value={auth}>
        <FolderProbe activeFolder="sent" onError={onError} />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(mailState.syncSentEmails).toHaveBeenCalledOnce());
    rerender(
      <AuthContext.Provider value={auth}>
        <FolderProbe activeFolder="sent" onError={onError} />
      </AuthContext.Provider>,
    );
    expect(mailState.syncSentEmails).toHaveBeenCalledOnce();
  });

  it('can refresh sent mail explicitly after a message is sent', async () => {
    renderFolder('inbox');
    await waitFor(() => expect(mailState.syncInboxEmails).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'sync-sent' }));

    await waitFor(() => expect(mailState.syncSentEmails).toHaveBeenCalledOnce());
    expect(getMailFolderPage).toHaveBeenCalledWith('token', expect.objectContaining({
      folder: 'sent',
    }));
  });

  it('logs out when a folder request is unauthorized', async () => {
    getMailFolderPage.mockRejectedValue(new ApiError('Unauthorized', { status: 401 }));
    const { auth } = renderFolder();

    await waitFor(() => expect(auth.handleLogout).toHaveBeenCalled());
    expect(mailState.syncInboxEmails).not.toHaveBeenCalled();
  });

  it('resyncs the inbox when the authenticated user changes', async () => {
    const { rerender, onError } = renderFolder();
    await waitFor(() => expect(mailState.syncInboxEmails).toHaveBeenCalledOnce());

    rerender(
      <AuthContext.Provider value={{
        authToken: 'token-2',
        handleLogout: vi.fn(),
        user: { id: 'user-2' },
      }}>
        <FolderProbe activeFolder="inbox" onError={onError} />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(mailState.syncInboxEmails).toHaveBeenCalledTimes(2));
    expect(getMailFolderPage).toHaveBeenCalledWith('token-2', expect.objectContaining({
      folder: 'inbox',
    }));
  });
});
