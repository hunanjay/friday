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
import { useMailActions } from '../features/mail/useMailActions';
import { EmailComposer } from '../features/mail/components/EmailComposer';
import { EmailDetail } from '../features/mail/components/EmailDetail';
import { EmailList } from '../features/mail/components/EmailList';
import { useMailSearch } from '../features/mail/useMailSearch';
import { useMailThread } from '../features/mail/useMailThread';
import { useAssistantName, useAvatar, useSignature } from '../features/settings/hooks';
import { useUi } from '../hooks/useUi';
import { useTranslation } from 'react-i18next';
import { Mail, Send, Trash, Plus, Info } from '../components/common/Icons';
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
  const { authToken } = useAuth();
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
  const [isDoraActive, setIsDoraActive] = useState(true);

  // The "active" email for Dora / reply: the latest message in the thread.
  const selectedEmail = threadMessages.length > 0
    ? threadMessages[threadMessages.length - 1]
    : null;
  const {
    aiDraft,
    aiInstruction,
    deleteMessage: handleDelete,
    generateReply: handleGenerateReply,
    isDrafting,
    setAiInstruction,
  } = useMailActions({
    adjustInboxUnread,
    assistantDraftedMessage: t('email.assistantDrafted', { name: assistantName }),
    emails,
    isZh: i18n.language === 'zh',
    movedToTrashMessage: t('email.movedToTrash'),
    moveEmailToTrash: handleDeleteEmail,
    onToast: showToast,
    removeThreadMessage,
    selectedConversationKey: selectedConvKey,
    selectedEmail,
    threadMessages,
  });

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

      <EmailDetail
        assistant={{
          avatarUrl,
          draft: aiDraft,
          generateReply: handleGenerateReply,
          instruction: aiInstruction,
          isActive: isDoraActive,
          isDrafting,
          name: assistantName,
          selectedEmail,
          setInstruction: setAiInstruction,
          setIsActive: setIsDoraActive,
          useDraftAsReply: handleUseDraftAsReply,
        }}
        authToken={authToken}
        isZh={i18n.language === 'zh'}
        signature={signature}
        t={t}
        thread={{
          clearSelection: clearThreadSelection,
          expandedMessageIds: expandedMsgIds,
          isLoading: isLoadingThread,
          messages: threadMessages,
          openCompose: openComposeFor,
          selectedConversationKey: selectedConvKey,
          toggleExpanded: toggleMsgExpand,
        }}
      />

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
