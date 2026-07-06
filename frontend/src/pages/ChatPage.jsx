import React, { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip } from '../components/common/Icons';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

export default function ChatPage() {
  const {
    messages,
    chatThreads,
    handleSendMessage,
    handleSimulateBotReply,
    authToken
  } = useWorkspace();

  const { t, i18n } = useTranslation();

  const [activeThreadId, setActiveThreadId] = useState(chatThreads[0]?.id || 'claude');
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  const activeThread = chatThreads.find(t => t.id === activeThreadId) || chatThreads[0];
  const threadMessages = messages.filter(m => m.threadId === activeThreadId);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages, isTyping]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

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
    setInputText('');

    const isZh = i18n.language === 'zh';

    if (activeThreadId === 'claude') {
      setIsTyping(true);
      fetch(`${API_URL}/api/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ message: sentText }),
      })
        .then(res => res.json().then(data => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
          const botText = ok
            ? data.reply
            : (isZh ? `出错了：${data.detail || '请求失败'}` : `Something went wrong: ${data.detail || 'request failed'}`);
          handleSimulateBotReply({
            id: 'msg_bot_' + Date.now(),
            threadId: 'claude',
            sender: 'bot',
            senderName: 'Claude AI',
            text: botText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        })
        .catch(() => {
          handleSimulateBotReply({
            id: 'msg_bot_' + Date.now(),
            threadId: 'claude',
            sender: 'bot',
            senderName: 'Claude AI',
            text: isZh ? '无法连接到助手服务，请稍后再试。' : "Couldn't reach the assistant service, please try again later.",
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        })
        .finally(() => setIsTyping(false));
    } else if (activeThreadId === 'friday') {
      setIsTyping(true);
      setTimeout(() => {
        setIsTyping(false);
        const botMsg = {
          id: 'msg_bot_' + Date.now(),
          threadId: 'friday',
          sender: 'member',
          senderName: 'Sarah (Design)',
          text: isZh
            ? `收到消息！我正在审查最终的 UI 细节。让我们在下一次例会上同步讨论这个。去“日历”标签页看看吧！`
            : `Got your message! I'm reviewing the final UI details. Let's sync about this in our next scheduled meeting. Check the Calendar tab!`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        handleSimulateBotReply(botMsg);
      }, 1800);
    }
  };

  const handleKeyDown = (e) => {
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
                  {thread.id === 'claude' ? (
                    <div className="claude-avatar">🪶</div>
                  ) : (
                    <div className="group-avatar">{thread.name[0]}</div>
                  )}
                  {thread.online && <span className="online-indicator"></span>}
                </div>
                <div className="thread-meta">
                  <div className="thread-name-row">
                    <span className="thread-name">{thread.name}</span>
                    {lastMsg && <span className="thread-time">{lastMsg.timestamp}</span>}
                  </div>
                  <p className="thread-preview">
                    {lastMsg ? `${lastMsg.senderName}: ${lastMsg.text}` : (i18n.language === 'zh' ? '暂无消息' : 'No messages yet')}
                  </p>
                </div>
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
                <h3 className="active-thread-name">{activeThread.name}</h3>
                <span className="active-thread-desc">
                  {i18n.language === 'zh' && activeThread.id === 'claude' ? "模拟 AI 助手" : 
                   i18n.language === 'zh' && activeThread.id === 'friday' ? "团队讨论频道" : 
                   i18n.language === 'zh' && activeThread.id === 'lounge' ? "闲聊灌水" : 
                   activeThread.description}
                </span>
              </div>
              <div className="chat-header-actions">
                <span className="thread-status-badge">
                  {activeThread.online ? t('chat.active') : t('chat.offline')}
                </span>
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
                  placeholder={activeThreadId === 'claude' ? t('chat.inputPlaceholderAI') : t('chat.inputPlaceholderGroup')}
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
            <p>{t('common.selectChat')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
