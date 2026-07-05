import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Mail, Send, Trash, Search, Plus, X, Sparkles } from '../components/common/Icons';
import EmailContentRenderer from '../components/common/EmailContentRenderer';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

export default function EmailPage() {
  const {
    emails,
    handleAddEmail,
    handleDeleteEmail,
    showToast,
    authToken,
    setIsSyncingInbox,
    handleSyncInboxEmails
  } = useWorkspace();

  const { t, i18n } = useTranslation();

  const [activeFolder, setActiveFolder] = useState('inbox');
  const [selectedEmailId, setSelectedEmailId] = useState(emails.length > 0 ? emails[0].id : null);
  const [searchQuery, setSearchQuery] = useState('');

  // Sync Inbox. Gated on presence (hasAuthToken), not the token's exact
  // value, so periodic Supabase token refreshes don't re-trigger a refetch.
  const hasAuthToken = Boolean(authToken);
  useEffect(() => {
    if (!authToken) return;
    setIsSyncingInbox(true);
    fetch(`${API_URL}/api/graph/mail/inbox`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => res.json())
      .then(data => {
        const inboxEmails = (data.value || []).map(msg => ({
          id: msg.id,
          subject: msg.subject,
          bodyPreview: msg.bodyPreview,
          body: msg.body,
          sender: msg.sender,
          toRecipients: msg.toRecipients,
          receivedDateTime: msg.receivedDateTime,
          isRead: msg.isRead,
          parentFolderId: 'inbox',
        }));
        handleSyncInboxEmails(inboxEmails);
      })
      .catch(() => showToast(t('email.syncFailed')))
      .finally(() => setIsSyncingInbox(false));
  }, [hasAuthToken, t, showToast, setIsSyncingInbox, handleSyncInboxEmails]);

  // Compose modal states
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');

  // Dora AI Assistant states
  const [isDoraActive, setIsDoraActive] = useState(true);
  const [aiDraft, setAiDraft] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [doraTab, setDoraTab] = useState('reply'); // 'reply' or 'summary'

  // Outlook Graph API Date Format Helpers
  const formatEmailTime = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatEmailDateFull = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Clear AI draft when selecting a new email
  useEffect(() => {
    setAiDraft('');
    setAiInstruction('');
  }, [selectedEmailId]);

  // Filter emails by folder
  const folderEmails = emails.filter(email => {
    if (activeFolder === 'inbox') return email.parentFolderId === 'inbox';
    if (activeFolder === 'sent') return email.parentFolderId === 'sent';
    if (activeFolder === 'trash') return email.parentFolderId === 'trash';
    return true;
  });

  // Filter emails by search query
  const filteredEmails = folderEmails.filter(email => {
    const query = searchQuery.toLowerCase();
    const senderName = email.sender?.emailAddress?.name || '';
    const subject = email.subject || '';
    const bodyContent = email.body?.content || '';
    return (
      senderName.toLowerCase().includes(query) ||
      subject.toLowerCase().includes(query) ||
      bodyContent.toLowerCase().includes(query)
    );
  });

  const selectedEmail = emails.find(e => e.id === selectedEmailId);

  const handleComposeSubmit = (e) => {
    e.preventDefault();
    if (!composeTo || !composeSubject || !composeBody) {
      alert('Please fill out all fields');
      return;
    }

    const newEmail = {
      id: 'email_' + Date.now(),
      subject: composeSubject,
      bodyPreview: composeBody.substring(0, 120) + (composeBody.length > 120 ? '...' : ''),
      body: {
        content: composeBody,
        contentType: 'text'
      },
      sender: {
        emailAddress: {
          name: 'You',
          address: 'user@workspace.com'
        }
      },
      toRecipients: [
        {
          emailAddress: {
            name: composeTo.split('@')[0],
            address: composeTo
          }
        }
      ],
      receivedDateTime: new Date().toISOString(),
      isRead: true,
      parentFolderId: 'sent'
    };

    handleAddEmail(newEmail);
    setIsComposing(false);
    setComposeTo('');
    setComposeSubject('');
    setComposeBody('');
    showToast(t('email.sentSuccess'));
  };

  const handleReply = () => {
    if (!selectedEmail) return;
    const senderAddress = selectedEmail.sender?.emailAddress?.address || selectedEmail.sender?.emailAddress?.name || '';
    const senderName = selectedEmail.sender?.emailAddress?.name || 'Sender';
    const emailTime = formatEmailTime(selectedEmail.receivedDateTime);
    const emailDate = formatEmailDateFull(selectedEmail.receivedDateTime);
    const bodyContent = selectedEmail.body?.content || '';

    setComposeTo(senderAddress);
    setComposeSubject(`Re: ${selectedEmail.subject}`);
    setComposeBody(`\n\n--- On ${emailDate} at ${emailTime}, ${senderName} wrote:\n> ${bodyContent.split('\n').join('\n> ')}`);
    setIsComposing(true);
  };

  const handleDelete = (id) => {
    handleDeleteEmail(id);
    showToast(t('email.movedToTrash'));
    const index = filteredEmails.findIndex(e => e.id === id);
    if (index !== -1 && filteredEmails.length > 1) {
      const nextSelect = filteredEmails[index === 0 ? 1 : index - 1];
      setSelectedEmailId(nextSelect.id);
    } else {
      setSelectedEmailId(null);
    }
  };

  // Dora AI Draft Generator
  const handleDoraAction = (actionType) => {
    if (!selectedEmail) return;
    setIsDrafting(true);
    setAiDraft('');

    setTimeout(() => {
      setIsDrafting(false);
      let text = '';
      const senderName = (selectedEmail.sender?.emailAddress?.name || 'Friend').split(' ')[0];
      const isZh = i18n.language === 'zh';

      if (actionType === 'summary') {
        setDoraTab('summary');
        if (selectedEmail.id === 'email_1') {
          text = isZh 
            ? "• 欢迎使用全新的 Dora 统一工作空间。\n• 整合了电子邮件、日历、聊天室和持久便签。\n• 使用标准的 HTML 表单，并支持浏览器本地缓存。"
            : "• Welcome to your new unified Dora Workspace.\n• Centralizes email, calendars, chat rooms, and persistent memos.\n• Uses standard HTML forms and supports persistent local browser cache.";
        } else if (selectedEmail.id === 'email_2') {
          text = isZh
            ? "• Sarah 分享了设计草图以供评审。\n• 页面布局采用了温暖的、受纸张启发的极简主义色调。\n• 旨在征求关于字体大小和动画流畅度的反馈。"
            : "• Sarah has shared mockup designs for review.\n• Layout relies on a warm, paper-inspired minimalist palette.\n• Aims for feedback on font readability and animation speed.";
        } else if (selectedEmail.id === 'email_3') {
          text = isZh
            ? "• 本地开发构建正常，运行在默认端口 5173 上。\n• HMR（热模块替换）环境已激活。\n• 已准备好打包生产代码。"
            : "• Local dev build is functional on default port 5173.\n• HMR environment is active.\n• Ready to bundle production code.";
        } else {
          text = isZh
            ? `• 发件人: ${selectedEmail.sender?.emailAddress?.name || '未知'}\n• 主题: ${selectedEmail.subject}\n• 核心内容: 关于项目主要范围的请求。`
            : `• Sender: ${selectedEmail.sender?.emailAddress?.name || 'Unknown'}\n• Subject: ${selectedEmail.subject}\n• Key Content: Request regarding the main project scope.`;
        }
      } else {
        setDoraTab('reply');
        if (actionType === 'professional') {
          text = isZh
            ? `你好 ${senderName}，\n\n感谢来信。关于“${selectedEmail.subject}”的相关事宜我已经收到，目前正在评估中。目前进度看起来非常顺利，我也同意目前的主要方向。如有需要进一步讨论的细节，我们再进行同步。\n\n顺祝商祺，\n用户`
            : `Hi ${senderName},\n\nThank you for reaching out. I've received your note regarding "${selectedEmail.subject}" and am reviewing it. The progress looks solid, and I agree with the main directions. Let's sync up if we need to refine any parameters.\n\nBest regards,\nUser`;
        } else if (actionType === 'decline') {
          text = isZh
            ? `你好 ${senderName}，\n\n感谢您的来信。很抱歉，由于本周有其他正在进行的项目以及较为紧张的交付期，我可能无法分配充足的时间来跟进此项事务。希望我们在下个周期能有机会合作！\n\n祝好，\n用户`
            : `Hi ${senderName},\n\nThanks for your note. Unfortunately, due to other ongoing commitments and tight project deliverables this week, I won't be able to dedicate the time this deserves. I hope we can collaborate on the next cycle!\n\nBest,\nUser`;
        } else if (actionType === 'custom') {
          const detail = aiInstruction.trim() || 'I will review this and get back to you shortly.';
          text = isZh
            ? `你好 ${senderName}，\n\n感谢来信。关于此项事务：\n\n${detail}\n\n如有其他需要补充的事项，请随时告知。\n\n此致，\n用户`
            : `Hi ${senderName},\n\nThanks for writing in. Regarding this:\n\n${detail}\n\nLet me know if there's anything else we need to cover.\n\nBest regards,\nUser`;
        }
      }
      setAiDraft(text);
      showToast(actionType === 'summary' ? t('email.doraSummarized') : t('email.doraDrafted'));
    }, 1200);
  };

  const handleUseDraftAsReply = () => {
    if (!aiDraft) return;
    const senderAddress = selectedEmail.sender?.emailAddress?.address || selectedEmail.sender?.emailAddress?.name || '';
    setComposeTo(senderAddress);
    setComposeSubject(`Re: ${selectedEmail.subject}`);
    setComposeBody(aiDraft);
    setIsComposing(true);
  };

  return (
    <div className="email-tab-container">
      {/* Email Sidebar */}
      <div className="email-sidebar">
        <button className="compose-btn" onClick={() => setIsComposing(true)}>
          <Plus size={18} />
          <span>{t('email.compose')}</span>
        </button>

        <nav className="email-folders">
          <button 
            className={`folder-item ${activeFolder === 'inbox' ? 'active' : ''}`}
            onClick={() => { setActiveFolder('inbox'); }}
          >
            <Mail size={16} />
            <span className="folder-name">{t('email.inbox')}</span>
            <span className="folder-count">
              {emails.filter(e => e.parentFolderId === 'inbox' && !e.isRead).length || ''}
            </span>
          </button>
          <button 
            className={`folder-item ${activeFolder === 'sent' ? 'active' : ''}`}
            onClick={() => { setActiveFolder('sent'); }}
          >
            <Send size={16} />
            <span className="folder-name">{t('email.sent')}</span>
          </button>
          <button 
            className={`folder-item ${activeFolder === 'trash' ? 'active' : ''}`}
            onClick={() => { setActiveFolder('trash'); }}
          >
            <Trash size={16} />
            <span className="folder-name">{t('email.trash')}</span>
          </button>
        </nav>
      </div>

      {/* Email List */}
      <div className="email-list-panel">
        <div className="email-search-bar">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder={t('email.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="email-list">
          {filteredEmails.length === 0 ? (
            <div className="email-empty-state">
              <Mail size={32} />
              <p>{t('email.emptyState')}</p>
            </div>
          ) : (
            filteredEmails.map(email => {
              const isUnread = !email.isRead;
              const senderName = email.sender?.emailAddress?.name || 'Unknown';
              const emailTime = formatEmailTime(email.receivedDateTime);

              return (
                <div
                  key={email.id}
                  className={`email-list-item ${selectedEmailId === email.id ? 'selected' : ''} ${isUnread ? 'unread' : ''}`}
                  onClick={() => {
                    setSelectedEmailId(email.id);
                    email.isRead = true;
                  }}
                >
                  <div className="email-item-header">
                    <span className="email-item-sender">{senderName}</span>
                    <span className="email-item-date">{emailTime}</span>
                  </div>
                  <div className="email-item-subject">{email.subject}</div>
                  <div className="email-item-snippet">{email.bodyPreview}</div>
                  {isUnread && <span className="unread-dot"></span>}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Email Reader */}
      <div className="email-reader-panel">
        {selectedEmail ? (
          <div className="email-reader-split-layout">
            <div className="email-detail-column">
              <div className="email-detail-header">
                <div className="sender-avatar-large">
                  {(selectedEmail.sender?.emailAddress?.name?.[0] || 'U').toUpperCase()}
                </div>
                <div className="email-detail-meta">
                  <div className="sender-name-row">
                    <span className="sender-name">{selectedEmail.sender?.emailAddress?.name || 'Unknown'}</span>
                    <span className="sender-email">&lt;{selectedEmail.sender?.emailAddress?.address || 'unknown@domain.com'}&gt;</span>
                  </div>
                  <div className="recipient-row">
                    {t('email.to')}: {selectedEmail.toRecipients?.[0]?.emailAddress?.name || selectedEmail.toRecipients?.[0]?.emailAddress?.address || 'me'}
                  </div>
                </div>
                <div className="email-detail-actions">
                  <button className={`action-icon-btn dora-toggle-btn ${isDoraActive ? 'active' : ''}`} onClick={() => setIsDoraActive(!isDoraActive)}>
                    <Sparkles size={16} />
                    <span>{t('email.doraTitle')}</span>
                  </button>
                  <button className="action-icon-btn reply-btn" onClick={handleReply} title={t('email.reply')}>
                    {t('email.reply')}
                  </button>
                  {selectedEmail.parentFolderId !== 'trash' && (
                    <button 
                      className="action-icon-btn delete-btn" 
                      onClick={() => handleDelete(selectedEmail.id)} 
                      title={t('common.delete')}
                    >
                      <Trash size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div className="email-detail-subject-container">
                <h2 className="email-detail-subject">{selectedEmail.subject}</h2>
                <span className="email-detail-date">
                  {formatEmailDateFull(selectedEmail.receivedDateTime)} at {formatEmailTime(selectedEmail.receivedDateTime)}
                </span>
              </div>

              <div className="email-detail-body">
                <EmailContentRenderer body={selectedEmail.body} />
              </div>
            </div>

            {/* Dora-styled AI Assistant Panel */}
            {isDoraActive && (
              <div className="dora-ai-sidebar-panel">
                <div className="dora-panel-header">
                  <div className="dora-header-title">
                    <Sparkles size={16} className="dora-sparkle-icon" />
                    <h4>{t('email.doraTitle')}</h4>
                  </div>
                  <button className="close-dora-btn" onClick={() => setIsDoraActive(false)}>
                    <X size={16} />
                  </button>
                </div>

                <div className="dora-avatar-section">
                  <div className="dora-image-wrapper">
                    <img 
                      src="/dora_assistant_avatar.png" 
                      alt="Dora AI virtual mascot" 
                      className="dora-3d-avatar"
                    />
                    <div className="dora-pulse-glow"></div>
                  </div>
                  <div className="dora-speech-bubble">
                    <p>{i18n.language === 'zh' ? "你好，我是 Dora！让我帮你分析或回复这封邮件吧。" : "Hi, I'm Dora! Let me help you analyze or reply to this message."}</p>
                  </div>
                </div>

                <div className="dora-controls-section">
                  <h5>{i18n.language === 'zh' ? "快速操作" : "Quick Actions"}</h5>
                  <div className="dora-quick-actions">
                    <button 
                      className="dora-action-btn summary-btn"
                      onClick={() => handleDoraAction('summary')}
                    >
                      {t('email.doraSummaryTab')}
                    </button>
                    <button 
                      className="dora-action-btn"
                      onClick={() => handleDoraAction('professional')}
                    >
                      {t('email.doraProfessional')}
                    </button>
                    <button 
                      className="dora-action-btn"
                      onClick={() => handleDoraAction('decline')}
                    >
                      {t('email.doraDecline')}
                    </button>
                  </div>

                  <div className="dora-custom-prompt-container">
                    <h5>{t('email.doraCustom')}</h5>
                    <div className="dora-input-wrapper">
                      <textarea
                        value={aiInstruction}
                        onChange={(e) => setAiInstruction(e.target.value)}
                        placeholder={t('email.doraCustomPlaceholder')}
                        rows="2"
                      />
                      <button 
                        className="dora-draft-submit-btn" 
                        onClick={() => handleDoraAction('custom')}
                        disabled={!aiInstruction.trim() || isDrafting}
                      >
                        {t('email.compose')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="dora-result-section">
                  {isDrafting && (
                    <div className="dora-draft-loading">
                      <span className="spinner"></span>
                      <span>{t('email.doraWait')}</span>
                    </div>
                  )}

                  {aiDraft && !isDrafting && (
                    <div className="dora-draft-result-card">
                      <div className="dora-result-header">
                        <h6>{doraTab === 'summary' ? t('email.doraSummaryTab') : t('email.doraReplyTab')}</h6>
                        {doraTab !== 'summary' && (
                          <button 
                            className="use-draft-btn"
                            onClick={handleUseDraftAsReply}
                          >
                            {t('email.doraCopyDraft')}
                          </button>
                        )}
                      </div>
                      <div className="dora-result-body">
                        {aiDraft.split('\n').map((line, i) => (
                          <p key={i}>{line || '\u00a0'}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="reader-empty-state">
            <Mail size={48} className="empty-state-icon" />
            <h3>{i18n.language === 'zh' ? "没有选择邮件" : "No conversation selected"}</h3>
            <p>{t('email.selectEmail')}</p>
          </div>
        )}
      </div>

      {/* Compose Modal */}
      {isComposing && (
        <div className="compose-modal-overlay">
          <div className="compose-modal">
            <div className="compose-modal-header">
              <h3>{i18n.language === 'zh' ? "新建邮件" : "New Message"}</h3>
              <button className="close-compose" onClick={() => setIsComposing(false)}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleComposeSubmit} className="compose-form">
              <div className="compose-input-group">
                <label htmlFor="compose-to">{t('email.to')}:</label>
                <input
                  type="email"
                  id="compose-to"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="recipients@email.com"
                  required
                />
              </div>
              <div className="compose-input-group">
                <label htmlFor="compose-subject">{t('email.subject')}:</label>
                <input
                  type="text"
                  id="compose-subject"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  placeholder="Conversation topic"
                  required
                />
              </div>
              <div className="compose-body-group">
                <textarea
                  id="compose-body"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  placeholder="Write your email here..."
                  required
                />
              </div>
              <div className="compose-footer">
                <button type="submit" className="send-btn">
                  <Send size={16} />
                  <span>{t('email.send')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
