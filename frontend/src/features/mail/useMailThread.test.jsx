import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../auth/auth-context';
import {
  getMailMessage,
  getMailThread,
  markMailMessageRead,
} from './mailboxApi';
import { useMailThread } from './useMailThread';

const mailState = vi.hoisted(() => ({
  adjustInboxUnread: vi.fn(),
  emails: [],
  markEmailRead: vi.fn(),
}));

vi.mock('./mailboxHooks', () => ({
  useInboxUnread: () => ({ adjustInboxUnread: mailState.adjustInboxUnread }),
  useMailMessages: () => ({
    emails: mailState.emails,
    markEmailRead: mailState.markEmailRead,
  }),
}));

vi.mock('./mailboxApi', async (importOriginal) => ({
  ...(await importOriginal()),
  getMailMessage: vi.fn(),
  getMailThread: vi.fn(),
  markMailMessageRead: vi.fn(),
}));

const ROW_A = {
  id: 'message-a',
  _threadKey: 'conversation-a',
  conversationId: 'conversation-a',
  isRead: false,
  parentFolderId: 'inbox',
  provider: 'microsoft',
};
const ROW_B = {
  id: 'message-b',
  _threadKey: 'conversation-b',
  conversationId: 'conversation-b',
  isRead: true,
  parentFolderId: 'inbox',
  provider: 'microsoft',
};

function ThreadProbe({ onOpen = vi.fn() }) {
  const thread = useMailThread({ onOpen });
  return (
    <div>
      <span data-testid="selected">{thread.selectedConversationKey || ''}</span>
      <span data-testid="messages">{thread.threadMessages.map(message => message.id).join(',')}</span>
      <span data-testid="expanded">{[...thread.expandedMessageIds].join(',')}</span>
      <span data-testid="loading">{String(thread.isLoadingThread)}</span>
      <button onClick={() => thread.selectThread(ROW_A)}>select-a</button>
      <button onClick={() => thread.selectThread(ROW_B)}>select-b</button>
      <button onClick={() => thread.prefetchThread(ROW_A)}>prefetch-a</button>
      <button onClick={thread.clearThreadSelection}>clear</button>
      <button onClick={() => thread.removeThreadMessage('message-a')}>remove-a</button>
      <button onClick={() => thread.toggleMessageExpanded('message-a')}>toggle-a</button>
      <button onClick={() => thread.loadLinkedMessage({
        messageId: 'imap:mail-1:INBOX:4',
        folder: 'sent',
        provider: 'mail-1',
      })}>linked</button>
    </div>
  );
}

function renderThread() {
  const auth = {
    authToken: 'token',
    handleLogout: vi.fn(),
    user: { id: 'user-1' },
  };
  const onOpen = vi.fn();
  const view = render(
    <AuthContext.Provider value={auth}>
      <ThreadProbe onOpen={onOpen} />
    </AuthContext.Provider>,
  );
  return { ...view, auth, onOpen };
}

describe('useMailThread', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    mailState.emails = [{ ...ROW_A }];
    getMailThread.mockResolvedValue([
      { id: 'message-a', isRead: false },
      { id: 'message-a2', isRead: true },
    ]);
    getMailMessage.mockResolvedValue({
      id: 'imap:mail-1:INBOX:4',
      provider: 'imap',
      subject: 'Linked',
    });
    markMailMessageRead.mockResolvedValue({ status: 'ok' });
  });

  it('marks unread mail, expands it, and reuses the cached thread', async () => {
    const { onOpen } = renderThread();

    fireEvent.click(screen.getByRole('button', { name: 'select-a' }));
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent(
      'message-a,message-a2',
    ));
    expect(screen.getByTestId('expanded')).toHaveTextContent('message-a');
    expect(mailState.markEmailRead).toHaveBeenCalledWith('message-a', true);
    expect(mailState.adjustInboxUnread).toHaveBeenCalledWith(-1);
    expect(markMailMessageRead).toHaveBeenCalledWith('token', 'message-a');
    expect(onOpen).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'select-a' }));
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('message-a'));
    expect(getMailThread).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'remove-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'select-a' }));
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent(/^message-a2$/));
    expect(getMailThread).toHaveBeenCalledOnce();
  });

  it('ignores a slower response after another thread is selected', async () => {
    let resolveA;
    let resolveB;
    getMailThread.mockImplementation((_token, row) => new Promise(resolve => {
      if (row.id === 'message-a') resolveA = resolve;
      else resolveB = resolve;
    }));
    renderThread();

    fireEvent.click(screen.getByRole('button', { name: 'select-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'select-b' }));
    await act(async () => resolveB([{ id: 'message-b' }]));
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('message-b'));
    await act(async () => resolveA([{ id: 'message-a' }]));
    expect(screen.getByTestId('messages')).toHaveTextContent('message-b');
  });

  it('prefetches after the hover delay and serves selection from cache', async () => {
    vi.useFakeTimers();
    renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'prefetch-a' }));
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(getMailThread).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'select-a' }));
    await act(async () => Promise.resolve());
    expect(getMailThread).toHaveBeenCalledOnce();
  });

  it('loads linked messages through the same provider contract', async () => {
    renderThread();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'linked' }));
    });
    expect(getMailMessage).toHaveBeenCalledWith('token', 'imap:mail-1:INBOX:4');
  });
});
