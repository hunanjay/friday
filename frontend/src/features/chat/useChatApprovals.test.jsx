import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/errors';
import { AuthContext } from '../auth/auth-context';
import { decideChatAction } from './api';
import { useChatApprovals } from './useChatApprovals';

vi.mock('./api', () => ({ decideChatAction: vi.fn() }));

const action = {
  id: 'action-1',
  session_id: 'session-1',
  status: 'pending',
  decisions: [{ id: 'approve', outcome: 'approve' }],
};

function ApprovalProbe({ onPreview, onUnauthorized }) {
  const {
    pendingActions,
    decideApproval,
    restoreApprovals,
  } = useChatApprovals({
    sessionId: 'session-1',
    failureMessage: 'Approval failed',
    onPreview,
    onUnauthorized,
  });
  return (
    <div>
      <span data-testid="actions">
        {pendingActions.map(item => `${item.id}:${item.status}:${item.error || ''}`).join(',')}
      </span>
      <button onClick={() => restoreApprovals([action], [{ id: 'bot-1', sender: 'bot' }])}>
        restore
      </button>
      <button onClick={() => decideApproval(action, 'approve', { subject: 'Edited' })}>
        approve
      </button>
    </div>
  );
}

function renderApprovals({ apiResult, apiError } = {}) {
  const handleLogout = vi.fn();
  const onPreview = vi.fn();
  const onUnauthorized = vi.fn();
  if (apiError) decideChatAction.mockRejectedValueOnce(apiError);
  else decideChatAction.mockResolvedValueOnce(apiResult || {});
  render(
    <AuthContext.Provider value={{ authToken: 'token', handleLogout }}>
      <ApprovalProbe onPreview={onPreview} onUnauthorized={onUnauthorized} />
    </AuthContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'restore' }));
  return { handleLogout, onPreview, onUnauthorized };
}

describe('useChatApprovals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('executes an edited approval and marks it succeeded', async () => {
    const { onPreview } = renderApprovals({ apiResult: { preview: 'Sent mail' } });

    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(screen.getByTestId('actions')).toHaveTextContent('action-1:succeeded'));
    expect(decideChatAction).toHaveBeenCalledWith('token', {
      actionId: 'action-1',
      decision: 'approve',
      sessionId: 'session-1',
      edits: { subject: 'Edited' },
    });
    expect(onPreview).toHaveBeenCalledWith('session-1', 'Sent mail');
  });

  it('turns a stale approval into an expired terminal card', async () => {
    renderApprovals({ apiError: new ApiError('Expired', { status: 410 }) });

    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(screen.getByTestId('actions')).toHaveTextContent('action-1:expired'));
  });

  it('logs out and delegates navigation after an unauthorized decision', async () => {
    const { handleLogout, onUnauthorized } = renderApprovals({
      apiError: new ApiError('Unauthorized', { status: 401 }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'approve' }));
    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledOnce());
    expect(handleLogout).toHaveBeenCalledOnce();
  });
});
