import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import ChatMessageList from './ChatMessageList';

function renderMessages(overrides = {}) {
  const props = {
    assistantName: 'Friday',
    avatarUrl: '/avatar.png',
    endRef: createRef(),
    isLoading: false,
    isTyping: false,
    messages: [],
    onApprovalDecision: vi.fn(),
    pendingActions: [],
    ...overrides,
  };
  render(<ChatMessageList {...props} />);
  return props;
}

describe('ChatMessageList', () => {
  it('renders loading and empty states', () => {
    const { rerender } = render(<ChatMessageList
      assistantName="Friday"
      endRef={createRef()}
      isLoading
      messages={[]}
      pendingActions={[]}
    />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    rerender(<ChatMessageList
      assistantName="Friday"
      endRef={createRef()}
      isLoading={false}
      messages={[]}
      pendingActions={[]}
    />);
    expect(screen.getByText(/start of conversation/i)).toBeInTheDocument();
  });

  it('renders routed messages, tool calls, and anchored approval decisions', () => {
    const action = {
      id: 'action-1',
      anchorMessageId: 'bot-1',
      action_type: 'calendar.create',
      payload: { subject: 'Architecture review' },
      decisions: [
        { id: 'approve', outcome: 'approve', label_key: 'chat.confirmCreate', style: 'primary' },
      ],
    };
    const props = renderMessages({
      messages: [
        {
          id: 'user-1',
          sender: 'user',
          senderName: 'You',
          text: 'Schedule it',
          agent_name: 'calendar_agent',
          timestamp: '10:00',
        },
        {
          id: 'bot-1',
          sender: 'bot',
          senderName: 'Friday',
          text: 'Please review',
          timestamp: '10:01',
          toolCalls: [{ name: 'create_event', status: 'completed' }],
        },
      ],
      pendingActions: [action],
    });

    expect(screen.getByText('Calendar')).toBeInTheDocument();
    expect(screen.getByText(/create_event/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirm and create/i }));
    expect(props.onApprovalDecision).toHaveBeenCalledWith(action, 'approve', {});
  });
});
