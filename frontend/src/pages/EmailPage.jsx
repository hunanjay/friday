import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';
import { useMailAccounts, useMicrosoftMailStatus } from '../features/mail/accountHooks';
import { useInboxUnread, useMailMessages } from '../features/mail/mailboxHooks';
import {
  MICROSOFT_MAIL_CHANNEL as MICROSOFT,
} from '../features/mail/mailboxApi';
import { useMailFolderSync } from '../features/mail/useMailFolderSync';
import { useMailCompose } from '../features/mail/useMailCompose';
import { EmailComposer } from '../features/mail/components/EmailComposer';
import { EmailList } from '../features/mail/components/EmailList';
import { useMailSearch } from '../features/mail/useMailSearch';
import { useMailThread } from '../features/mail/useMailThread';
import { useAssistantName, useAvatar, useSignature } from '../features/settings/hooks';
import { useUi } from '../hooks/useUi';
import { useTranslation } from 'react-i18next';
import { Mail, Send, Trash, Plus, X, Sparkles, ChevronLeft, Info, Reply, ReplyAll, Forward } from '../components/common/Icons';
import EmailContentRenderer from '../components/common/EmailContentRenderer';
import EmailAttachments from '../components/common/EmailAttachments';
import ApprovalCard from '../components/common/ApprovalCard';
import { mailMessageUrl } from '../utils/mailApi';

