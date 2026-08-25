import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { readComposeDraft, writeComposeDraft } from './composeDraft';
import { useAuth } from '../features/auth/useAuth';
import { useMailAccounts, useMicrosoftMailStatus } from '../features/mail/accountHooks';
import { useInboxUnread, useMailMessages } from '../features/mail/mailboxHooks';
import {
  MICROSOFT_MAIL_CHANNEL as MICROSOFT,
} from '../features/mail/mailboxApi';
import { useMailFolderSync } from '../features/mail/useMailFolderSync';
import { useMailSearch } from '../features/mail/useMailSearch';
import { useMailThread } from '../features/mail/useMailThread';
import { useAssistantName, useAvatar, useSignature } from '../features/settings/hooks';
import { useUi } from '../hooks/useUi';
import { useTranslation } from 'react-i18next';
import { Mail, Send, Trash, Search, Plus, X, Sparkles, ChevronLeft, Info, Reply, ReplyAll, Forward } from '../components/common/Icons';
import EmailContentRenderer from '../components/common/EmailContentRenderer';
import EmailAttachments from '../components/common/EmailAttachments';
import ApprovalCard from '../components/common/ApprovalCard';
import { mailMessageUrl } from '../utils/mailApi';

const API_URL = import.meta.env.VITE_API_URL || '';
// Mirrors mail_compose.py; a backend smoke test asserts the two agree. Checked
// here so an oversized file is refused on pick, not after a slow upload.
const GRAPH_ATTACHMENT_LIMIT = 3 * 1024 * 1024;
const SMTP_ATTACHMENT_LIMIT = 20 * 1024 * 1024;

