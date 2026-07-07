import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip, Plus, Trash } from '../components/common/Icons';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

export default function ChatPage() {
  const {
    messages,
    chatThreads,
    handleSendMessage,
    handleSimulateBotReply,
    handleCreateSession,
    handleDeleteSession,
    handleLogout,
    authToken
  } = useWorkspace();
  const navigate = useNavigate();

  const { t, i18n } = useTranslation();

  const [activeThreadId, setActiveThreadId] = useState(null);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const activeThread = chatThreads.find(s => s.id === activeThreadId) || null;
  const threadMessages = messages.filter(m => m.threadId === activeThreadId);

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

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim() || !activeThreadId) return;

    const userMsg = {
      id: 'msg_' + Date.now(),
      threadId: activeThreadId,
      sender: 'user',
      senderName: i18n.language === 'zh' ? '您' : 'You',
      text: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    handleSendMessage(userMsg);
    const sentText = inputText;
    const sessionId = activeThreadId;
    setInputText('');

    const isZh = i18n.language === 'zh';

    setIsTyping(true);
    fetch(`${API_URL}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ message: sentText, session_id: sessionId }),
    })
      .then(res => res.json().then(data => ({ ok: res.ok, status: res.status, data })))
      .then(({ ok, status, data }) => {
        if (status === 401) {
          handleLogout();
          navigate('/login');
          return;
        }
        const botText = ok
          ? data.reply
          : (isZh ? `出错了：${data.detail || '请求失败'}` : `Something went wrong: ${data.detail || 'request failed'}`);
        handleSimulateBotReply({
          id: 'msg_bot_' + Date.now(),
          threadId: sessionId,
          sender: 'bot',
          senderName: 'Claude AI',
          text: botText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      })
      .catch(() => {
        handleSimulateBotReply({
          id: 'msg_bot_' + Date.now(),
          threadId: sessionId,
          sender: 'bot',
          senderName: 'Claude AI',
          text: isZh ? '无法连接到助手服务，请稍后再试。' : "Couldn't reach the assistant service, please try again later.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
      })
      .finally(() => setIsTyping(false));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.shiftKey) {
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
            const lastMsg = messages.filter(m => m.threadId === thread.id).slice(-1)[0];
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
                  <div className="claude-avatar">🪶</div>
                </div>
                <div className="thread-meta">
                  <div className="thread-name-row">
                    <span className="thread-name">{thread.title}</span>
                    {lastMsg && <span className="thread-time">{lastMsg.timestamp}</span>}
                  </div>
                  <p className="thread-preview">
                    {lastMsg ? `${lastMsg.senderName}: ${lastMsg.text}` : (i18n.language === 'zh' ? '暂无消息' : 'No messages yet')}
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
                          {isBot ? '🪶' : msg.senderName[0]}
                        </div>
                      )}
                      <div className="message-bubble-wrapper">
                        {!isUser && <span className="message-sender-name">{msg.senderName}</span>}
                        <div className={`message-bubble ${isUser ? 'user-bubble' : 'other-bubble'} ${isBot ? 'bot-bubble' : ''}`}>
                          <p>{msg.text}</p>
                        </div>
                        <span className="message-time">{msg.timestamp}</span>
                      </div>
                    </div>
                  );
                })
              )}

              {isTyping && (
                <div className="message-row other-row">
                  <div className="message-avatar">🪶</div>
                  <div className="message-bubble-wrapper">
                    <span className="message-sender-name">Claude AI</span>
                    <div className="message-bubble other-bubble bot-bubble typing-bubble">
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSend} className="chat-input-area">
              <div className="chat-input-wrapper">
                <button type="button" className="attachment-btn" title="Attach file" onClick={() => alert(t('chat.attachmentsSimulated'))}>
                  <Paperclip size={18} />
                </button>
                <textarea
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
