import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { isApiError } from '../api/errors';
import { useAuth } from '../features/auth/useAuth';
import {
  getChatSessionMessages,
  getPendingChatActions,
} from '../features/chat/api';
import { CHAT_AGENT_ICONS, CHAT_AGENT_IDS } from '../features/chat/agentMeta';
import { getApprovalPlacementMode } from '../features/chat/approvalPlacement';
import { byApprovalPriority } from '../features/chat/approvalState';
import { ChatApprovalAction } from '../features/chat/components/ChatApprovalAction';
import ChatComposer from '../features/chat/components/ChatComposer';
import ChatMessageList from '../features/chat/components/ChatMessageList';
import { useChatSessions } from '../features/chat/hooks';
import { useAgentChatStream } from '../features/chat/useAgentChatStream';
import { useChatApprovals } from '../features/chat/useChatApprovals';
import { useAssistantName, useAvatar } from '../features/settings/hooks';
import { useTranslation } from 'react-i18next';
import { Plus, Trash, ChevronLeft, X } from '../components/common/Icons';
import { parseAgentCommand, parseAgentPrefix } from '../utils/agentCommand';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function ChatPage() {
  const { assistantName } = useAssistantName();
  const { avatarUrl } = useAvatar();
  const { authToken, handleLogout } = useAuth();
  const {
    chatSessions: chatThreads,
    createChatSession: handleCreateSession,
    updateChatSessionTitle: handleUpdateSessionTitle,
    updateChatSessionPreview: handleUpdateSessionPreview,
    deleteChatSession: handleDeleteSession,
  } = useChatSessions();
  const {
    isStreaming: isTyping,
    startAgentStream,
    stopAgentStream,
  } = useAgentChatStream();
  const navigate = useNavigate();

  const { t, i18n } = useTranslation();
  const [activeThreadId, setActiveThreadId] = useState(null);
  const handleApprovalUnauthorized = useCallback(() => navigate('/login'), [navigate]);
  const {
    pendingActions,
    applyLiveApprovals,
    clearApprovals,
    decideApproval: handleActionDecision,
    restoreApprovals,
  } = useChatApprovals({
    sessionId: activeThreadId,
    failureMessage: t('chat.approvalFailed'),
    onPreview: handleUpdateSessionPreview,
    onUnauthorized: handleApprovalUnauthorized,
  });

  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [inputText, setInputText] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(null);
  // State updates are asynchronous; this ref closes the small window where a
  // double click can invoke handleSend twice before the button re-renders.
  const isSendingRef = useRef(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Per-thread message list, populated from the LangGraph checkpoint on
  // thread switch. New messages from the streaming response are appended here.
  const [threadMessages, setThreadMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const activeThread = chatThreads.find(s => s.id === activeThreadId) || null;

  const [contactList, setContactList] = useState([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  // Slash-command agent picker: only while the whole box is still "/query"
  // (no space typed yet) — mirrors the Slack/Notion "/" mention pattern.
  const slashMatch = inputText.match(/^\/([\w-]*)$/);
  const agents = CHAT_AGENT_IDS.map(id => ({
    id,
    Icon: CHAT_AGENT_ICONS[id],
    label: t(`chat.agents.${id}.label`),
    desc: t(`chat.agents.${id}.desc`),
    beta: id === 'github_agent',
  }));
  const filteredAgents = slashMatch
    ? agents.filter(a => {
        const q = slashMatch[1].toLowerCase().replaceAll('-', '_');
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
      fetch(`${API_URL}/api/contacts?query=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data) => {
          setContactList(Array.isArray(data) ? data : []);
        })
        .catch(() => setContactList([]))
        .finally(() => setIsLoadingContacts(false));
    }, 150);
    return () => clearTimeout(timer);
  }, [mentionQuery, showAgentMenu, authToken]);

  const selectAgent = (agent) => {
    setSelectedAgent(agent.id);
    setInputText('');
    inputRef.current?.focus();
  };

  const selectContact = (contact) => {
    const text = contact.email ? `@${contact.name} <${contact.email}> ` : `@${contact.name} `;
    setInputText((prev) => prev.replace(/@([^\s@]*)$/, text));
    setContactList([]);
    inputRef.current?.focus();
  };

  const handleInputChange = (event) => {
    const value = event.target.value;
    const prefixed = parseAgentPrefix(value);
    if (prefixed) {
      setSelectedAgent(prefixed.agentName);
      setInputText(prefixed.message);
      return;
    }
    setInputText(value);
  };

  // Fetch conversation history from the LangGraph checkpoint whenever the
  // active thread changes. This replaces localStorage as the source of truth,
  // so history survives across browsers and devices.
  useEffect(() => {
    if (!activeThreadId || !authToken) {
      setThreadMessages([]);
      clearApprovals();
      return;
    }
    let ignore = false;
    setIsLoadingMessages(true);
    Promise.all([
      getChatSessionMessages(authToken, activeThreadId),
      getPendingChatActions(authToken, activeThreadId),
    ])
      .then(([messageData, actionData]) => {
        if (ignore) return;
        const loadedMessages = (messageData.messages || []).map(m => ({ ...m, threadId: activeThreadId }));
        setThreadMessages(loadedMessages);
        handleUpdateSessionPreview(activeThreadId, messageData.preview);
        restoreApprovals(actionData.actions || [], loadedMessages);
      })
      .catch(() => {
        if (ignore) return;
        setThreadMessages([]);
        clearApprovals();
      })
      .finally(() => {
        if (!ignore) setIsLoadingMessages(false);
      });
    return () => {
      ignore = true;
    };
  }, [
    activeThreadId,
    authToken,
    clearApprovals,
    handleUpdateSessionPreview,
    restoreApprovals,
  ]);

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

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeThreadId || isSendingRef.current) return;
    isSendingRef.current = true;

    const sessionId = activeThreadId;
    const sentText = selectedAgent ? `/${selectedAgent} ${inputText}` : inputText;
    const explicitAgent = parseAgentCommand(sentText);
    setInputText('');
    setSelectedAgent(null);
    handleUpdateSessionPreview(sessionId, explicitAgent?.message || sentText);

    const userMsg = {
      id: 'msg_' + Date.now(),
      threadId: sessionId,
      sender: 'user',
      senderName: i18n.language === 'zh' ? '您' : 'You',
      text: explicitAgent?.message || sentText,
      agent_name: explicitAgent?.agentName || null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setThreadMessages(prev => [...prev, userMsg]);

    const isZh = i18n.language === 'zh';
    const botMsgId = 'msg_bot_' + Date.now();
    const botMsg = {
      id: botMsgId,
      threadId: sessionId,
      sender: 'bot',
      senderName: assistantName,
      text: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setThreadMessages(prev => [...prev, botMsg]);

    const applyStreamTransition = (effect) => {
      if (effect.message) {
        setThreadMessages(prev => prev.map(message => (
          message.id === botMsgId ? { ...message, ...effect.message } : message
        )));
      }
      if (effect.sessionTitle) handleUpdateSessionTitle(sessionId, effect.sessionTitle);
      if (effect.sessionPreview) handleUpdateSessionPreview(sessionId, effect.sessionPreview);
      if (effect.pendingActions) {
        applyLiveApprovals(effect.pendingActions, botMsgId);
      }
    };

    try {
      await startAgentStream({
        message: sentText,
        sessionId,
        token: authToken,
        onTransition: applyStreamTransition,
      });
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        handleLogout();
        navigate('/login');
      } else if (error.name === 'AbortError') {
        // User-initiated stop, not a failure - keep whatever text already streamed in.
      } else {
        console.error('Stream reading error', error);
        const errMsg = isApiError(error)
          ? isZh ? `出错了：${error.message}` : `Something went wrong: ${error.message}`
          : isZh
            ? '无法连接到助手服务，请稍后再试。'
            : "Couldn't reach the assistant service, please try again later.";
        setThreadMessages(prev => prev.map(m => m.id === botMsgId ? { ...m, text: errMsg } : m));
      }
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleStop = stopAgentStream;

  return (
    <div className={`chat-tab-container ${activeThreadId ? 'has-active-thread' : ''} ${showMobileSidebar ? 'show-mobile-sidebar' : ''}`}>
      {/* Chat Sidebar */}
      <div className="chat-sidebar">
        <div className="chat-sidebar-header">
          <h3>{t('chat.sidebarTitle')}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              className="new-session-btn"
              title={t('chat.newSession')}
              onClick={() => {
                handleNewSession();
                setShowMobileSidebar(false);
              }}
            >
              <Plus size={18} />
            </button>
            {showMobileSidebar && (
              <button
                type="button"
                className="mobile-sidebar-close-btn"
                onClick={() => setShowMobileSidebar(false)}
                title={i18n.language === 'zh' ? '关闭' : 'Close'}
              >
                <X size={18} />
              </button>
            )}
          </div>
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
                  setShowMobileSidebar(false);
                }}
              >
                <div className="thread-avatar-container">
                  <div className="claude-avatar">
                    <img src={avatarUrl || '/dora_assistant_avatar.png'} alt={assistantName} />
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
              <button
                type="button"
                className="mobile-chat-back-btn"
                onClick={() => setShowMobileSidebar(true)}
                title={i18n.language === 'zh' ? '会话列表' : 'Chats'}
              >
                <ChevronLeft size={18} />
                <span>{i18n.language === 'zh' ? '会话' : 'Chats'}</span>
              </button>
              <div className="chat-header-info">
                <h3 className="active-thread-name">{activeThread.title}</h3>
                <span className="active-thread-desc">{t('chat.aiAssistantDesc', { name: assistantName })}</span>
              </div>
              <div className="chat-header-actions">
                <span className="thread-status-badge">{t('chat.active')}</span>
              </div>
            </div>

            <ChatMessageList
              assistantName={assistantName}
              avatarUrl={avatarUrl}
              endRef={messagesEndRef}
              isLoading={isLoadingMessages}
              isTyping={isTyping}
              messages={threadMessages}
              onApprovalDecision={handleActionDecision}
              pendingActions={pendingActions}
            />

            {pendingActions
              .filter(action => getApprovalPlacementMode(action) === 'composer')
              .sort(byApprovalPriority)
              .map(action => (
                <ChatApprovalAction
                  key={action.id}
                  action={action}
                  assistantName={assistantName}
                  onDecision={handleActionDecision}
                />
              ))}

            <ChatComposer
              assistantName={assistantName}
              contacts={contactList}
              filteredAgents={filteredAgents}
              inputRef={inputRef}
              inputText={inputText}
              isLoadingContacts={isLoadingContacts}
              isTyping={isTyping}
              onClearAgent={() => setSelectedAgent(null)}
              onDismissAgents={() => setInputText('')}
              onDismissContacts={() => setContactList([])}
              onInputChange={handleInputChange}
              onSelectAgent={selectAgent}
              onSelectContact={selectContact}
              onStop={handleStop}
              onSubmit={handleSend}
              selectedAgent={selectedAgent}
              showAgentMenu={showAgentMenu}
              showContactMenu={showContactMenu}
            />
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
