import React, { useState, useEffect } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Mail, Send, Trash, Search, Plus, X, Sparkles } from '../components/common/Icons';
import EmailContentRenderer from '../components/common/EmailContentRenderer';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

// Shared shape for both the inbox sync and search responses, since both are
// arrays of raw Graph message objects.
// NOTE: `body` (full HTML) is intentionally omitted here - large HTML bodies
// are fetched on demand (per selected email) and held in component-local
// bodyCache state, not persisted to localStorage.
function normalizeMessage(msg, parentFolderId) {
  return {
    id: msg.id,
    subject: msg.subject,
    bodyPreview: msg.bodyPreview,
    sender: msg.sender,
    toRecipients: msg.toRecipients,
    receivedDateTime: msg.receivedDateTime,
    isRead: msg.isRead,
    parentFolderId,
    conversationId: msg.conversationId || null,
  };
}

export default function EmailPage() {
  const {
    user,
    emails,
    handleAddEmail,
    handleDeleteEmail,
    handleMarkEmailRead,
    showToast,
    authToken,
    setIsSyncingInbox,
    inboxUnread,
    adjustInboxUnread,
    handleSyncInboxEmails,
    handleAppendInboxEmails,
    handleSyncSentEmails,
    handleAppendSentEmails,
    handleLogout,
    setIsSidebarCollapsed
  } = useWorkspace();

  const { t, i18n } = useTranslation();

  const [activeFolder, setActiveFolder] = useState('inbox');

  const [searchQuery, setSearchQuery] = useState('');

  // Cursor pagination: each fetch (initial sync, search, or "load more")
  // returns next_cursor - Graph's @odata.nextLink passed straight back as
  // `cursor` to fetch the following page. null/undefined means no more pages.
  const [inboxCursor, setInboxCursor] = useState(null);
  const [isLoadingMoreInbox, setIsLoadingMoreInbox] = useState(false);

  const [sentCursor, setSentCursor] = useState(null);
  const [isLoadingMoreSent, setIsLoadingMoreSent] = useState(false);
  // Tracks whether we've already fetched sent in this session (lazy: only on first visit).
  const [hasFetchedSent, setHasFetchedSent] = useState(false);
  const [isSyncingSent, setIsSyncingSent] = useState(false);

  // Per-session body cache: maps email id -> Graph body object (content +
  // contentType). Not persisted - fetched on demand when an email is selected.
  // Keyed separately from `emails` so re-renders from inbox updates don't
  // evict already-loaded bodies.
  const [bodyCache, setBodyCache] = useState({});

  // Thread detail state (must be declared before any useEffect that references them)
  const [selectedConvKey, setSelectedConvKey] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  // IDs of messages whose full body is expanded in the timeline view.
  const [expandedMsgIds, setExpandedMsgIds] = useState(new Set());

  // Sync Inbox. Gated on presence (hasAuthToken), not the token's exact
  // value, so periodic Supabase token refreshes don't re-trigger a refetch.
  // (The authoritative unread count is fetched in WorkspaceContext so the
  // sidebar badge shares it.)
  const hasAuthToken = Boolean(authToken);
  useEffect(() => {
    if (!authToken) return;
    setIsSyncingInbox(true);
    fetch(`${API_URL}/api/graph/mail/inbox`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => {
        if (res.status === 401) {
          handleLogout();
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        handleSyncInboxEmails((data.value || []).map(msg => normalizeMessage(msg, 'inbox')));
        setInboxCursor(data.next_cursor || null);
      })
      .catch(() => showToast(t('email.syncFailed')))
      .finally(() => setIsSyncingInbox(false));
  }, [hasAuthToken, t, showToast, setIsSyncingInbox, handleSyncInboxEmails, handleLogout]);

  const handleLoadMoreInbox = () => {
    if (!inboxCursor || isLoadingMoreInbox) return;
    setIsLoadingMoreInbox(true);
    fetch(`${API_URL}/api/graph/mail/inbox?cursor=${encodeURIComponent(inboxCursor)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { value: [], next_cursor: null }))
      .then(data => {
        handleAppendInboxEmails((data.value || []).map(msg => normalizeMessage(msg, 'inbox')));
        setInboxCursor(data.next_cursor || null);
      })
      .catch(() => showToast(t('email.syncFailed')))
      .finally(() => setIsLoadingMoreInbox(false));
  };

  // Lazy sync: fetch sent emails the first time the user switches to the Sent folder.
  useEffect(() => {
    if (!authToken || activeFolder !== 'sent' || hasFetchedSent) return;
    setIsSyncingSent(true);
    fetch(`${API_URL}/api/graph/mail/sent`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => {
        if (res.status === 401) { handleLogout(); return null; }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        handleSyncSentEmails((data.value || []).map(msg => normalizeMessage(msg, 'sent')));
        setSentCursor(data.next_cursor || null);
        setHasFetchedSent(true);
      })
      .catch(() => showToast(t('email.syncFailed')))
      .finally(() => setIsSyncingSent(false));
  }, [authToken, activeFolder, hasFetchedSent, handleSyncSentEmails, handleLogout, showToast, t]);

  const handleLoadMoreSent = () => {
    if (!sentCursor || isLoadingMoreSent) return;
    setIsLoadingMoreSent(true);
    fetch(`${API_URL}/api/graph/mail/sent?cursor=${encodeURIComponent(sentCursor)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { value: [], next_cursor: null }))
      .then(data => {
        handleAppendSentEmails((data.value || []).map(msg => normalizeMessage(msg, 'sent')));
        setSentCursor(data.next_cursor || null);
      })
      .catch(() => showToast(t('email.syncFailed')))
      .finally(() => setIsLoadingMoreSent(false));
  };

  // Compose modal states
  const [isComposing, setIsComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  // Set by handleUseDraftAsReply - when present, submit hits Graph's
  // {id}/reply endpoint (keeps threading) instead of a fresh /send.
  const [replyToEmailId, setReplyToEmailId] = useState(null);

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

  // Search hits the real backend (/api/graph/mail/search), debounced, scoped
  // to the active folder. Empty query falls back to the locally synced list.
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchCursor, setSearchCursor] = useState(null);
  const [isLoadingMoreSearch, setIsLoadingMoreSearch] = useState(false);

  const searchGraphFolder = { inbox: 'inbox', sent: 'sent', trash: 'deleted' }[activeFolder] || 'inbox';

  useEffect(() => {
    if (!authToken || !searchQuery.trim()) {
      setSearchResults([]);
      setSearchCursor(null);
      return;
    }
    const controller = new AbortController();
    setIsSearching(true);
    const timer = setTimeout(() => {
      fetch(
        `${API_URL}/api/graph/mail/search?query=${encodeURIComponent(searchQuery)}&folder=${searchGraphFolder}&top=25`,
        { headers: { Authorization: `Bearer ${authToken}` }, signal: controller.signal }
      )
        .then(res => (res.ok ? res.json() : { value: [], next_cursor: null }))
        .then(data => {
          setSearchResults((data.value || []).map(msg => normalizeMessage(msg, activeFolder)));
          setSearchCursor(data.next_cursor || null);
        })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, activeFolder, authToken, searchGraphFolder]);

  const handleLoadMoreSearch = () => {
    if (!searchCursor || isLoadingMoreSearch) return;
    setIsLoadingMoreSearch(true);
    // Graph's $skip pagination is offset-based, so a shifting result set can
    // return an email we already have; capture the query this page belongs to
    // and drop the response if the user has since retyped (avoids mixing old
    // and new results), then dedupe by id on append.
    const forQuery = searchQuery;
    fetch(`${API_URL}/api/graph/mail/search?cursor=${encodeURIComponent(searchCursor)}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { value: [], next_cursor: null }))
      .then(data => {
        if (forQuery !== searchQuery) return;
        setSearchResults(prev => {
          const seen = new Set(prev.map(e => e.id));
          const next = (data.value || [])
            .map(msg => normalizeMessage(msg, activeFolder))
            .filter(e => !seen.has(e.id));
          return [...prev, ...next];
        });
        setSearchCursor(data.next_cursor || null);
      })
      .catch(() => {})
      .finally(() => setIsLoadingMoreSearch(false));
  };

  const isSearchMode = Boolean(searchQuery.trim());
  // In search mode keep flat results; in folder mode use the threaded groups.
  const filteredEmails = isSearchMode ? searchResults : threadedEmails;
  const canLoadMore = isSearchMode
    ? Boolean(searchCursor)
    : activeFolder === 'inbox'
      ? Boolean(inboxCursor)
      : activeFolder === 'sent'
        ? Boolean(sentCursor)
        : false;
  const isLoadingMore = isSearchMode
    ? isLoadingMoreSearch
    : activeFolder === 'sent'
      ? isLoadingMoreSent
      : isLoadingMoreInbox;
  const handleLoadMore = isSearchMode
    ? handleLoadMoreSearch
    : activeFolder === 'sent'
      ? handleLoadMoreSent
      : handleLoadMoreInbox;

  // The "active" email for Dora / reply: the latest message in the thread.
  const selectedEmail = threadMessages.length > 0
    ? threadMessages[threadMessages.length - 1]
    : null;

  const handleComposeSubmit = async (e) => {
    e.preventDefault();
    if (!composeTo || !composeSubject || !composeBody) {
      alert('Please fill out all fields');
      return;
    }

    const isZh = i18n.language === 'zh';
    setIsSending(true);
    try {
      const res = replyToEmailId
        ? await fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(replyToEmailId)}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ body: composeBody }),
          })
        : await fetch(`${API_URL}/api/graph/mail/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
            body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
          });

      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (!res.ok) {
        showToast(isZh ? '发送失败，请稍后重试' : 'Failed to send, please try again');
        return;
      }

      // Refresh the sent list so the real Graph message (with its true ID)
      // appears immediately, rather than an optimistic local stub.
      setHasFetchedSent(false);
      setIsComposing(false);
      setReplyToEmailId(null);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
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
    showToast(t('email.movedToTrash'));

    // Remove from the currently displayed thread; if thread becomes empty, deselect.
    setThreadMessages(prev => {
      const next = prev.filter(e => e.id !== id);
      if (next.length === 0) setSelectedConvKey(null);
      return next;
    });

    fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => {});
  };



  const handleSelectEmail = (threadRow) => {
    const convKey = threadRow._threadKey;
    if (convKey === selectedConvKey) return; // already selected

    // Mark locally-known unread inbox messages as soon as their thread is
    // opened. Graph's conversation response returns parentFolderId as an
    // opaque folder GUID, so waiting for that response and comparing it with
    // the string "inbox" prevents the read API from ever being called.
    const unreadInboxIds = emails
      .filter(email => (
        !email.isRead
        && email.parentFolderId === 'inbox'
        && (email.conversationId || email.id) === convKey
      ))
      .map(email => email.id);

    // Search results may not be present in the locally-synced email page.
    if (
      unreadInboxIds.length === 0
      && !threadRow.isRead
      && threadRow.parentFolderId === 'inbox'
    ) {
      unreadInboxIds.push(threadRow.id);
    }

    const readIds = new Set(unreadInboxIds);
    unreadInboxIds.forEach(id => {
      handleMarkEmailRead(id, true);
      adjustInboxUnread(-1);
      fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(id)}/read`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ is_read: true }),
      }).catch(() => {});
    });

    setSelectedConvKey(convKey);
    setThreadMessages([]);
    setExpandedMsgIds(new Set());
    setIsSidebarCollapsed(true);

    // If this thread row has a real conversationId, fetch the full thread from
    // Graph (all folders, chronological). Otherwise fall back to a single-
    // message view using the row's own id.
    const convId = threadRow.conversationId;
    if (convId) {
      setIsLoadingThread(true);
      fetch(`${API_URL}/api/graph/mail/conversation/${encodeURIComponent(convId)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then(res => (res.ok ? res.json() : { value: [] }))
        .then(data => {
          const msgs = data.value || [];
          setThreadMessages(msgs.map(msg => readIds.has(msg.id) ? { ...msg, isRead: true } : msg));
          // Default: expand all unread messages; if all read, expand only the latest.
          const unreadIds = msgs.filter(m => !m.isRead).map(m => m.id);
          const toExpand = unreadIds.length > 0
            ? new Set(unreadIds)
            : msgs.length > 0 ? new Set([msgs[msgs.length - 1].id]) : new Set();
          setExpandedMsgIds(toExpand);
        })
        .catch(() => {})
        .finally(() => setIsLoadingThread(false));
    } else {
      // Single-message thread (no conversationId): reuse single-email fetch
      setIsLoadingThread(true);
      fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(threadRow.id)}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data) {
            setThreadMessages([{ ...data, isRead: readIds.has(data.id) ? true : data.isRead }]);
            setExpandedMsgIds(new Set([data.id]));
          }
        })
        .catch(() => {})
        .finally(() => setIsLoadingThread(false));

    }
  };

  const toggleMsgExpand = (msgId) => {
    setExpandedMsgIds(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };


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
        showToast(t('email.doraDrafted'));
      } else {
        setAiDraft(isZh ? `出错了：${data.detail || '生成失败'}` : `Something went wrong: ${data.detail || 'failed'}`);
      }
    } catch {
      setAiDraft(isZh ? '无法连接到助手服务，请稍后再试。' : "Couldn't reach the assistant service, please try again later.");
    } finally {
      setIsDrafting(false);
    }
  };

  const handleUseDraftAsReply = () => {
    if (!aiDraft) return;
    const senderAddress = selectedEmail.sender?.emailAddress?.address || selectedEmail.sender?.emailAddress?.name || '';
    setComposeTo(senderAddress);
    setComposeSubject(`Re: ${selectedEmail.subject}`);
    setComposeBody(aiDraft);
    setReplyToEmailId(selectedEmail.id);
    setIsComposing(true);
  };

  return (
    <div className="email-tab-container">
      {/* Email Sidebar */}
      <div className="email-sidebar">
        <button className="compose-btn" onClick={() => { setReplyToEmailId(null); setIsComposing(true); }}>
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
              const isSelected = threadRow._threadKey === selectedConvKey;
              const count = threadRow._count || 1;

              return (
                <div
                  key={threadRow._threadKey || threadRow.id}
                  className={`email-list-item ${isSelected ? 'selected' : ''} ${isUnread ? 'unread' : ''}`}
                  onClick={() => handleSelectEmail(threadRow)}
                >
                  <div className="email-item-header">
                    <span className="email-item-sender">{senderName}</span>
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
      <div className="email-reader-panel">
        {isLoadingThread ? (
          <div className="reader-empty-state">
            <div className="spinner" style={{ width: 32, height: 32 }} />
            <p style={{ marginTop: 12, opacity: 0.6 }}>{i18n.language === 'zh' ? '加载对话中…' : 'Loading thread…'}</p>
          </div>
        ) : selectedConvKey && threadMessages.length > 0 ? (
          <div className="email-reader-split-layout">
            <div className="email-detail-column">
              {/* Fixed top action bar – always visible regardless of scroll */}
              <div className="email-detail-header">
                <div className="sender-avatar-large">
                  {(selectedEmail?.sender?.emailAddress?.name?.[0] || 'U').toUpperCase()}
                </div>
                <div className="email-detail-meta">
                  <div className="email-detail-subject" style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 2 }}>
                    {threadMessages[0]?.subject}
                  </div>
                  {threadMessages.length > 1 && (
                    <span className="thread-msg-count-label" style={{ marginLeft: 0 }}>
                      {i18n.language === 'zh' ? `${threadMessages.length} 封邮件` : `${threadMessages.length} messages`}
                    </span>
                  )}
                </div>
                <div className="email-detail-actions">
                  <button
                    className={`action-icon-btn dora-toggle-btn ${isDoraActive ? 'active' : ''}`}
                    onClick={() => setIsDoraActive(!isDoraActive)}
                  >
                    <Sparkles size={16} />
                    <span>{t('email.doraTitle')}</span>
                  </button>
                  {selectedEmail?.parentFolderId !== 'trash' && (
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

              {/* Timeline */}
              <div className="thread-timeline">
                {threadMessages.map((msg, idx) => {
                  const isLatest = idx === threadMessages.length - 1;
                  const isExpanded = expandedMsgIds.has(msg.id);
                  const senderName = msg.sender?.emailAddress?.name || 'Unknown';
                  const senderAddr = msg.sender?.emailAddress?.address || '';
                  return (
                    <div key={msg.id} className={`thread-msg-entry ${isExpanded ? 'thread-msg-expanded' : 'thread-msg-collapsed'}`}>
                      {isExpanded ? (
                        <>
                          <div className="thread-msg-header" onClick={() => toggleMsgExpand(msg.id)} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && toggleMsgExpand(msg.id)}>
                            <div className="sender-avatar-large" style={{ width: 34, height: 34, fontSize: 13, flexShrink: 0 }}>
                              {senderName[0]?.toUpperCase() || 'U'}
                            </div>
                            <div className="thread-msg-header-meta">
                              <div className="sender-name-row">
                                <span className="sender-name">{senderName}</span>
                                <span className="sender-email">&lt;{senderAddr}&gt;</span>
                              </div>
                              <div className="recipient-row">
                                {t('email.to')}: {msg.toRecipients?.[0]?.emailAddress?.name || msg.toRecipients?.[0]?.emailAddress?.address || 'me'}
                              </div>
                            </div>
                            <div className="thread-msg-header-right">
                              <span className="email-detail-date">{formatEmailDateFull(msg.receivedDateTime)} {formatEmailTime(msg.receivedDateTime)}</span>
                              <span className="thread-expand-chevron">▲</span>
                            </div>
                          </div>
                          <div className="email-detail-body thread-msg-body">
                            <EmailContentRenderer body={msg.body || null} />
                          </div>
                        </>
                      ) : (
                        /* Collapsed: compact single-line row like Outlook */
                        <div
                          className="thread-msg-stub-row"
                          onClick={() => toggleMsgExpand(msg.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => e.key === 'Enter' && toggleMsgExpand(msg.id)}
                        >
                          <div className="sender-avatar-large" style={{ width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>
                            {senderName[0]?.toUpperCase() || 'U'}
                          </div>
                          <span className="stub-sender">{senderName}</span>
                          <span className="stub-preview">{msg.bodyPreview}</span>
                          <span className="stub-date">{formatEmailTime(msg.receivedDateTime)}</span>
                        </div>
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
                        placeholder={t('email.intentPlaceholder')}
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
                      <span>{t('email.doraWait')}</span>
                    </div>
                  )}

                  {aiDraft && !isDrafting && (
                    <div className="dora-draft-result-card">
                      <div className="dora-result-header">
                        <h6>{t('email.doraReplyTab')}</h6>
                        <button
                          className="use-draft-btn"
                          onClick={handleUseDraftAsReply}
                        >
                          {t('email.doraCopyDraft')}
                        </button>
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
