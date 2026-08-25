import React, { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { CHAT_AGENT_ICONS } from '../agentMeta';
import ChatComposer from './ChatComposer';

const agents = [
  { id: 'mail_agent', Icon: CHAT_AGENT_ICONS.mail_agent, label: 'Mail', desc: 'Mail tasks' },
  { id: 'calendar_agent', Icon: CHAT_AGENT_ICONS.calendar_agent, label: 'Calendar', desc: 'Calendar tasks' },
];

function renderComposer(overrides = {}) {
  const props = {
    assistantName: 'Friday',
    contacts: [],
    filteredAgents: [],
    inputRef: createRef(),
    inputText: 'hello',
    isLoadingContacts: false,
    isTyping: false,
    onClearAgent: vi.fn(),
    onDismissAgents: vi.fn(),
    onDismissContacts: vi.fn(),
    onInputChange: vi.fn(),
    onSelectAgent: vi.fn(),
    onSelectContact: vi.fn(),
    onStop: vi.fn(),
    onSubmit: vi.fn(event => event.preventDefault()),
    selectedAgent: null,
    showAgentMenu: false,
    showContactMenu: false,
    ...overrides,
  };
  render(<ChatComposer {...props} />);
  return props;
}

describe('ChatComposer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('supports keyboard navigation in the agent menu', () => {
    const props = renderComposer({ filteredAgents: agents, showAgentMenu: true });
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSelectAgent).toHaveBeenCalledWith(agents[1]);
  });

  it('selects and dismisses contact mentions from the keyboard', () => {
    const contact = { id: 'contact-1', name: 'Alice', email: 'alice@example.com' };
    const props = renderComposer({ contacts: [contact], showContactMenu: true });
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSelectContact).toHaveBeenCalledWith(contact);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onDismissContacts).toHaveBeenCalledOnce();
  });

  it('submits with the platform shortcut and exposes stream stop', () => {
    const props = renderComposer({ isTyping: true });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /stop generating/i }));

    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(props.onStop).toHaveBeenCalledOnce();
  });
});
