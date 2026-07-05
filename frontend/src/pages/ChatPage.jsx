import React, { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Send, Paperclip } from '../components/common/Icons';

export default function ChatPage() {
  const {
    messages,
    chatThreads,
    handleSendMessage,
    handleSimulateBotReply
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
      setTimeout(() => {
        setIsTyping(false);
        
        let botText = isZh 
          ? "我很乐意为您提供帮助！我看到这个工作空间有几个标签页。尝试在“邮件”标签页中撰写电子邮件，在“日历”中安排日程，或在“便签”中记录想法。如有需要，请随时告诉我！"
          : "I'm here to help! I can see we have several tabs in this workspace. Try composing an email in the Email tab, scheduling an event in the Calendar, or jotting down ideas in the Memos tab. Let me know if you need any assistance!";
        
        const lowerText = sentText.toLowerCase();
        if (lowerText.includes('email') || lowerText.includes('邮件')) {
          botText = isZh
            ? "您可以在“邮件”标签页管理您的邮件！事实上，我在那里给您发了一封欢迎邮件。您可以回复它、删除它，或者点击“写信”来草拟一封新邮件。"
            : "You can manage your emails under the Email tab! In fact, I sent you a welcome email there. You can reply to it, delete it, or click 'Compose' to draft a new one.";
        } else if (lowerText.includes('calendar') || lowerText.includes('日程') || lowerText.includes('会议')) {
          botText = isZh
            ? "“日历”标签页采用月度布局！点击任意网格单元格即可创建日程，选择颜色分类（工作、个人、紧急、学习）并查看详细信息。试着为今天安排点事情吧！"
            : "The Calendar tab features a monthly layout! Click on any grid cell to create an event, choose color categories (Work, Personal, Urgent, Study), and view details. Try scheduling something for today!";
        } else if (lowerText.includes('memo') || lowerText.includes('note') || lowerText.includes('便签') || lowerText.includes('笔记')) {
          botText = isZh
            ? "“便签”标签页让您可以写下即时贴。您可以搜索它们、标记它们、将它们置顶，并分配不同的淡雅背景颜色。快来试试吧！"
            : "The Memos tab lets you write down sticky notes. You can search them, tag them, pin them to the top, and assign different pastel background colors. Give it a try!";
        } else if (lowerText.includes('hello') || lowerText.includes('hi') || lowerText.includes('你好')) {
          botText = isZh
            ? "你好！欢迎来到您的工作空间。今天过得怎么样？如果有任何关于邮件、日历或便签的问题，随时告诉我。"
            : "Hello! Welcome to your workspace. How is your day going? Let me know how I can assist you with your emails, calendar, or notes.";
        } else if (lowerText.includes('claude') || lowerText.includes('who are you') || lowerText.includes('你是谁')) {
          botText = isZh
            ? "我是 Claude，您在这个精美仪表板中的模拟 AI 伴侣。我完全采用了 Claude 标志性的陶土色调和极简布局，给您带来舒适且高端的体验。"
            : "I am Claude, your simulated AI companion in this beautiful dashboard. I am fully styled with Claude's signature terracotta colors and minimalist layout to feel comfortable and premium.";
        } else if (lowerText.includes('clear') || lowerText.includes('reset')) {
          botText = isZh
            ? "我已经记录下了。如果您想清空本地工作区设置，请随时登出并重新登录！"
            : "I've logged this. If you want to clear your local workspace settings, feel free to sign out and log back in!";
        }

        const botMsg = {
          id: 'msg_bot_' + Date.now(),
          threadId: 'claude',
          sender: 'bot',
          senderName: 'Claude AI',
          text: botText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        handleSimulateBotReply(botMsg);
      }, 1500);
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
