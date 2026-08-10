import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../hooks/useWorkspace';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip, Plus, Trash, Mail, Calendar, Edit3, Github } from '../components/common/Icons';
import StreamingMarkdown from '../components/common/StreamingMarkdown';
import ApprovalCard from '../components/common/ApprovalCard';
import {
  getApprovalPlacementMode,
  resolveLiveApprovalAnchor,
  resolvePersistedApprovalAnchor,
} from '../components/common/approvalPlacement';

const API_URL = import.meta.env.VITE_API_URL || '';

// Mirrors the sub-agent names in backend/app/agents/supervisor.py.
const AGENT_ICONS = { mail_agent: Mail, calendar_agent: Calendar, memos_agent: Edit3, github_agent: Github };
const AGENT_IDS = Object.keys(AGENT_ICONS);

export default function ChatPage() {
  const {
    chatThreads,
    handleCreateSession,
    handleUpdateSessionTitle,
    handleUpdateSessionPreview,
    handleDeleteSession,
    handleLogout,
    authToken
  } = useWorkspace();
  const navigate = useNavigate();

  const { t, i18n } = useTranslation();

  const [activeThreadId, setActiveThreadId] = useState(null);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  // State updates are asynchronous; this ref closes the small window where a
  // double click can invoke handleSend twice before the button re-renders.
  const isSendingRef = useRef(false);
  const [agentMenuIndex, setAgentMenuIndex] = useState(0);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const activeAgentItemRef = useRef(null);
  const activeContactItemRef = useRef(null);

  // Per-thread message list, populated from the LangGraph checkpoint on
  // thread switch. New messages from the streaming response are appended here.
  const [threadMessages, setThreadMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [pendingActions, setPendingActions] = useState([]);
  const activeThread = chatThreads.find(s => s.id === activeThreadId) || null;

  const [contactList, setContactList] = useState([]);
  const [contactMenuIndex, setContactMenuIndex] = useState(0);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

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

  // Contact mention picker: triggers when user types `@` or `@query` at the end of input
  const mentionMatch = inputText.match(/@([^\s@]*)$/);
  const mentionQuery = mentionMatch?.[1] ?? null;
  const showContactMenu = Boolean(mentionMatch) && !showAgentMenu && (isLoadingContacts || contactList.length > 0);

  useEffect(() => {
    if (!mentionQuery || showAgentMenu) {
      setContactList([]);
      return;
    }
    const q = mentionQuery;
    setIsLoadingContacts(true);
    const timer = setTimeout(() => {
      fetch(`${API_URL}/api/graph/contacts?query=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          setContactList(Array.isArray(data) ? data : []);
          setContactMenuIndex(0);
        })
        .catch(() => setContactList([]))
        .finally(() => setIsLoadingContacts(false));
    }, 150);
    return () => clearTimeout(timer);
  }, [mentionQuery, showAgentMenu, authToken]);

  useEffect(() => {
    if (showAgentMenu && activeAgentItemRef.current) {
      activeAgentItemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [agentMenuIndex, showAgentMenu]);

  useEffect(() => {
    if (showContactMenu && activeContactItemRef.current) {
      activeContactItemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [contactMenuIndex, showContactMenu]);

  const selectAgent = (agent) => {
    setInputText(`/${agent.id} `);
    inputRef.current?.focus();
  };

  const selectContact = (contact) => {
    const text = contact.email ? `@${contact.name} <${contact.email}> ` : `@${contact.name} `;
    setInputText((prev) => prev.replace(/@([^\s@]*)$/, text));
    setContactList([]);
    inputRef.current?.focus();
  };

  // Fetch conversation history from the LangGraph checkpoint whenever the
  // active thread changes. This replaces localStorage as the source of truth,
  // so history survives across browsers and devices.
  useEffect(() => {
    if (!activeThreadId || !authToken) {
      setThreadMessages([]);
      setPendingActions([]);
      return;
    }
    let ignore = false;
    setIsLoadingMessages(true);
    const headers = { Authorization: `Bearer ${authToken}` };
    Promise.all([
      fetch(`${API_URL}/api/agent/sessions/${activeThreadId}/messages`, { headers })
        .then(res => (res.ok ? res.json() : { messages: [] })),
      fetch(`${API_URL}/api/agent/actions?session_id=${encodeURIComponent(activeThreadId)}`, { headers })
        .then(res => (res.ok ? res.json() : { actions: [] })),
    ])
      .then(([messageData, actionData]) => {
        if (ignore) return;
        const loadedMessages = (messageData.messages || []).map(m => ({ ...m, threadId: activeThreadId }));
        setThreadMessages(loadedMessages);
        handleUpdateSessionPreview(activeThreadId, messageData.preview);
        const lastBotMessageId = [...loadedMessages].reverse().find(message => message.sender === 'bot')?.id;
        const usedAnchorIds = new Set();
        setPendingActions((actionData.actions || []).map(action => {
          const recipient = action.payload?.to?.toLowerCase();
          let matchingMessage = null;
          if (recipient) {
            for (let index = 0; index < loadedMessages.length; index += 1) {
              const message = loadedMessages[index];
              if (message.sender !== 'user' || !message.text?.toLowerCase().includes(recipient)) continue;
              matchingMessage = loadedMessages.slice(index + 1).find(candidate => (
                candidate.sender === 'bot' && !usedAnchorIds.has(candidate.id)
              ));
              if (matchingMessage) break;
            }
          }
          if (!matchingMessage && recipient) {
            matchingMessage = loadedMessages.find(message => (
              message.sender === 'bot'
              && !usedAnchorIds.has(message.id)
              && message.text?.toLowerCase().includes(recipient)
            ));
          }
          const anchorMessageId = resolvePersistedApprovalAnchor(
            action,
            matchingMessage?.id || lastBotMessageId,
          );
          if (anchorMessageId) usedAnchorIds.add(anchorMessageId);
          return {
            ...action,
            resolved: action.status === 'completed',
            anchorMessageId,
          };
        }));
      })
      .catch(() => {
        if (ignore) return;
        setThreadMessages([]);
        setPendingActions([]);
      })
      .finally(() => {
        if (!ignore) setIsLoadingMessages(false);
      });
    return () => {
      ignore = true;
    };
  }, [activeThreadId, authToken, handleUpdateSessionPreview]);

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
  }, [threadMessages, pendingActions, isTyping]);

  const handleNewSession = async () => {
    const session = await handleCreateSession(t('chat.newSessionTitle'));
    setActiveThreadId(session.id);
  };

  const handleDelete = (e, sessionId) => {
    e.stopPropagation();
    handleDeleteSession(sessionId);
  };

  const handleUpdateMessageText = (id, newText) => {
    setThreadMessages(prev => prev.map(m => m.id === id ? { ...m, text: newText } : m));
  };

  const handleActionDecision = async (action, decision) => {
    setPendingActions(prev => prev.map(item => (
      item.id === action.id ? { ...item, busy: true, error: '' } : item
    )));
    try {
      const sessionId = action.session_id || activeThreadId;
      const res = await fetch(
        `${API_URL}/api/agent/actions/${action.id}/decisions/${decision}?session_id=${encodeURIComponent(sessionId)}`,
        {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        },
      );
      if (res.status === 401) {
        handleLogout();
        navigate('/login');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || t('chat.approvalFailed'));

      const selectedDecision = action.decisions?.find(item => item.id === decision);
      if (Array.isArray(data.pending_actions)) {
        setPendingActions(prev => {
          const existingById = new Map(prev.map(item => [item.id, item]));
          return data.pending_actions.map(item => ({
            ...item,
            resolved: item.status === 'completed',
            anchorMessageId: existingById.get(item.id)?.anchorMessageId || item.anchorMessageId || null,
          }));
        });
      } else if ((selectedDecision?.outcome || decision) === 'approve') {
        setPendingActions(prev => prev.map(item => (
          item.id === action.id
            ? { ...item, busy: false, resolved: true, status: 'completed' }
            : item
        )));
      } else {
        setPendingActions(prev => prev.filter(item => item.id !== action.id));
      }
      if (data.preview) handleUpdateSessionPreview(activeThreadId, data.preview);
    } catch (error) {
      setPendingActions(prev => prev.map(item => (
        item.id === action.id ? { ...item, busy: false, error: error.message } : item
      )));
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeThreadId || isSendingRef.current) return;
    isSendingRef.current = true;

    const sessionId = activeThreadId;
    const sentText = inputText;
    setInputText('');
    handleUpdateSessionPreview(sessionId, sentText);

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
                } else if (data.tool_call) {
                  setThreadMessages(prev => prev.map(m => {
                    if (m.id !== botMsgId) return m;
                    const existingCalls = m.toolCalls || [];
                    const incoming = data.tool_call;
                    const idx = existingCalls.findIndex(c => c.name === incoming.name && c.status === 'running');
                    let updatedCalls;
                    if (idx >= 0 && incoming.status === 'completed') {
                      updatedCalls = [...existingCalls];
                      updatedCalls[idx] = { ...updatedCalls[idx], ...incoming };
                    } else if (idx < 0) {
                      updatedCalls = [...existingCalls, incoming];
                    } else {
                      updatedCalls = existingCalls;
                    }
                    return { ...m, toolCalls: updatedCalls };
                  }));
                } else if (data.chunk) {
                  botText += data.chunk;
                  setThreadMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: botText } : m));
                } else if (data.title) {
                  handleUpdateSessionTitle(sessionId, data.title);
                } else if (data.preview) {
                  handleUpdateSessionPreview(sessionId, data.preview);
                } else if (data.pending_actions) {
                  setPendingActions(prev => {
                    const existingById = new Map(prev.map(action => [action.id, action]));
                    return data.pending_actions.map(action => ({
                      ...action,
                      resolved: action.status === 'completed',
                      anchorMessageId: resolveLiveApprovalAnchor(
                        action,
                        existingById.get(action.id)?.anchorMessageId,
                        botMsgId,
                      ),
                    }));
                  });
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
            } else if (data.preview) {
              handleUpdateSessionPreview(sessionId, data.preview);
            } else if (data.pending_actions) {
              setPendingActions(prev => {
                const existingById = new Map(prev.map(action => [action.id, action]));
                return data.pending_actions.map(action => ({
                  ...action,
                  resolved: action.status === 'completed',
                  anchorMessageId: resolveLiveApprovalAnchor(
                    action,
                    existingById.get(action.id)?.anchorMessageId,
                    botMsgId,
                  ),
                }));
              });
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
      isSendingRef.current = false;
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e) => {
    if (showContactMenu && contactList.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setContactMenuIndex((i) => (i + 1) % contactList.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setContactMenuIndex((i) => (i - 1 + contactList.length) % contactList.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectContact(contactList[contactMenuIndex] || contactList[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setContactList([]);
        return;
      }
    }

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

    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const renderApprovalAction = (action) => {
    return (
      <ApprovalCard
        key={action.id}
        action={action}
        onDecision={(decision) => handleActionDecision(action, decision)}
        onCancel={() => handleActionDecision(action, 'reject')}
        onConfirm={() => handleActionDecision(action, 'approve')}
      />
    );
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
                    {thread.preview || t('chat.noPreview')}
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
              {isLoadingMessages ? (
                <div className="chat-empty-state">
                  <p>{t('chat.loading')}</p>
                </div>
              ) : threadMessages.length === 0 && pendingActions.length === 0 ? (
                <div className="chat-empty-state">
                  <p>{t('chat.startConversation')}</p>
                </div>
            ) : (
                threadMessages.map(msg => {
                  const isUser = msg.sender === 'user';
                  const isBot = msg.sender === 'bot';

                  return (
                    <React.Fragment key={msg.id}>
                    <div className={`message-row ${isUser ? 'user-row' : 'other-row'}`}>
                      {!isUser && (
                        <div className="message-avatar">
                          {isBot ? <img src="/dora_assistant_avatar.png" alt="Dora" /> : msg.senderName[0]}
                        </div>
                      )}
                      <div className="message-bubble-wrapper">
                        {!isUser && <span className="message-sender-name">{msg.senderName}</span>}
                        <div className={`message-bubble ${isUser ? 'user-bubble' : 'other-bubble'} ${isBot ? 'bot-bubble' : ''}`}>
                          {/* Tool call status badges */}
                          {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
                            <div className="tool-calls-container" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                              {msg.toolCalls.map((call, idx) => (
                                <div
                                  key={idx}
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
                                        ({Object.entries(call.input).map(([k, v]) => `${k}="${String(v).slice(0, 30)}"`).join(', ')})
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
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
                    {pendingActions
                      .filter(action => getApprovalPlacementMode(action) === 'after_message' && action.anchorMessageId === msg.id)
                      .sort((a, b) => (b.placement?.priority || 0) - (a.placement?.priority || 0))
                      .map(renderApprovalAction)}
                    </React.Fragment>
                  );
                })
              )}

              {pendingActions
                .filter(action => {
                  const mode = getApprovalPlacementMode(action);
                  return mode === 'end' || (mode === 'after_message' && !action.anchorMessageId);
                })
                .sort((a, b) => (b.placement?.priority || 0) - (a.placement?.priority || 0))
                .map(renderApprovalAction)}

              <div ref={messagesEndRef} />
            </div>

            {pendingActions
              .filter(action => getApprovalPlacementMode(action) === 'composer')
              .sort((a, b) => (b.placement?.priority || 0) - (a.placement?.priority || 0))
              .map(renderApprovalAction)}

            <form onSubmit={handleSend} className="chat-input-area">
              {showAgentMenu && (
                <div className="agent-slash-menu">
                  <span className="agent-slash-menu-hint">{t('chat.agentMenuHint')}</span>
                  {filteredAgents.map((agent, idx) => (
                    <div
                      key={agent.id}
                      ref={idx === agentMenuIndex ? activeAgentItemRef : null}
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

              {showContactMenu && (
                <div className="agent-slash-menu contact-mention-menu">
                  <span className="agent-slash-menu-hint">{t('chat.mentionContactHint')}</span>
                  {isLoadingContacts ? (
                    <div style={{ padding: '10px 12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {i18n.language === 'zh' ? '正在查找联系人...' : 'Searching contacts...'}
                    </div>
                  ) : (
                    contactList.map((contact, idx) => (
                      <div
                        key={contact.id || idx}
                        ref={idx === contactMenuIndex ? activeContactItemRef : null}
                        className={`agent-slash-menu-item ${idx === contactMenuIndex ? 'active' : ''}`}
                        onMouseDown={(e) => { e.preventDefault(); selectContact(contact); }}
                        onMouseEnter={() => setContactMenuIndex(idx)}
                      >
                        <div className="contact-item-avatar">
                          {(contact.name?.[0] || 'C').toUpperCase()}
                        </div>
                        <div className="agent-slash-menu-item-text">
                          <span className="agent-slash-menu-item-label">{contact.name}</span>
                          <span className="agent-slash-menu-item-desc">{contact.email || contact.phone || contact.company || ''}</span>
                        </div>
                      </div>
                    ))
                  )}
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
                <button
                  type="submit"
                  className="send-msg-btn"
                  disabled={isTyping || !inputText.trim()}
                  title={t('chat.sendMessage')}
                  aria-label={t('chat.sendMessage')}
                >
                  <Send size={16} />
                </button>
              </div>
              <span className="chat-send-hint">{t('chat.sendHint')}</span>
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
