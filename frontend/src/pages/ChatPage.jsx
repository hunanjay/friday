import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip, Plus, Trash } from '../components/common/Icons';
import StreamingMarkdown from '../components/common/StreamingMarkdown';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

export default function ChatPage() {
  const {
    messages,
    chatThreads,
    handleSendMessage,
    handleSimulateBotReply,
    handleUpdateMessageText,
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

    handleSendMessage(userMsg);

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
    handleSimulateBotReply(botMsg);
    
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
                handleUpdateMessageText(botMsgId, botText);
              } else if (data.chunk) {
                botText += data.chunk;
                handleUpdateMessageText(botMsgId, botText);
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
              handleUpdateMessageText(botMsgId, botText);
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
      handleUpdateMessageText(botMsgId, errMsg);
    } finally {
      setIsTyping(false);
    }
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
                  <div className="claude-avatar">
                    <img src="/dora_assistant_avatar.png" alt="Dora" />
                  </div>
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
