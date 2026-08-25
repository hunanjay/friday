import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { AuthContext } from '../auth/auth-context';
import {
  deleteMailMessage,
  saveMicrosoftDraft,
  sendMail,
} from './mailboxApi';
import { useMailCompose } from './useMailCompose';

vi.mock('./mailboxApi', async importOriginal => ({
  ...(await importOriginal()),
  deleteMailMessage: vi.fn(),
  saveMicrosoftDraft: vi.fn(),
  sendMail: vi.fn(),
}));

function ComposeProbe({ onSent = vi.fn(), onToast = vi.fn() }) {
  const compose = useMailCompose({
    connectionErrorMessage: 'Connection failed',
    onSent,
    onToast,
    sentMessage: 'Sent',
  });
  return (
    <div>
      <span data-testid="open">{String(compose.isComposing)}</span>
      <span data-testid="sending">{String(compose.isSending)}</span>
      <input
        aria-label="to"
        value={compose.composeTo}
        onChange={event => compose.setComposeTo(event.target.value)}
      />
      <input
        aria-label="subject"
        value={compose.composeSubject}
        onChange={event => compose.setComposeSubject(event.target.value)}
      />
      <textarea
        aria-label="body"
        value={compose.composeBody}
        onChange={event => compose.setComposeBody(event.target.value)}
      />
      <button onClick={compose.openFreshCompose}>open</button>
      <button onClick={compose.submitCompose}>send</button>
      <button onClick={() => compose.openComposeFor({
        id: 'message-1',
        provider: 'microsoft',
        subject: 'Thread',
        sender: { emailAddress: { address: 'sender@example.com' } },
      }, 'replyAll')}>reply-all</button>
    </div>
  );
}

function renderCompose(props = {}) {
  const auth = {
    authToken: 'token',
    handleLogout: vi.fn(),
    user: { id: 'user-1' },
  };
  const onSent = vi.fn();
  const onToast = vi.fn();
  const view = render(
    <AuthContext.Provider value={auth}>
      <ComposeProbe {...props} onSent={onSent} onToast={onToast} />
    </AuthContext.Provider>,
  );
  return { ...view, auth, onSent, onToast };
}

describe('useMailCompose', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    saveMicrosoftDraft.mockResolvedValue({ id: 'draft-1' });
    sendMail.mockResolvedValue({ status: 'sent' });
    deleteMailMessage.mockResolvedValue(null);
  });

  it('mirrors a fresh Microsoft compose to Outlook after the debounce', async () => {
    vi.useFakeTimers();
    renderCompose();

    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.change(screen.getByLabelText('to'), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText('subject'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText('body'), { target: { value: 'Draft body' } });
    await act(async () => vi.advanceTimersByTime(2000));

    expect(saveMicrosoftDraft).toHaveBeenCalledWith('token', expect.objectContaining({
      draftId: null,
      to: 'person@example.com',
      subject: 'Hello',
      body: 'Draft body',
    }));
  });

  it('sends a reply-all, clears compose state, and tells folders to refresh', async () => {
    const { onSent, onToast } = renderCompose();

    fireEvent.click(screen.getByRole('button', { name: 'reply-all' }));
    fireEvent.change(screen.getByLabelText('body'), { target: { value: 'My reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));

    await waitFor(() => expect(sendMail).toHaveBeenCalledWith('token', expect.objectContaining({
      messageId: 'message-1',
      mode: 'replyAll',
      to: 'sender@example.com',
      subject: 'Re: Thread',
      body: 'My reply',
    })));
    await waitFor(() => expect(screen.getByTestId('open')).toHaveTextContent('false'));
    expect(onSent).toHaveBeenCalledOnce();
    expect(onToast).toHaveBeenCalledWith('Sent');
  });

  it('logs out on an unauthorized send without reporting success', async () => {
    sendMail.mockRejectedValue(new ApiError('Unauthorized', { status: 401 }));
    const { auth, onSent, onToast } = renderCompose();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.change(screen.getByLabelText('to'), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText('subject'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText('body'), { target: { value: 'Body' } });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));

    await waitFor(() => expect(auth.handleLogout).toHaveBeenCalledOnce());
    expect(onSent).not.toHaveBeenCalled();
    expect(onToast).not.toHaveBeenCalledWith('Sent');
  });
});
