import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, StopIcon } from '../../../components/common/Icons';
import { CHAT_AGENT_ICONS } from '../agentMeta';

export default function ChatComposer({
  assistantName,
  contacts,
  filteredAgents,
  inputRef,
  inputText,
  isLoadingContacts,
  isTyping,
  onClearAgent,
  onDismissAgents,
  onDismissContacts,
  onInputChange,
  onSelectAgent,
  onSelectContact,
  onStop,
  onSubmit,
  selectedAgent,
  showAgentMenu,
  showContactMenu,
}) {
  const { t, i18n } = useTranslation();
  const [agentMenuIndex, setAgentMenuIndex] = useState(0);
  const [contactMenuIndex, setContactMenuIndex] = useState(0);
  const activeAgentItemRef = useRef(null);
  const activeContactItemRef = useRef(null);

  useEffect(() => setAgentMenuIndex(0), [filteredAgents]);
  useEffect(() => setContactMenuIndex(0), [contacts]);

  useEffect(() => {
    activeAgentItemRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [agentMenuIndex]);

  useEffect(() => {
    activeContactItemRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [contactMenuIndex]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [inputRef, inputText]);

  const handleKeyDown = (event) => {
    if (showContactMenu && contacts.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setContactMenuIndex(index => (index + 1) % contacts.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setContactMenuIndex(index => (index - 1 + contacts.length) % contacts.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        onSelectContact(contacts[contactMenuIndex] || contacts[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismissContacts();
        return;
      }
    }

    if (showAgentMenu && filteredAgents.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setAgentMenuIndex(index => (index + 1) % filteredAgents.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setAgentMenuIndex(index => (index - 1 + filteredAgents.length) % filteredAgents.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        onSelectAgent(filteredAgents[agentMenuIndex] || filteredAgents[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismissAgents();
        return;
      }
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit(event);
    }
  };

  const SelectedAgentIcon = selectedAgent ? CHAT_AGENT_ICONS[selectedAgent] : null;

  return (
    <form onSubmit={onSubmit} className="chat-input-area">
      {showAgentMenu && (
        <div className="agent-slash-menu">
          <span className="agent-slash-menu-hint">{t('chat.agentMenuHint')}</span>
          {filteredAgents.map((agent, index) => (
            <div
              key={agent.id}
              ref={index === agentMenuIndex ? activeAgentItemRef : null}
              className={`agent-slash-menu-item ${index === agentMenuIndex ? 'active' : ''}`}
              onMouseDown={(event) => { event.preventDefault(); onSelectAgent(agent); }}
              onMouseEnter={() => setAgentMenuIndex(index)}
            >
              <agent.Icon size={16} />
              <div className="agent-slash-menu-item-text">
                <span className="agent-slash-menu-item-label">{agent.label}</span>
                <span className="agent-slash-menu-item-desc">{agent.desc}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {showContactMenu && (
        <div className="agent-slash-menu contact-mention-menu">
          <span className="agent-slash-menu-hint">{t('chat.mentionContactHint')}</span>
          {isLoadingContacts ? (
            <div style={{ padding: '10px 12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {i18n.language === 'zh' ? '正在查找联系人...' : 'Searching contacts...'}
            </div>
          ) : (
            contacts.map((contact, index) => (
              <div
                key={contact.id || index}
                ref={index === contactMenuIndex ? activeContactItemRef : null}
                className={`agent-slash-menu-item ${index === contactMenuIndex ? 'active' : ''}`}
                onMouseDown={(event) => { event.preventDefault(); onSelectContact(contact); }}
                onMouseEnter={() => setContactMenuIndex(index)}
              >
                <div className="contact-item-avatar">
                  {(contact.name?.[0] || 'C').toUpperCase()}
                </div>
                <div className="agent-slash-menu-item-text">
                  <span className="agent-slash-menu-item-label">{contact.name}</span>
                  <span className="agent-slash-menu-item-desc">
                    {contact.email || contact.phone || contact.company || ''}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <div className="chat-input-wrapper">
        {selectedAgent && SelectedAgentIcon && (
          <span className="composer-agent-chip">
            <SelectedAgentIcon size={14} />
            {t(`chat.agents.${selectedAgent}.label`)}
            <button
              type="button"
              className="composer-agent-chip-remove"
              aria-label={i18n.language === 'zh' ? '移除 Agent' : 'Remove agent'}
              onClick={onClearAgent}
            >
              ×
            </button>
          </span>
        )}
        <textarea
          ref={inputRef}
          value={inputText}
          onChange={onInputChange}
          onKeyDown={handleKeyDown}
          placeholder={t('chat.inputPlaceholderAI', { name: assistantName })}
          rows="1"
        />
        {isTyping ? (
          <button
            type="button"
            className="send-msg-btn"
            onClick={onStop}
            title={t('chat.stopGenerating')}
            aria-label={t('chat.stopGenerating')}
          >
            <StopIcon size={16} />
          </button>
        ) : (
          <button
            type="submit"
            className="send-msg-btn"
            disabled={!inputText.trim()}
            title={t('chat.sendMessage')}
            aria-label={t('chat.sendMessage')}
          >
            <Send size={16} />
          </button>
        )}
      </div>
      <span className="chat-send-hint">{t('chat.sendHint')}</span>
    </form>
  );
}