const mailApiBase = (channel) =>
  channel === MICROSOFT
    ? `${API_URL}/api/graph/mail`
    : `${API_URL}/api/mail-accounts/${channel}/mail`;

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
  } = useMailFolderSync({ activeFolder, onError: handleFolderSyncError });

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


  // Closing the window (or a reload) used to throw away whatever was typed.
  // Text only: attachments are File handles the browser will not hand back, so
  // restoring their names would promise files that are no longer attached.
  const [restoredDraft] = useState(readComposeDraft);

  // Compose modal states
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState(restoredDraft.to);
  const [composeCc, setComposeCc] = useState(restoredDraft.cc);
  const [composeBcc, setComposeBcc] = useState(restoredDraft.bcc);
  const [showCopyFields, setShowCopyFields] = useState(Boolean(restoredDraft.cc || restoredDraft.bcc));
  const [composeSubject, setComposeSubject] = useState(restoredDraft.subject);
  const [composeBody, setComposeBody] = useState(restoredDraft.body);
  const [composeAttachments, setComposeAttachments] = useState([]);
  // Which mailbox sends: 'microsoft' or a bound mail_accounts id.
  const [composeChannel, setComposeChannel] = useState(MICROSOFT);
  const [isSending, setIsSending] = useState(false);
  // Set by handleUseDraftAsReply - when present, submit hits the {id}/reply
  // endpoint (keeps threading) instead of a fresh /send.
  const [replyToEmailId, setReplyToEmailId] = useState(null);
  const [composeMode, setComposeMode] = useState(null);

  // Graph message id of the Outlook draft mirroring the current fresh compose
  // (null until the first debounced sync below creates one). A ref, not
  // state - it must not itself retrigger that sync effect.
  const draftIdRef = useRef(restoredDraft.draftId);
  const draftSyncTimer = useRef(null);

  useEffect(() => {
    writeComposeDraft({
      to: composeTo, cc: composeCc, bcc: composeBcc, subject: composeSubject, body: composeBody,
      draftId: draftIdRef.current,
    });
  }, [composeTo, composeCc, composeBcc, composeSubject, composeBody]);

  // Mirrors a fresh (not reply/forward) Microsoft compose into a real Outlook
  // draft, debounced, so it is recoverable from Outlook itself and not just
  // this browser's storage. Reply/forward stays local-only: Graph drafts a
  // reply through a separate createReply/createForward call this doesn't use.
  useEffect(() => {
    if (!isComposing || replyToEmailId || composeChannel !== MICROSOFT) return;
    if (!(composeTo || composeCc || composeBcc || composeSubject || composeBody)) return;
    clearTimeout(draftSyncTimer.current);
    draftSyncTimer.current = setTimeout(() => {
      const formData = new FormData();
      formData.append('to', composeTo);
      formData.append('cc', composeCc);
      formData.append('bcc', composeBcc);
      formData.append('subject', composeSubject);
      formData.append('body', composeBody);
      const id = draftIdRef.current;
      fetch(
        id ? `${mailApiBase(MICROSOFT)}/drafts/${encodeURIComponent(id)}` : `${mailApiBase(MICROSOFT)}/drafts`,
        { method: id ? 'PATCH' : 'POST', headers: { Authorization: `Bearer ${authToken}` }, body: formData },
      )
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (!data?.id) return;
          draftIdRef.current = data.id;
          writeComposeDraft({
            to: composeTo, cc: composeCc, bcc: composeBcc, subject: composeSubject, body: composeBody,
            draftId: data.id,
          });
        })
        // Best-effort: local storage stays the source of truth for what's
        // typed, so a sync failure never blocks composing or sending.
        .catch(() => {});
    }, 2000);
    return () => clearTimeout(draftSyncTimer.current);
  }, [composeTo, composeCc, composeBcc, composeSubject, composeBody, isComposing, replyToEmailId, composeChannel, authToken]);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

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

  // List row: always date + time together (e.g. "Jul 10 11:43") so a row
  // never shows a bare clock time with no way to tell which day it's from.
  // Locale follows the app's language (i18n), not the browser's.
  const formatEmailListDate = (isoString) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = i18n.language === 'zh'
      ? date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })
      : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${day} ${time}`;
  };

  // Clear AI draft when selecting a new email
  useEffect(() => {
    setAiDraft('');
    setAiInstruction('');
  }, [selectedConvKey]);

  // Filter emails by folder
  const folderEmails = emails.filter(email => {
    if (activeFolder === 'inbox') return email.parentFolderId === 'inbox';
    if (activeFolder === 'sent') return email.parentFolderId === 'sent';
    if (activeFolder === 'trash') return email.parentFolderId === 'trash';
    return true;
  });

  // Group folderEmails by conversationId (Gmail-style threading).
  // Each thread row = the most recent message in that conversation.
  // Threads without a conversationId are treated as standalone (id as key).
  const threadedEmails = (() => {
    const map = new Map(); // conversationId -> thread summary
    for (const email of folderEmails) {
      const key = email.conversationId || email.id;
      if (!map.has(key)) {
        map.set(key, {
          ...email,            // latest message fields used for the row
          _threadKey: key,
          _count: 1,
          _hasUnread: !email.isRead,
        });
      } else {
        const existing = map.get(key);
        const existingDate = new Date(existing.receivedDateTime);
        const thisDate = new Date(email.receivedDateTime);
        map.set(key, {
          // Always surface the most recent message as the row summary
          ...(thisDate > existingDate ? email : existing),
          _threadKey: key,
          _count: existing._count + 1,
          _hasUnread: existing._hasUnread || !email.isRead,
        });
      }
    }
    // Sort threads by most-recent message descending
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime)
    );
  })();

  const isSearchMode = Boolean(searchQuery.trim());
  // In search mode keep flat results; in folder mode use the threaded groups.
  const filteredEmails = isSearchMode ? searchResults : threadedEmails;
  const canLoadMore = isSearchMode
    ? canLoadMoreSearch
    : canLoadMoreFolder;
  const isLoadingMore = isSearchMode
    ? isLoadingMoreSearch
    : isLoadingMoreFolder;
  const handleLoadMore = isSearchMode
    ? loadMoreSearch
    : loadMoreFolder;

  // The "active" email for Dora / reply: the latest message in the thread.
  const selectedEmail = threadMessages.length > 0
    ? threadMessages[threadMessages.length - 1]
    : null;

  const handleAttachmentChange = (e) => {
    const files = Array.from(e.target.files);
    const limit = composeChannel === MICROSOFT ? GRAPH_ATTACHMENT_LIMIT : SMTP_ATTACHMENT_LIMIT;
    // Everything already attached counts: the whole batch goes in one request,
    // so measuring only the new files let three small picks add up past it.
    const total = [...composeAttachments, ...files].reduce((sum, file) => sum + file.size, 0);
    if (total > limit) {
      showToast(t('email.attachmentsTooLarge', {
        total: (total / 1048576).toFixed(1),
        limit: Math.round(limit / 1048576),
      }));
      return;
    }
    setComposeAttachments(prev => [...prev, ...files]);
  };

  const removeAttachment = (index) => {
    setComposeAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleComposeSubmit = async (e) => {
    e.preventDefault();
    if (!composeTo || !composeSubject || !composeBody) {
      alert('Please fill out all fields');
      return;
    }

    const isZh = i18n.language === 'zh';
    setIsSending(true);
    try {
      const formData = new FormData();
      formData.append('to', composeTo);
      formData.append('subject', composeSubject);
      formData.append('body', composeBody);
      formData.append('cc', composeCc);
      formData.append('bcc', composeBcc);
      if (composeMode === 'forward') formData.append('subject', composeSubject);
      composeAttachments.forEach(file => {
        formData.append('attachments', file);
      });

      if (composeMode === 'replyAll') formData.append('reply_all', 'true');
      const sendBase = mailApiBase(composeChannel);
      const threadPath = composeMode === 'forward' ? '/forward' : '/reply';
      const res = replyToEmailId
        ? await fetch(mailMessageUrl(replyToEmailId, threadPath), {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}` },
            body: formData,
          })
        : await fetch(`${sendBase}/send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}` },
            body: formData,
          });

      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (!res.ok) {
        const failure = await res.json().catch(() => ({}));
        showToast(failure.detail || (isZh ? '发送失败，请稍后重试' : 'Failed to send, please try again'));
        return;
      }

      // A fresh compose that synced to an Outlook draft is now sent - drop
      // the draft so it doesn't linger as a duplicate of the sent message.
      if (draftIdRef.current && !replyToEmailId) {
        fetch(mailMessageUrl(draftIdRef.current, '?permanent=true'), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${authToken}` },
        }).catch(() => {});
        draftIdRef.current = null;
      }

      // Refresh the sent list so the real Graph message (with its true ID)
      // appears immediately, rather than an optimistic local stub.
      setHasFetchedSent(false);
      // Refresh the inbox too - a sent email may bounce back or the recipient
      // may reply instantly; without this the inbox only updates on reload.
      syncInbox();
      setIsComposing(false);
      setReplyToEmailId(null);
      setComposeMode(null);
      setComposeTo('');
      setComposeCc('');
      setComposeBcc('');
      setShowCopyFields(false);
      setComposeSubject('');
      setComposeBody('');
      setComposeAttachments([]);
      showToast(t('email.sentSuccess'));
    } catch {
      showToast(isZh ? '无法连接到邮件服务，请稍后再试。' : "Couldn't reach the mail service, please try again later.");
    } finally {
      setIsSending(false);
    }
  };


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
    if (!selectedEmail) return;
    const senderAddress = selectedEmail.sender?.emailAddress?.address || selectedEmail.sender?.emailAddress?.name || '';
    // A reply/forward never mirrors to an Outlook draft (see the sync effect
    // above), so drop any leftover fresh-compose draft id rather than let a
    // later fresh compose silently resume and overwrite it.
    draftIdRef.current = null;
    setComposeMode(mode);
    setReplyToEmailId(selectedEmail.id);
    setComposeChannel(selectedEmail.provider || MICROSOFT);
    setComposeTo(mode === 'forward' ? '' : senderAddress);
    setComposeCc('');
    setComposeBcc('');
    setShowCopyFields(false);
    setComposeSubject(
      mode === 'forward' ? `Fwd: ${selectedEmail.subject}` : `Re: ${selectedEmail.subject}`,
    );
    setComposeBody(body);
    setIsComposing(true);
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
        <button className="compose-btn" onClick={() => { setReplyToEmailId(null); setComposeMode(null); setIsComposing(true); }}>
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
          {isSearching || isSyncingSent ? (
            <div className="email-empty-state">
              <p>{t('common.search')}...</p>
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="email-empty-state">
              <Mail size={32} />
              <p>{t('email.emptyState')}</p>
            </div>
          ) : (
            filteredEmails.map(threadRow => {
              const isUnread = threadRow._hasUnread ?? !threadRow.isRead;
              const senderName = threadRow.sender?.emailAddress?.name || 'Unknown';
              const emailTime = formatEmailListDate(threadRow.receivedDateTime);
              const threadKey = threadRow._threadKey || threadRow.conversationId || threadRow.id;
              const isSelected = threadKey === selectedConvKey;
              const count = threadRow._count || 1;

              return (
                <div
                  key={threadRow._threadKey || threadRow.id}
                  className={`email-list-item ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectEmail(threadRow)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleSelectEmail(threadRow);
                    }
                  }}
                  onMouseEnter={() => prefetchThread(threadRow)}
                  onMouseLeave={() => cancelScheduledThreadPrefetch(threadRow)}
                  onFocus={() => prefetchThread(threadRow)}
                  onBlur={() => cancelScheduledThreadPrefetch(threadRow)}
                >
                  <div className="email-item-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div className="email-item-avatar">
                        {(senderName?.[0] || 'U').toUpperCase()}
                      </div>
                      <span className="email-item-sender">{senderName}</span>
                    </div>
                    <span className="email-item-date">{emailTime}</span>
                  </div>
                  <div className="email-item-subject">
                    {threadRow.subject}
                    {count > 1 && (
                      <span className="thread-count-badge">{count}</span>
                    )}
                  </div>
                  <div className="email-item-snippet">{threadRow.bodyPreview}</div>
                  {isUnread && <span className="unread-dot"></span>}

                  {threadRow.parentFolderId !== 'trash' && confirmDeleteId !== threadRow.id && (
                    <button
                      type="button"
                      className="delete-email-item-btn"
                      title={t('common.delete')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(threadRow.id);
                      }}
                    >
                      <Trash size={14} />
                    </button>
                  )}

                  {confirmDeleteId === threadRow.id && (
                    <div className="email-delete-confirm-popover" onClick={(e) => e.stopPropagation()}>
                      <span>{i18n.language === 'zh' ? '移至废纸篓？' : 'Delete?'}</span>
                      <button
                        type="button"
                        className="confirm-delete-yes-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                          handleDelete(threadRow.id);
                        }}
                      >
                        {i18n.language === 'zh' ? '确定' : 'Yes'}
                      </button>
                      <button
                        type="button"
                        className="confirm-delete-no-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {!isSearching && canLoadMore && (
            <button type="button" className="load-more-emails-btn" onClick={handleLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? `${t('email.loadMore')}...` : t('email.loadMore')}
            </button>
          )}
        </div>
      </div>

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
                <label htmlFor="compose-provider">{i18n.language === 'zh' ? '发送账户' : 'Send from'}:</label>
                <select
                  id="compose-provider"
                  value={composeChannel}
                  onChange={(e) => setComposeChannel(e.target.value)}
                  style={{ flex: 1, padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border-light)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}
                >
                  <option value={MICROSOFT}>{i18n.language === 'zh' ? '微软邮箱 (Outlook)' : 'Microsoft (Outlook)'}</option>
                  {(mailAccounts || []).map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.email_address}</option>
                  ))}
                </select>
              </div>
              <div className="compose-input-group">
                <label htmlFor="compose-to">{t('email.to')}:</label>
                <input
                  type="text"
                  id="compose-to"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  placeholder="recipients@email.com"
                  required
                />
                {!showCopyFields && (
                  <button
                    type="button"
                    className="compose-copy-toggle"
                    onClick={() => setShowCopyFields(true)}
                  >
                    {t('email.cc')} / {t('email.bcc')}
                  </button>
                )}
              </div>
              {showCopyFields && (
                <>
                  <div className="compose-input-group">
                    <label htmlFor="compose-cc">{t('email.cc')}:</label>
                    <input
                      type="text"
                      id="compose-cc"
                      value={composeCc}
                      onChange={(e) => setComposeCc(e.target.value)}
                      placeholder="a@example.com, b@example.com"
                    />
                  </div>
                  <div className="compose-input-group">
                    <label htmlFor="compose-bcc">{t('email.bcc')}:</label>
                    <input
                      type="text"
                      id="compose-bcc"
                      value={composeBcc}
                      onChange={(e) => setComposeBcc(e.target.value)}
                      placeholder="a@example.com, b@example.com"
                    />
                  </div>
                </>
              )}
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
                {/* Read-only: the backend appends this at send time, for every
                    send route. Shown so the append is never a surprise. */}
                {signature && (
                  <div className="compose-signature-preview">
                    <span>{t('email.signature')}</span>
                    <p>{signature}</p>
                  </div>
                )}
              </div>
              <div className="compose-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="compose-attachments-list" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
                  <label className="attachment-upload-btn" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', backgroundColor: 'var(--bg-secondary)', borderRadius: '4px', fontSize: '0.85rem', border: '1px solid var(--border-light)' }}>
                    <Plus size={14} style={{ marginRight: '4px' }}/> {i18n.language === 'zh' ? '添加附件' : 'Add'}
                    <input type="file" multiple style={{ display: 'none' }} onChange={handleAttachmentChange} />
                  </label>
                  {composeAttachments.map((att, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', backgroundColor: 'var(--bg-hover)', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid var(--border-light)' }}>
                      <span style={{ maxWidth: '100px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={att.name}>{att.name}</span>
                      <X size={12} style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }} onClick={() => removeAttachment(idx)} />
                    </div>
                  ))}
                </div>
                <button type="submit" className="send-btn" disabled={isSending}>
                  <Send size={16} />
                  <span>{isSending ? `${t('email.send')}...` : t('email.send')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
