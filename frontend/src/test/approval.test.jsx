import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import '../i18n';
import ApprovalCard from '../components/common/ApprovalCard';
import {
  resolveLiveApprovalAnchor,
  resolvePersistedApprovalAnchor,
} from '../features/chat/approvalPlacement';

describe('ApprovalCard', () => {
  it('shows the saved signature under the draft without making it editable', () => {
    const onDecision = vi.fn();
    const action = {
      action_type: 'mail.send',
      payload: { to: 'a@b.com', subject: 'Hi', body: 'Original' },
      presentation: { renderer: 'email', editable: true, signature: 'Best,\nJane' },
      decisions: [
        { id: 'approve', outcome: 'approve', label_key: 'chat.confirmSend', style: 'primary' },
      ],
    };
    const { rerender } = render(<ApprovalCard action={action} onDecision={onDecision} />, {
      wrapper: MemoryRouter,
    });
    expect(screen.getByText('Best,\nJane', { collapseWhitespace: false })).toBeInTheDocument();
    // The signature is display only - approving must not send it as an edit.
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onDecision).toHaveBeenCalledWith('approve', {});

    // A body the user already signed must not show the signature twice.
    rerender(
      <ApprovalCard
        action={{ ...action, payload: { ...action.payload, body: 'Original\n\nBest,\nJane' } }}
        onDecision={onDecision}
      />,
    );
    expect(screen.queryByText('Best,\nJane', { collapseWhitespace: false })).not.toBeInTheDocument();
  });

  it('sends inline edits to the email draft along with the approval', () => {
    const onDecision = vi.fn();
    render(
      <ApprovalCard
        action={{
          action_type: 'mail.send',
          payload: { to: 'a@b.com', subject: 'Hi', body: 'Original' },
          presentation: { renderer: 'email', editable: true },
          decisions: [
            { id: 'approve', outcome: 'approve', label_key: 'chat.confirmSend', style: 'primary' },
          ],
        }}
        onDecision={onDecision}
      />,
    );
    const body = screen.getByText('Original');
    body.innerText = 'Edited body';
    fireEvent.input(body);
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(onDecision).toHaveBeenCalledWith('approve', { body: 'Edited body' });
  });

  it('renders the registered calendar preview and server-provided decisions', () => {
    const onDecision = vi.fn();
    render(
      <ApprovalCard
        action={{
          action_type: 'calendar.create',
          payload: {
            subject: 'Architecture review',
            start: '2026-08-11T10:00:00',
            end: '2026-08-11T11:00:00',
            location: 'Room 3',
          },
          presentation: {
            renderer: 'calendar',
            title_key: 'chat.reviewCalendarCreate',
          },
          decisions: [
            { id: 'reject', outcome: 'reject', label_key: 'common.cancel', style: 'secondary' },
            { id: 'approve', outcome: 'approve', label_key: 'chat.confirmCreate', style: 'primary' },
          ],
        }}
        onDecision={onDecision}
      />,
    );

    expect(screen.getByText('Architecture review')).toBeInTheDocument();
    expect(screen.getByText('Room 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and create' }));
    expect(onDecision).toHaveBeenCalledWith('approve', {});
  });

  it('keeps legacy draft cards compatible', () => {
    render(
      <ApprovalCard
        action={{
          action_type: 'send_email',
          payload: { to: 'alice@example.com', subject: 'Hello', body: 'Draft body' },
        }}
        title="Draft reply"
        onConfirm={() => {}}
        confirmText="Use draft"
      />,
    );

    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use draft' })).toBeInTheDocument();
  });

  it('renders a restored completed card without decision buttons', () => {
    render(
      <ApprovalCard
        action={{
          action_type: 'calendar.create',
          status: 'completed',
          resolved: true,
          payload: { subject: 'Lunch with Professor Liu' },
          presentation: {
            renderer: 'calendar',
            completed_status_key: 'chat.approvalStatusCreated',
          },
          decisions: [
            { id: 'approve', label_key: 'chat.confirmCreate', style: 'primary' },
          ],
        }}
        onDecision={() => {}}
      />,
    );

    expect(screen.getByText('Lunch with Professor Liu')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('interpolates the assistant name into the backend-provided subtitle key', () => {
    render(
      <ApprovalCard
        action={{
          action_type: 'mail.forward',
          payload: { to: 'a@b.com', comment: 'FYI' },
          presentation: { renderer: 'email_forward', subtitle_key: 'chat.approvalRequired' },
          decisions: [{ id: 'approve', outcome: 'approve', label_key: 'chat.confirmForward', style: 'primary' }],
        }}
        assistantName="Dora"
        onDecision={() => {}}
      />,
    );
    expect(screen.getByText('Your approval is required. Dora cannot perform this action.')).toBeInTheDocument();
  });

  it('renders each batch item readably instead of dumping [object Object]', () => {
    render(
      <ApprovalCard
        action={{
          action_type: 'batch',
          payload: {
            actions: [
              { name: 'delete_email', args: { email_id: '1', subject: 'Nexus weekly digest', sender: 'a@nexus.io' } },
              { name: 'delete_email', args: { email_id: '2', subject: 'Nexus onboarding', sender: 'b@nexus.io' } },
            ],
          },
          presentation: { renderer: 'generic', title_key: 'chat.reviewDelete' },
          decisions: [{ id: 'approve', outcome: 'approve', label_key: 'chat.confirmDelete', style: 'danger' }],
        }}
        onDecision={() => {}}
      />,
    );
    expect(screen.getByText('Nexus weekly digest — a@nexus.io')).toBeInTheDocument();
    expect(screen.getByText('Nexus onboarding — b@nexus.io')).toBeInTheDocument();
    expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
  });

  it.each([
    ['failed', 'Failed'],
    ['cancelled', 'Cancelled'],
    ['expired', 'Expired'],
  ])('renders a restored %s card as terminal', (status, label) => {
    render(
      <ApprovalCard
        action={{
          action_type: 'calendar.delete',
          status,
          payload: { subject: 'Architecture review' },
          error: status === 'failed' ? 'Graph request failed' : '',
          decisions: [
            { id: 'approve', label_key: 'chat.confirmDelete', style: 'danger' },
          ],
        }}
        onDecision={() => {}}
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('approval placement', () => {
  const action = {
    placement: {
      mode: 'after_message',
      anchor_message_id: 'lc_run--persisted-message',
    },
  };

  it('uses the optimistic bot id while handling a live SSE response', () => {
    expect(resolveLiveApprovalAnchor(action, null, 'bot_optimistic')).toBe('bot_optimistic');
  });

  it('uses the LangGraph message id after history is reloaded', () => {
    expect(resolvePersistedApprovalAnchor(action, 'fallback-message')).toBe('lc_run--persisted-message');
  });

  it('does not attach composer actions to a message', () => {
    expect(resolveLiveApprovalAnchor({ placement: { mode: 'composer' } }, null, 'bot_optimistic')).toBeNull();
  });
});
