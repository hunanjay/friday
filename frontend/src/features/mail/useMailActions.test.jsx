import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { AuthContext } from '../auth/auth-context';
import { deleteMailMessage, generateMailReply } from './mailboxApi';
import { useMailActions } from './useMailActions';

vi.mock('./mailboxApi', async importOriginal => ({
  ...(await importOriginal()),
  deleteMailMessage: vi.fn(),
  generateMailReply: vi.fn(),
}));

const MESSAGE = {
  id: 'message-1',
  isRead: false,
  parentFolderId: 'inbox',
  provider: 'microsoft',
};

function ActionsProbe({ callbacks }) {
  const actions = useMailActions({
    adjustInboxUnread: callbacks.adjustInboxUnread,
    assistantDraftedMessage: 'Assistant drafted',
    emails: [MESSAGE],
    isZh: false,
    movedToTrashMessage: 'Moved to trash',
    moveEmailToTrash: callbacks.moveEmailToTrash,
    onToast: callbacks.onToast,
    removeThreadMessage: callbacks.removeThreadMessage,
    selectedConversationKey: 'thread-1',
    selectedEmail: MESSAGE,
    threadMessages: [MESSAGE],
  });
  return (
    <div>
      <span data-testid="draft">{actions.aiDraft}</span>
      <span data-testid="drafting">{String(actions.isDrafting)}</span>
      <button onClick={() => actions.deleteMessage('message-1')}>delete</button>
      <button onClick={() => actions.generateReply('Accept')}>generate</button>
    </div>
  );
}

function renderActions() {
  const auth = {
    authToken: 'token',
    handleLogout: vi.fn(),
    user: { id: 'user-1', name: 'Ada' },
  };
  const callbacks = {
    adjustInboxUnread: vi.fn(),
    moveEmailToTrash: vi.fn(),
    onToast: vi.fn(),
    removeThreadMessage: vi.fn(),
  };
  const view = render(
    <AuthContext.Provider value={auth}>
      <ActionsProbe callbacks={callbacks} />
    </AuthContext.Provider>,
  );
  return { ...view, auth, callbacks };
}

describe('useMailActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteMailMessage.mockResolvedValue(null);
    generateMailReply.mockResolvedValue({ draft: 'Generated reply' });
  });

  it('optimistically deletes a message and updates unread state', async () => {
    const { callbacks } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'delete' }));

    expect(callbacks.adjustInboxUnread).toHaveBeenCalledWith(-1);
    expect(callbacks.moveEmailToTrash).toHaveBeenCalledWith('message-1');
    expect(callbacks.removeThreadMessage).toHaveBeenCalledWith('message-1');
    expect(callbacks.onToast).toHaveBeenCalledWith('Moved to trash');
    expect(deleteMailMessage).toHaveBeenCalledWith('token', 'message-1');
  });

  it('generates and exposes an assistant reply', async () => {
    const { callbacks } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'generate' }));

    await waitFor(() => expect(screen.getByTestId('draft')).toHaveTextContent('Generated reply'));
    expect(generateMailReply).toHaveBeenCalledWith('token', {
      emailId: 'message-1',
      intent: 'Accept',
      userName: 'Ada',
    });
    expect(callbacks.onToast).toHaveBeenCalledWith('Assistant drafted');
  });

  it('logs out when assistant generation is unauthorized', async () => {
    generateMailReply.mockRejectedValue(new ApiError('Unauthorized', { status: 401 }));
    const { auth } = renderActions();

    fireEvent.click(screen.getByRole('button', { name: 'generate' }));

    await waitFor(() => expect(auth.handleLogout).toHaveBeenCalledOnce());
    expect(screen.getByTestId('draft')).toBeEmptyDOMElement();
  });
});