const API_URL = import.meta.env.VITE_API_URL || '';
export default function EmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { assistantName } = useAssistantName();
  const { avatarUrl } = useAvatar();
  const { signature } = useSignature();
  const { mailAccounts } = useMailAccounts();
  const { msDisconnected } = useMicrosoftMailStatus();
  const {
    emails,
    moveEmailToTrash: handleDeleteEmail,
  } = useMailMessages();
  const { inboxUnread, adjustInboxUnread } = useInboxUnread();
  const { user, authToken, handleLogout } = useAuth();
  const { showToast, setIsSidebarCollapsed } = useUi();

  const { t, i18n } = useTranslation();

  const [activeFolder, setActiveFolder] = useState('inbox');
  const handleFolderSyncError = useCallback(
    () => showToast(t('email.syncFailed')),
    [showToast, t],
  );
  const {
    canLoadMoreFolder,
    isLoadingMoreFolder,
    isSyncingSent,
    loadMoreFolder,
    mailChannels,
    syncInbox,
    syncSent,
  } = useMailFolderSync({ activeFolder, onError: handleFolderSyncError });

  const handleComposeSent = useCallback(() => {
    void syncSent();
    void syncInbox();
  }, [syncInbox, syncSent]);
  const mailCompose = useMailCompose({
    connectionErrorMessage: i18n.language === 'zh'
      ? '无法连接到邮件服务，请稍后再试。'
      : "Couldn't reach the mail service, please try again later.",
    onSent: handleComposeSent,
    onToast: showToast,
    sentMessage: t('email.sentSuccess'),
  });
  const {
    openComposeFor: openMailComposeFor,
    openFreshCompose,
  } = mailCompose;

  const [searchQuery, setSearchQuery] = useState('');
  const {
    canLoadMoreSearch,
    isLoadingMoreSearch,
    isSearching,
    loadMoreSearch,
    searchResults,
  } = useMailSearch({ activeFolder, mailChannels, searchQuery });
  const handleThreadOpen = useCallback(
    () => setIsSidebarCollapsed(true),
    [setIsSidebarCollapsed],
  );
  const {
    cancelThreadPrefetch: cancelScheduledThreadPrefetch,
    clearThreadSelection,
    expandedMessageIds: expandedMsgIds,
    isLoadingThread,
    loadLinkedMessage,
    prefetchThread,
    removeThreadMessage,
    selectThread: handleSelectEmail,
    selectedConversationKey: selectedConvKey,
    threadMessages,
    toggleMessageExpanded: toggleMsgExpand,
  } = useMailThread({ onOpen: handleThreadOpen });
  // Dora AI Assistant states
  const [isDoraActive, setIsDoraActive] = useState(true);
  const [aiDraft, setAiDraft] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');

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
  }, [selectedConvKey]);

  // The "active" email for Dora / reply: the latest message in the thread.
  const selectedEmail = threadMessages.length > 0
    ? threadMessages[threadMessages.length - 1]
    : null;


  const handleDelete = (id) => {
    // Find the message in the open thread (most precise) or fall back to store
    const target = threadMessages.find(e => e.id === id)
      || emails.find(e => e.id === id);
    if (target && !target.isRead && target.parentFolderId === 'inbox') adjustInboxUnread(-1);
    handleDeleteEmail(id);
    // IMAP accounts have no trash - deletion is permanent.
    const isImap = target?.provider && target.provider !== MICROSOFT;
    showToast(isImap
      ? (i18n.language === 'zh' ? '邮件已永久删除（IMAP 无回收站）' : 'Email permanently deleted (no trash on IMAP)')
      : t('email.movedToTrash'));

    removeThreadMessage(id);

    fetch(mailMessageUrl(id), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => {});
  };

  const searchParams = new URLSearchParams(location.search);
  const targetEmailId = location.state?.emailId || searchParams.get('emailId');
  const targetEmailFolder = location.state?.emailFolder || searchParams.get('folder') || 'inbox';
  const targetEmailProvider = location.state?.emailProvider || searchParams.get('provider') || MICROSOFT;
  useEffect(() => {
    if (!targetEmailId) return;
    const targetEmail = location.state?.email || emails.find(email => email.id === targetEmailId);
    if (targetEmail) {
      setActiveFolder(targetEmail.parentFolderId || targetEmailFolder);
      handleSelectEmail({ ...targetEmail, _threadKey: targetEmail.conversationId || targetEmail.id });
      navigate('/email', { replace: true, state: null });
      return;
    }

    // Chat links may point to a message that is outside the currently synced
    // page (for example, a sent or older message). Fetch that message by ID so
    // the internal link still opens the reader instead of silently doing nothing.
    loadLinkedMessage({
      messageId: targetEmailId,
      folder: targetEmailFolder,
      provider: targetEmailProvider,
    })
      .then(fetchedEmail => {
        if (!fetchedEmail) return;
        setActiveFolder(targetEmailFolder);
        handleSelectEmail({
          ...fetchedEmail,
          _threadKey: fetchedEmail.conversationId || fetchedEmail.id,
        });
        navigate('/email', { replace: true, state: null });
      })
      .catch(() => showToast(t('email.loadFailed', { defaultValue: 'Failed to load email' })));
  }, [
    emails,
    handleSelectEmail,
    loadLinkedMessage,
    location.search,
    location.state,
    navigate,
    showToast,
    t,
    targetEmailFolder,
    targetEmailId,
    targetEmailProvider,
  ]);


  // Dora reply generator: sends the selected email's id + the user's intent to
  // the backend, which fetches & sanitizes the original mail and asks the LLM
  // to write a reply carrying out that intent (not restating it).
  const handleGenerateReply = async (intent) => {
    if (!selectedEmail || !intent.trim()) return;
    const isZh = i18n.language === 'zh';
    setIsDrafting(true);
    setAiDraft('');
    try {
      const res = await fetch(`${API_URL}/api/agent/draft-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ email_id: selectedEmail.id, intent, my_name: user?.name || '' }),
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAiDraft(data.draft);
        showToast(t('email.assistantDrafted', { name: assistantName }));
      } else {
        setAiDraft(isZh ? `出错了：${data.detail || '生成失败'}` : `Something went wrong: ${data.detail || 'failed'}`);
      }
    } catch {
      setAiDraft(isZh ? '无法连接到助手服务，请稍后再试。' : "Couldn't reach the assistant service, please try again later.");
    } finally {
      setIsDrafting(false);
    }
  };

  // 'reply' | 'replyAll' hit {id}/reply, 'forward' hits {id}/forward, and a
  // null mode is a fresh /send. The submit handler branches on this alone.
  const openComposeFor = (mode, { body = '' } = {}) => {
    openMailComposeFor(selectedEmail, mode, { body });
  };

  const handleUseDraftAsReply = () => {
    if (!aiDraft) return;
    openComposeFor('reply', { body: aiDraft });
  };

  return (
    <div className={`email-tab-container ${selectedConvKey ? 'has-selected-thread' : ''}`}>
      {msDisconnected && (
        <div className="email-disconnected-banner">
          <Info size={15} />
          {i18n.language === 'zh'
            ? 'Microsoft 邮箱连接已失效，其他邮箱不受影响。可在设置中重新连接。'
            : 'Microsoft mailbox connection expired. Other mailboxes are unaffected - reconnect in Settings.'}
        </div>
      )}
      {/* Email Sidebar */}
      <div className="email-sidebar">
        <button className="compose-btn" onClick={openFreshCompose}>
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
              {(inboxUnread ?? emails.filter(e => e.parentFolderId === 'inbox' && !e.isRead).length) || ''}
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

      <EmailList
        activeFolder={activeFolder}
        canLoadMoreFolder={canLoadMoreFolder}
        canLoadMoreSearch={canLoadMoreSearch}
        emails={emails}
        isLoadingMoreFolder={isLoadingMoreFolder}
        isLoadingMoreSearch={isLoadingMoreSearch}
        isSearching={isSearching}
        isSyncingSent={isSyncingSent}
        isZh={i18n.language === 'zh'}
        loadMoreFolder={loadMoreFolder}
        loadMoreSearch={loadMoreSearch}
        onCancelPrefetch={cancelScheduledThreadPrefetch}
        onDelete={handleDelete}
        onPrefetch={prefetchThread}
        onSelect={handleSelectEmail}
        searchQuery={searchQuery}
        searchResults={searchResults}
        selectedConversationKey={selectedConvKey}
        setSearchQuery={setSearchQuery}
        t={t}
      />

      {/* Email Reader */}
      <div className="email-reader-panel" style={{ position: 'relative' }}>
        {isLoadingThread ? (
          <div
            className="email-reader-split-layout"
            aria-busy="true"
            aria-label="Loading email details"
            style={{ position: 'absolute', inset: 0, zIndex: 2, backgroundColor: 'var(--bg-card)' }}
          >
            <div className="email-detail-column" style={{ padding: '32px 40px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', paddingBottom: '24px', borderBottom: '1px solid var(--border-light)' }}>
                <div className="skeleton-box" style={{ width: '48px', height: '48px', borderRadius: '50%', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div className="skeleton-box" style={{ width: '55%', height: '22px', marginBottom: '10px', borderRadius: '4px' }} />
                  <div className="skeleton-box" style={{ width: '28%', height: '13px', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div className="skeleton-box" style={{ width: '82px', height: '32px', borderRadius: '6px' }} />
                  <div className="skeleton-box" style={{ width: '32px', height: '32px', borderRadius: '6px' }} />
                </div>
              </div>

              <div style={{ padding: '28px 0 8px' }}>
                <div className="skeleton-box" style={{ width: '38%', height: '16px', marginBottom: '18px', borderRadius: '4px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div className="skeleton-box" style={{ width: '100%', height: '14px', borderRadius: '4px' }} />
                  <div className="skeleton-box" style={{ width: '96%', height: '14px', borderRadius: '4px' }} />
                  <div className="skeleton-box" style={{ width: '88%', height: '14px', borderRadius: '4px' }} />
                  <div className="skeleton-box" style={{ width: '72%', height: '14px', borderRadius: '4px' }} />
                  <div className="skeleton-box" style={{ width: '82%', height: '150px', margin: '10px 0', borderRadius: '8px' }} />
                  <div className="skeleton-box" style={{ width: '94%', height: '14px', borderRadius: '4px' }} />
                  <div className="skeleton-box" style={{ width: '62%', height: '14px', borderRadius: '4px' }} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '22px' }}>
                <div className="skeleton-box" style={{ width: '180px', height: '52px', borderRadius: '8px' }} />
                <div className="skeleton-box" style={{ width: '140px', height: '52px', borderRadius: '8px' }} />
              </div>
            </div>
            {isDoraActive && (
              <div className="dora-ai-sidebar-panel" style={{ padding: '24px' }}>
                <div className="skeleton-box" style={{ width: '45%', height: '20px', marginBottom: '28px', borderRadius: '4px' }} />
                <div className="skeleton-box" style={{ width: '150px', height: '150px', margin: '0 auto 24px', borderRadius: '50%' }} />
                <div className="skeleton-box" style={{ width: '100%', height: '64px', marginBottom: '28px', borderRadius: '8px' }} />
                <div className="skeleton-box" style={{ width: '30%', height: '14px', marginBottom: '10px', borderRadius: '4px' }} />
                <div className="skeleton-box" style={{ width: '100%', height: '92px', borderRadius: '8px' }} />
              </div>
            )}
          </div>
        ) : selectedConvKey && threadMessages.length > 0 ? (
          <div className="email-reader-split-layout">
            <div className="email-detail-column">
              {/* Fixed top action bar – always visible regardless of scroll */}
              <div className="email-detail-header">
                <button
                  type="button"
                  className="mobile-email-back-btn"
                  onClick={clearThreadSelection}
                  title={i18n.language === 'zh' ? '返回邮件列表' : 'Back to list'}
                >
                  <ChevronLeft size={18} />
                  <span>{i18n.language === 'zh' ? '返回' : 'Back'}</span>
                </button>
                <div className="email-detail-meta">
                  <h2 className="email-detail-subject-full" title={threadMessages[0]?.subject}>
                    {threadMessages[0]?.subject}
                    {threadMessages.length > 1 && (
                      <span className="thread-msg-count-label">
                        {i18n.language === 'zh' ? `${threadMessages.length} 封邮件` : `${threadMessages.length} messages`}
                      </span>
                    )}
                  </h2>
                </div>
                <div className="email-detail-actions">
                  <button className="action-icon-btn" onClick={() => openComposeFor('reply')}>
                    <Reply size={16} />
                    <span>{t('email.reply')}</span>
                  </button>
                  <button className="action-icon-btn" onClick={() => openComposeFor('replyAll')}>
                    <ReplyAll size={16} />
                    <span>{t('email.replyAll')}</span>
                  </button>
                  <button className="action-icon-btn" onClick={() => openComposeFor('forward')}>
                    <Forward size={16} />
                    <span>{t('email.forward')}</span>
                  </button>
                  <button
                    className={`action-icon-btn dora-toggle-btn ${isDoraActive ? 'active' : ''}`}
                    onClick={() => setIsDoraActive(!isDoraActive)}
                  >
                    <Sparkles size={16} />
                    <span>{t('email.assistantTitle', { name: assistantName })}</span>
                  </button>
                </div>
              </div>

              {/* Timeline */}
              <div className="thread-timeline">
                {threadMessages.map((msg, idx) => {
                  const isLatest = idx === threadMessages.length - 1;
                  const isExpanded = expandedMsgIds.has(msg.id);
                  const senderName = msg.sender?.emailAddress?.name || 'Unknown';
                  const senderAddr = msg.sender?.emailAddress?.address || '';
                  return (
                    <div key={msg.id} className={`thread-msg-entry ${isExpanded ? 'thread-msg-expanded' : 'thread-msg-collapsed'}`}>
                      <div
                        className="thread-msg-header"
                        onClick={() => toggleMsgExpand(msg.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && toggleMsgExpand(msg.id)}
                      >
                        <div className="sender-avatar-large" style={{ width: 34, height: 34, fontSize: 13, flexShrink: 0 }}>
                          {senderName[0]?.toUpperCase() || 'U'}
                        </div>
                        <div className="thread-msg-header-meta">
                          <div className="sender-name-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                            <span className="sender-name">{senderName}</span>
                            {isExpanded ? (
                              <span className="sender-email">&lt;{senderAddr}&gt;</span>
                            ) : (
                              <span className="stub-preview">{msg.bodyPreview}</span>
                            )}
                          </div>
                        </div>
                        <div className="thread-msg-header-right">
                          <span className="email-detail-date">
                            {isExpanded
                              ? `${formatEmailDateFull(msg.receivedDateTime)} ${formatEmailTime(msg.receivedDateTime)}`
                              : formatEmailTime(msg.receivedDateTime)}
                          </span>
                          <span className="thread-expand-chevron">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <>
                          <div className="email-detail-body thread-msg-body">
                            <EmailContentRenderer
                              body={msg.body || null}
                              messageId={msg.id}
                              authToken={authToken}
                              inlineAttachments={msg.attachments || []}
                            />
                          </div>
                          {msg.hasAttachments && (
                            <EmailAttachments
                              messageId={msg.id}
                              hasAttachments={msg.hasAttachments}
                              authToken={authToken}
                              initialAttachments={msg.attachments}
                            />
                          )}
                        </>
                      )}
                      {!isLatest && <div className="thread-msg-divider" />}
                    </div>

                  );
                })}
              </div>

            </div>



            {/* Dora-styled AI Assistant Panel */}
            {isDoraActive && (
              <div className="dora-ai-sidebar-panel">
                <div className="dora-panel-header">
                  <div className="dora-header-title">
                    <Sparkles size={16} className="dora-sparkle-icon" />
                    <h4>{t('email.assistantTitle', { name: assistantName })}</h4>
                  </div>
                  <button className="close-dora-btn" onClick={() => setIsDoraActive(false)}>
                    <X size={16} />
                  </button>
                </div>

                <div className="dora-avatar-section">
                  <div className="dora-image-wrapper">
                    <img
                      src={avatarUrl || '/dora_assistant_avatar.png'}
                      alt={`${assistantName} AI virtual mascot`}
                      className="dora-3d-avatar"
                    />
                    <div className="dora-pulse-glow"></div>
                  </div>
                  <div className="dora-speech-bubble">
                    <p>{i18n.language === 'zh' ? "告诉我你想怎么回复，我会结合这封邮件帮你写好。" : "Tell me how you'd like to reply, and I'll draft it from this email."}</p>
                  </div>
                </div>

                <div className="dora-controls-section">
                  <div className="dora-custom-prompt-container">
                    <h5>{i18n.language === 'zh' ? "你的意图" : "Your intent"}</h5>
                    <div className="dora-input-wrapper">
                      <textarea
                        value={aiInstruction}
                        onChange={(e) => setAiInstruction(e.target.value)}
                        placeholder={t('email.intentPlaceholder', { name: assistantName })}
                        rows="3"
                      />
                      <button
                        className="dora-draft-submit-btn"
                        onClick={() => handleGenerateReply(aiInstruction)}
                        disabled={!aiInstruction.trim() || isDrafting}
                      >
                        {t('email.generateReply')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="dora-result-section">
                  {isDrafting && (
                    <div className="dora-draft-loading">
                      <span className="spinner"></span>
                      <span>{t('email.assistantWait', { name: assistantName })}</span>
                    </div>
                  )}

                  {aiDraft && !isDrafting && (
                    <ApprovalCard
                      action={{
                        action_type: 'send_email',
                        presentation: { renderer: 'email', signature },
                        payload: {
                          to: selectedEmail?.sender?.emailAddress?.address || selectedEmail?.sender?.emailAddress?.name,
                          subject: selectedEmail?.subject ? `Re: ${selectedEmail.subject}` : '',
                          body: aiDraft,
                        },
                      }}
                      title={t('email.assistantReplyTab')}
                      statusLabel={t('email.assistantDrafted', { name: assistantName })}
                      confirmText={t('email.assistantCopyDraft')}
                      onConfirm={handleUseDraftAsReply}
                      assistantName={assistantName}
                    />
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

      <EmailComposer
        compose={mailCompose}
        isZh={i18n.language === 'zh'}
        mailAccounts={mailAccounts}
        signature={signature}
        t={t}
      />
    </div>
  );
}
