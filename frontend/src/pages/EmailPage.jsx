import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../context/WorkspaceContext';
import { useTranslation } from 'react-i18next';
import { Mail, Send, Trash, Search, Plus, X, Sparkles } from '../components/common/Icons';
import EmailContentRenderer from '../components/common/EmailContentRenderer';
import EmailAttachments from '../components/common/EmailAttachments';
import ApprovalCard from '../components/common/ApprovalCard';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';
const THREAD_PREFETCH_DELAY_MS = 300;
const THREAD_CACHE_MAX_ENTRIES = 10;

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
    hasAttachments: Boolean(msg.hasAttachments),
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
  const threadCacheRef = useRef(new Map());
  const threadRequestsRef = useRef(new Map());
  const threadPrefetchTimersRef = useRef(new Map());
  const threadSelectionSequenceRef = useRef(0);
  // IDs of messages whose full body is expanded in the timeline view.
  const [expandedMsgIds, setExpandedMsgIds] = useState(new Set());

  useEffect(() => () => {
    threadPrefetchTimersRef.current.forEach(timer => window.clearTimeout(timer));
    threadPrefetchTimersRef.current.clear();
  }, []);

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
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  // Set by handleUseDraftAsReply - when present, submit hits Graph's
  // {id}/reply endpoint (keeps threading) instead of a fresh /send.
  const [replyToEmailId, setReplyToEmailId] = useState(null);
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

  const handleAttachmentChange = (e) => {
    const files = Array.from(e.target.files);
    const totalSize = files.reduce((acc, file) => acc + file.size, 0);
    if (totalSize > 3 * 1024 * 1024) {
      alert(i18n.language === 'zh' ? '目前基础附件总大小限制为 3MB' : 'Standard attachments total size limited to 3MB');
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
      composeAttachments.forEach(file => {
        formData.append('attachments', file);
      });

      const res = replyToEmailId
        ? await fetch(`${API_URL}/api/graph/mail/${encodeURIComponent(replyToEmailId)}/reply`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}` },
            body: formData,
          })
        : await fetch(`${API_URL}/api/graph/mail/send`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${authToken}` },
            body: formData,
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

  const getThreadResource = (threadRow) => {
    if (threadRow.conversationId) {
      return {
        key: `conversation:${threadRow.conversationId}`,
        url: `${API_URL}/api/graph/mail/conversation/${encodeURIComponent(threadRow.conversationId)}`,
        isConversation: true,
      };
    }
    return {
      key: `message:${threadRow.id}`,
      url: `${API_URL}/api/graph/mail/${encodeURIComponent(threadRow.id)}`,
      isConversation: false,
    };
  };

  const loadThread = (threadRow) => {
    const resource = getThreadResource(threadRow);
    if (threadCacheRef.current.has(resource.key)) {
      return Promise.resolve(threadCacheRef.current.get(resource.key));
    }

    const existingRequest = threadRequestsRef.current.get(resource.key);
    if (existingRequest) return existingRequest;

    const request = fetch(resource.url, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async res => {
        if (!res.ok) throw new Error(`Failed to load email thread (${res.status})`);
        const data = await res.json();
        return resource.isConversation ? (data.value || []) : [data];
      })
      .then(messages => {
        threadRequestsRef.current.delete(resource.key);
        if (threadCacheRef.current.size >= THREAD_CACHE_MAX_ENTRIES) {
          const oldestKey = threadCacheRef.current.keys().next().value;
          threadCacheRef.current.delete(oldestKey);
        }
        threadCacheRef.current.set(resource.key, messages);
        return messages;
      })
      .catch(error => {
        threadRequestsRef.current.delete(resource.key);
        throw error;
      });

    threadRequestsRef.current.set(resource.key, request);
    return request;
  };

  const prefetchThread = (threadRow) => {
    const { key } = getThreadResource(threadRow);
    const convKey = threadRow._threadKey || threadRow.conversationId || threadRow.id;
    if (
      convKey === selectedConvKey
      || threadCacheRef.current.has(key)
      || threadRequestsRef.current.has(key)
      || threadPrefetchTimersRef.current.has(key)
    ) return;

    // Debounce across the whole list: moving to another row cancels any
    // pending hover prefetch that has not started yet.
    threadPrefetchTimersRef.current.forEach((timer, pendingKey) => {
      if (pendingKey !== key) window.clearTimeout(timer);
    });
    threadPrefetchTimersRef.current.clear();

    const timer = window.setTimeout(() => {
      threadPrefetchTimersRef.current.delete(key);
      loadThread(threadRow).catch(() => {});
    }, THREAD_PREFETCH_DELAY_MS);
    threadPrefetchTimersRef.current.set(key, timer);
  };

  const cancelScheduledThreadPrefetch = (threadRow) => {
    const { key } = getThreadResource(threadRow);
    const timer = threadPrefetchTimersRef.current.get(key);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    threadPrefetchTimersRef.current.delete(key);
  };



  const handleSelectEmail = (threadRow) => {
    const convKey = threadRow._threadKey || threadRow.conversationId || threadRow.id;
    if (convKey === selectedConvKey) return; // already selected
    const selectionSequence = ++threadSelectionSequenceRef.current;
    cancelScheduledThreadPrefetch(threadRow);

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

    const { key: threadResourceKey } = getThreadResource(threadRow);
    const cachedMessages = threadCacheRef.current.get(threadResourceKey);
    const localReadState = new Map(emails.map(email => [email.id, email.isRead]));
    const applyThread = (msgs) => {
      if (selectionSequence !== threadSelectionSequenceRef.current) return;
      const unreadBeforeOpen = msgs
        .filter(msg => localReadState.has(msg.id) ? !localReadState.get(msg.id) : !msg.isRead)
        .map(msg => msg.id);
      const displayedMessages = msgs.map(msg => ({
        ...msg,
        isRead: readIds.has(msg.id)
          ? true
          : (localReadState.has(msg.id) ? localReadState.get(msg.id) : msg.isRead),
      }));
      setThreadMessages(displayedMessages);
      setExpandedMsgIds(
        unreadBeforeOpen.length > 0
          ? new Set(unreadBeforeOpen)
          : msgs.length > 0 ? new Set([msgs[msgs.length - 1].id]) : new Set()
      );
    };

    if (cachedMessages) {
      applyThread(cachedMessages);
      setIsLoadingThread(false);
      return;
    }

    setIsLoadingThread(true);
    loadThread(threadRow)
      .then(applyThread)
      .catch(() => {})
      .finally(() => {
        if (selectionSequence === threadSelectionSequenceRef.current) {
          setIsLoadingThread(false);
        }
      });
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
                  <button
                    className={`action-icon-btn dora-toggle-btn ${isDoraActive ? 'active' : ''}`}
                    onClick={() => setIsDoraActive(!isDoraActive)}
                  >
                    <Sparkles size={16} />
                    <span>{t('email.doraTitle')}</span>
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
                    <ApprovalCard
                      action={{
                        action_type: 'send_email',
                        payload: {
                          to: selectedEmail?.sender?.emailAddress?.address || selectedEmail?.sender?.emailAddress?.name,
                          subject: selectedEmail?.subject ? `Re: ${selectedEmail.subject}` : '',
                          body: aiDraft,
                        },
                      }}
                      title={t('email.doraReplyTab')}
                      statusLabel={t('email.doraDrafted')}
                      confirmText={t('email.doraCopyDraft')}
                      onConfirm={handleUseDraftAsReply}
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
