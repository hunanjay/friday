import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmailDetail } from './EmailDetail';

const MESSAGE = {
  id: 'message-1',
  subject: 'Project update',
  bodyPreview: 'A short preview',
  body: null,
  hasAttachments: false,
  receivedDateTime: '2026-08-24T10:00:00Z',
  sender: { emailAddress: { name: 'Ada', address: 'ada@example.com' } },
};

const t = key => key;

function detailProps(overrides = {}) {
  return {
    assistant: {
      avatarUrl: null,
      draft: '',
      generateReply: vi.fn(),
      instruction: 'Accept the meeting',
      isActive: true,
      isDrafting: false,
      name: 'Dora',
      selectedEmail: MESSAGE,
      setInstruction: vi.fn(),
      setIsActive: vi.fn(),
      useDraftAsReply: vi.fn(),
    },
    authToken: 'token',
    isZh: false,
    signature: 'Best regards',
    t,
    thread: {
      clearSelection: vi.fn(),
      expandedMessageIds: new Set(['message-1']),
      isLoading: false,
      messages: [MESSAGE],
      openCompose: vi.fn(),
      selectedConversationKey: 'thread-1',
      toggleExpanded: vi.fn(),
    },
    ...overrides,
  };
}

describe('EmailDetail', () => {
  it('shows an explicit detail skeleton while the thread loads', () => {
    const props = detailProps();
    props.thread = { ...props.thread, isLoading: true };
    render(<EmailDetail {...props} />);

    expect(screen.getByLabelText('Loading email details')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the empty reader when no conversation is selected', () => {
    const props = detailProps();
    props.thread = { ...props.thread, messages: [], selectedConversationKey: null };
    render(<EmailDetail {...props} />);

    expect(screen.getByText('No conversation selected')).toBeInTheDocument();
    expect(screen.getByText('email.selectEmail')).toBeInTheDocument();
  });

  it('binds thread and assistant controls to their controllers', () => {
    const props = detailProps();
    render(<EmailDetail {...props} />);

    expect(screen.getByText('Project update')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'email.reply' }));
    fireEvent.click(screen.getByRole('button', { name: 'email.replyAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'email.forward' }));
    expect(props.thread.openCompose.mock.calls.map(call => call[0])).toEqual([
      'reply',
      'replyAll',
      'forward',
    ]);

    const messageHeader = screen.getByText('Ada').closest('[role="button"]');
    fireEvent.keyDown(messageHeader, { key: 'Enter' });
    expect(props.thread.toggleExpanded).toHaveBeenCalledWith('message-1');
    fireEvent.click(screen.getByRole('button', { name: 'email.generateReply' }));
    expect(props.assistant.generateReply).toHaveBeenCalledWith('Accept the meeting');
    fireEvent.click(screen.getByRole('button', { name: 'Close email assistant' }));
    expect(props.assistant.setIsActive).toHaveBeenCalledWith(false);
  });
});
