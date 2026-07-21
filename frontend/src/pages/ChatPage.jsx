import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip, Plus, Trash, Mail, Calendar, Edit3, Github } from '../components/common/Icons';
import StreamingMarkdown from '../components/common/StreamingMarkdown';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

// Mirrors the sub-agent names in backend/app/agents/supervisor.py.
const AGENT_ICONS = { mail_agent: Mail, calendar_agent: Calendar, memos_agent: Edit3, github_agent: Github };
const AGENT_IDS = Object.keys(AGENT_ICONS);

export default function ChatPage() {
  const {
    chatThreads,
    handleCreateSession,
    handleUpdateSessionTitle,
    handleDeleteSession,
    handleLogout,
    authToken
  } = useWorkspace();
  const navigate = useNavigate();

  const { t, i18n } = useTranslation();

  const [activeThreadId, setActiveThreadId] = useState(null);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [agentMenuIndex, setAgentMenuIndex] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Per-thread message list, populated from the LangGraph checkpoint on
  // thread switch. New messages from the streaming response are appended here.
  const [threadMessages, setThreadMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const activeThread = chatThreads.find(s => s.id === activeThreadId) || null;

  // Slash-command agent picker: only while the whole box is still "/query"
  // (no space typed yet) — mirrors the Slack/Notion "/" mention pattern.
  const slashMatch = inputText.match(/^\/(\w*)$/);
  const agents = AGENT_IDS.map(id => ({
    id,
    Icon: AGENT_ICONS[id],
    label: t(`chat.agents.${id}.label`),
    desc: t(`chat.agents.${id}.desc`),
  }));
  const filteredAgents = slashMatch
    ? agents.filter(a => {
        const q = slashMatch[1].toLowerCase();
        return a.id.includes(q) || a.label.toLowerCase().includes(q);
      })
    : [];
  const showAgentMenu = filteredAgents.length > 0;

  useEffect(() => {
    setAgentMenuIndex(0);
  }, [inputText]);

  const selectAgent = (agent) => {
    setInputText(`/${agent.id} `);
    inputRef.current?.focus();
  };

  // Fetch conversation history from the LangGraph checkpoint whenever the
  // active thread changes. This replaces localStorage as the source of truth,
  // so history survives across browsers and devices.
  useEffect(() => {
    if (!activeThreadId || !authToken) {
      setThreadMessages([]);
      return;
    }
    setIsLoadingMessages(true);
    fetch(`${API_URL}/api/agent/sessions/${activeThreadId}/messages`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { messages: [] }))
      .then(data => setThreadMessages(
        (data.messages || []).map(m => ({ ...m, threadId: activeThreadId }))
      ))
      .catch(() => {})
      .finally(() => setIsLoadingMessages(false));
  }, [activeThreadId, authToken]);

  // Sessions load asynchronously after login; pick the most recent one once
  // they arrive (or if the active one got deleted from under us).
  useEffect(() => {
    if (chatThreads.length === 0) {
      setActiveThreadId(null);
    } else if (!chatThreads.some(s => s.id === activeThreadId)) {
      setActiveThreadId(chatThreads[0].id);
    }
  }, [chatThreads, activeThreadId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages, isTyping]);

  const handleNewSession = async () => {
    const session = await handleCreateSession(t('chat.newSessionTitle'));
    setActiveThreadId(session.id);
  };

  const handleDelete = (e, sessionId) => {
    e.stopPropagation();
    handleDeleteSession(sessionId);
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeThreadId) return;

    const sessionId = activeThreadId;
    const sentText = inputText;
    setInputText('');

    const userMsg = {
      id: 'msg_' + Date.now(),
      threadId: sessionId,
      sender: 'user',
      senderName: i18n.language === 'zh' ? '您' : 'You',
      text: sentText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setThreadMessages(prev => [...prev, userMsg]);

    const isZh = i18n.language === 'zh';
    const botMsgId = 'msg_bot_' + Date.now();
    const botMsg = {
      id: botMsgId,
      threadId: sessionId,
      sender: 'bot',
      senderName: 'Dora',
      text: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setThreadMessages(prev => [...prev, botMsg]);
    
    setIsTyping(true);

    try {
      const res = await fetch(`${API_URL}/api/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ message: sentText, session_id: sessionId }),
      });

      if (res.status === 401) {
        handleLogout();
        navigate('/login');
        return;
      }

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = isZh
          ? `出错了：${errorData.detail || '请求失败'}`
          : `Something went wrong: ${errorData.detail || 'request failed'}`;
        handleUpdateMessageText(botMsgId, errorMsg);
        setIsTyping(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let botText = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6).trim();
            if (dataStr === '[DONE]') {
              break;
            }
            try {
              const data = JSON.parse(dataStr);
              if (data.error) {
                  botText += `\n[Error: ${data.error}]`;
                  setThreadMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: botText } : m));
                } else if (data.chunk) {
                  botText += data.chunk;
                  setThreadMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: botText } : m));
                } else if (data.title) {
                  handleUpdateSessionTitle(sessionId, data.title);
                }
            } catch (err) {
              console.error('Failed to parse SSE data', err);
            }
          }
        }
      }

      // Flush final buffer if any
      if (buffer.startsWith('data: ')) {
        const dataStr = buffer.slice(6).trim();
        if (dataStr !== '[DONE]') {
          try {
            const data = JSON.parse(dataStr);
            if (data.chunk) {
              botText += data.chunk;
              setThreadMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: botText } : m));
            } else if (data.title) {
              handleUpdateSessionTitle(sessionId, data.title);
            }
          } catch (err) {
            console.error('Failed to parse final SSE data', err);
          }
        }
      }

    } catch (error) {
      console.error('Stream reading error', error);
      const errMsg = isZh
        ? '无法连接到助手服务，请稍后再试。'
        : "Couldn't reach the assistant service, please try again later.";
      setThreadMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: errMsg } : m));
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e) => {
    if (showAgentMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAgentMenuIndex(i => (i + 1) % filteredAgents.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAgentMenuIndex(i => (i - 1 + filteredAgents.length) % filteredAgents.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectAgent(filteredAgents[agentMenuIndex] || filteredAgents[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setInputText('');
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  return (
    <div className="chat-tab-container">
      {/* Chat Sidebar */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <h3>{t('chat.sidebarTitle')}</h3>
          <button type="button" className="new-session-btn" title={t('chat.newSession')} onClick={handleNewSession}>
            <Plus size={18} />
          </button>
        </div>

        <div className="chat-threads-list">
          {chatThreads.map(thread => {

            const isSelected = thread.id === activeThreadId;

            return (
              <div
                key={thread.id}
                className={`chat-thread-item ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  setActiveThreadId(thread.id);
                }}
              >
                <div className="thread-avatar-container">
                  <div className="claude-avatar">
                    <img src="/dora_assistant_avatar.png" alt="Dora" />
                  </div>
                </div>
                <div className="thread-meta">
                  <div className="thread-name-row">
                    <span className="thread-name">{thread.title}</span>
                  </div>
                  <p className="thread-preview">
                    {i18n.language === 'zh' ? '暂无消息预览' : 'No preview available'}
                  </p>
                </div>
                <button
                  type="button"
                  className="delete-session-btn"
                  title={t('chat.deleteSession')}
                  onClick={(e) => handleDelete(e, thread.id)}
                >
                  <Trash size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Chat Panel */}
      <div className="chat-main-panel">
        {activeThread ? (
          <>
            <div className="chat-header">
              <div className="chat-header-info">
                <h3 className="active-thread-name">{activeThread.title}</h3>
                <span className="active-thread-desc">{t('chat.aiAssistantDesc')}</span>
              </div>
              <div className="chat-header-actions">
                <span className="thread-status-badge">{t('chat.active')}</span>
              </div>
            </div>

            <div className="chat-messages-area">
              {threadMessages.length === 0 ? (
                <div className="chat-empty-state">
                  <p>{t('chat.startConversation')}</p>
                </div>
              ) : (
                threadMessages.map(msg => {
                  const isUser = msg.sender === 'user';
                  const isBot = msg.sender === 'bot';

                  return (
                    <div key={msg.id} className={`message-row ${isUser ? 'user-row' : 'other-row'}`}>
                      {!isUser && (
                        <div className="message-avatar">
                          {isBot ? <img src="/dora_assistant_avatar.png" alt="Dora" /> : msg.senderName[0]}
                        </div>
                      )}
                      <div className="message-bubble-wrapper">
                        {!isUser && <span className="message-sender-name">{msg.senderName}</span>}
                        <div className={`message-bubble ${isUser ? 'user-bubble' : 'other-bubble'} ${isBot ? 'bot-bubble' : ''}`}>
                          {isUser ? (
                            <p className="markdown-p">{msg.text}</p>
                          ) : (
                            <StreamingMarkdown
                              content={msg.text}
                              isBotTyping={isTyping && msg.id === threadMessages[threadMessages.length - 1]?.id}
                            />
                          )}
                        </div>
                        <span className="message-time">{msg.timestamp}</span>
                      </div>
                    </div>
                  );
                })
              )}

              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="chat-input-area">
              {showAgentMenu && (
                <div className="agent-slash-menu">
                  <span className="agent-slash-menu-hint">{t('chat.agentMenuHint')}</span>
                  {filteredAgents.map((agent, idx) => (
                    <div
                      key={agent.id}
                      className={`agent-slash-menu-item ${idx === agentMenuIndex ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); selectAgent(agent); }}
                      onMouseEnter={() => setAgentMenuIndex(idx)}
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
              <div className="chat-input-wrapper">
                <button type="button" className="attachment-btn" title="Attach file" onClick={() => alert(t('chat.attachmentsSimulated'))}>
                  <Paperclip size={18} />
                </button>
                <textarea
                  ref={inputRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('chat.inputPlaceholderAI')}
                  rows="1"
                />
                <button type="submit" className="send-msg-btn" disabled={!inputText.trim()}>
                  <Send size={16} />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="chat-empty-panel">
            <h3>{t('common.noActiveChat')}</h3>
            <p>{chatThreads.length === 0 ? t('chat.newSession') : t('common.selectChat')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
