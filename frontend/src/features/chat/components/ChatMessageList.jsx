import React from 'react';
import { useTranslation } from 'react-i18next';
import StreamingMarkdown from '../../../components/common/StreamingMarkdown';
import { CHAT_AGENT_ICONS } from '../agentMeta';
import { getApprovalPlacementMode } from '../approvalPlacement';
import { byApprovalPriority } from '../approvalState';
import { ChatApprovalAction } from './ChatApprovalAction';

function ToolCallList({ toolCalls }) {
  if (!toolCalls?.length) return null;
  return (
    <div className="tool-calls-container" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      {toolCalls.map((call, index) => (
        <div
          key={`${call.name}-${index}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: '0.78rem',
            background: 'rgba(99, 102, 241, 0.08)',
            border: '1px solid rgba(99, 102, 241, 0.2)',
            color: '#6366f1',
            fontWeight: 500,
          }}
        >
          {call.status === 'running' ? (
            <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />
          ) : (
            <span>⚡</span>
          )}
          <span>
            {call.status === 'running' ? '正在调用工具: ' : '已调用工具: '}
            <strong style={{ fontFamily: 'monospace' }}>{call.name}</strong>
            {call.input && typeof call.input === 'object' && Object.keys(call.input).length > 0 && (
              <span style={{ opacity: 0.8, marginLeft: 4 }}>
                ({Object.entries(call.input).map(([key, value]) => (
                  `${key}="${String(value).slice(0, 30)}"`
                )).join(', ')})
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function MessageRow({ assistantName, avatarUrl, isTyping, message, isLastMessage }) {
  const { t } = useTranslation();
  const isUser = message.sender === 'user';
  const isBot = message.sender === 'bot';
  const RoutedAgentIcon = isUser && message.agent_name
    ? CHAT_AGENT_ICONS[message.agent_name]
    : null;

  return (
    <div className={`message-row ${isUser ? 'user-row' : 'other-row'}`}>
      {!isUser && (
        <div className="message-avatar">
          {isBot
            ? <img src={avatarUrl || '/dora_assistant_avatar.png'} alt={assistantName} />
            : message.senderName?.[0]}
        </div>
      )}
      <div className="message-bubble-wrapper">
        {!isUser && <span className="message-sender-name">{message.senderName}</span>}
        <div className={`message-bubble ${isUser ? 'user-bubble' : 'other-bubble'} ${isBot ? 'bot-bubble' : ''}`}>
          {!isUser && <ToolCallList toolCalls={message.toolCalls} />}
          {isUser ? (
            <>
              {RoutedAgentIcon && (
                <span className="message-agent-chip">
                  <RoutedAgentIcon size={13} />
                  {t(`chat.agents.${message.agent_name}.label`)}
                </span>
              )}
              <StreamingMarkdown content={message.text} isBotTyping={false} />
            </>
          ) : (
            <StreamingMarkdown content={message.text} isBotTyping={isTyping && isLastMessage} />
          )}
        </div>
        <span className="message-time">{message.timestamp}</span>
      </div>
    </div>
  );
}

function ApprovalActions({ actions, assistantName, onDecision }) {
  return actions
    .sort(byApprovalPriority)
    .map(action => (
      <ChatApprovalAction
        key={action.id}
        action={action}
        assistantName={assistantName}
        onDecision={onDecision}
      />
    ));
}

export default function ChatMessageList({
  assistantName,
  avatarUrl,
  endRef,
  isLoading,
  isTyping,
  messages,
  onApprovalDecision,
  pendingActions,
}) {
  const { t } = useTranslation();
  const unanchoredActions = pendingActions.filter(action => {
    const mode = getApprovalPlacementMode(action);
    return mode === 'end' || (mode === 'after_message' && !action.anchorMessageId);
  });

  return (
    <div className="chat-messages-area">
      {isLoading ? (
        <div className="chat-empty-state"><p>{t('chat.loading')}</p></div>
      ) : messages.length === 0 && pendingActions.length === 0 ? (
        <div className="chat-empty-state"><p>{t('chat.startConversation')}</p></div>
      ) : (
        messages.map((message, index) => (
          <React.Fragment key={message.id}>
            <MessageRow
              assistantName={assistantName}
              avatarUrl={avatarUrl}
              isTyping={isTyping}
              isLastMessage={index === messages.length - 1}
              message={message}
            />
            <ApprovalActions
              actions={pendingActions.filter(action => (
                getApprovalPlacementMode(action) === 'after_message'
                && action.anchorMessageId === message.id
              ))}
              assistantName={assistantName}
              onDecision={onApprovalDecision}
            />
          </React.Fragment>
        ))
      )}
      <ApprovalActions
        actions={unanchoredActions}
        assistantName={assistantName}
        onDecision={onApprovalDecision}
      />
      <div ref={endRef} />
    </div>
  );
}
