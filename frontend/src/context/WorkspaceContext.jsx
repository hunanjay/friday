import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/useAuth';
import { useMailAccounts } from '../features/mail/accountHooks';
import { useUi } from '../hooks/useUi';
import { WorkspaceContext } from './workspace-context';

const API_URL = import.meta.env.VITE_API_URL || '';

// Safe localStorage.setItem: if the storage quota is exceeded (common with
// large inboxes), log a warning and keep the in-memory state intact rather
// than letting the unhandled QuotaExceededError crash the whole provider.
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      console.warn(`localStorage quota exceeded for key '${key}', skipping cache`);
    } else {
      throw err;
    }
  }
}

export function WorkspaceProvider({ children }) {
  const {
    user,
    authToken,
    isAuthReady,
    handleLogin,
    handleLogout,
  } = useAuth();
  const {
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    toast,
    showToast,
  } = useUi();
  const { mailAccounts } = useMailAccounts();

  const [emails, setEmails] = useState(() => {
    const saved = localStorage.getItem('emails');
    return saved ? JSON.parse(saved) : [];
  });

  const [events, setEvents] = useState(() => {
    const saved = localStorage.getItem('events');
    return saved ? JSON.parse(saved) : [];
  });

  // messages are no longer persisted to localStorage - they come from the
  // backend checkpoint (GET /api/agent/sessions/:id/messages) so they survive
  // cross-device / cross-browser sessions without a second source of truth.
  const [messages, setMessages] = useState([]);

  // Real chat sessions (thread_id for the LangGraph agent + Postgres
  // checkpointer), fetched from the backend rather than hardcoded.
  const [chatThreads, setChatThreads] = useState([]);

  // Sync to Local Storage
  // emails and events are cached for fast initial render; messages are NOT
  // cached here (they come from the backend checkpoint - see 1.1).
  useEffect(() => {
    safeSetItem('emails', JSON.stringify(emails));
  }, [emails]);

  useEffect(() => {
    safeSetItem('events', JSON.stringify(events));
  }, [events]);

  // Surfaced globally (top marquee in MainLayout) instead of separate
  // per-page loading banners.
  const [isSyncingInbox, setIsSyncingInbox] = useState(false);
  const [isSyncingEvents, setIsSyncingEvents] = useState(false);

  // Authoritative inbox unread count (Graph's unreadItemCount for the whole
  // mailbox), shared by the sidebar nav badge and the EmailPage folder badge
  // so both match Outlook rather than counting only the loaded page. null
  // until fetched; adjusted optimistically as mail is read/deleted.
  const [inboxUnread, setInboxUnread] = useState(null);
  const adjustInboxUnread = useCallback((delta) => {
    setInboxUnread(n => (n == null ? n : Math.max(0, n + delta)));
  }, []);

  // Auth owns the Supabase session. Keep the legacy workspace cache in sync
  // until each domain moves to its own query-backed feature module.
  useEffect(() => {
    if (!isAuthReady || authToken) return;
    setEmails([]);
    setEvents([]);
    setMessages([]);
  }, [authToken, isAuthReady]);

  useEffect(() => {
    if (!authToken) {
      setChatThreads([]);
      return;
    }
    fetch(`${API_URL}/api/agent/sessions`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { sessions: [] }))
      .then(data => setChatThreads(data.sessions || []))
      .catch(() => {});
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setInboxUnread(null);
      return;
    }
    // Authoritative unread count summed across Microsoft + every bound IMAP
    // account. Unbound channels return 404 and contribute 0.
    const unreadPromises = [
      fetch(`${API_URL}/api/graph/mail/folders/inbox`, {
        headers: { Authorization: `Bearer ${authToken}` },
      }).then(res => (res.ok ? res.json() : null)),
      ...(mailAccounts || []).map(acc =>
        fetch(`${API_URL}/api/mail-accounts/${acc.id}/mail/folders/inbox`, {
          headers: { Authorization: `Bearer ${authToken}` },
        }).then(res => (res.ok ? res.json() : null))
      ),
    ];
    Promise.all(unreadPromises)
      .then(results => {
        const total = results.reduce((sum, r) => sum + (r?.unread || 0), 0);
        setInboxUnread(total);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, mailAccounts]);

  const handleCreateSession = useCallback(async (title) => {
    const res = await fetch(`${API_URL}/api/agent/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ title }),
    });
    const session = await res.json();
    setChatThreads(prev => [session, ...prev]);
    return session;
  }, [authToken]);

  const handleUpdateSessionTitle = useCallback((sessionId, title) => {
    setChatThreads(prev => prev.map(s => (s.id === sessionId ? { ...s, title } : s)));
  }, []);

  const handleUpdateSessionPreview = useCallback((sessionId, preview) => {
    if (!preview) return;
    setChatThreads(prev => prev.map(s => (s.id === sessionId ? { ...s, preview } : s)));
  }, []);

  const handleDeleteSession = useCallback(async (sessionId) => {
    await fetch(`${API_URL}/api/agent/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    setChatThreads(prev => prev.filter(s => s.id !== sessionId));
    setMessages(prev => prev.filter(m => m.threadId !== sessionId));
  }, [authToken]);

  const handleSyncInboxEmails = useCallback((inboxEmails) => {
    setEmails(prev => [...inboxEmails, ...prev.filter(e => e.parentFolderId !== 'inbox')]);
  }, []);

  // Appends a "load more" page without disturbing already-synced inbox emails.
  const handleAppendInboxEmails = useCallback((inboxEmails) => {
    setEmails(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      return [...prev, ...inboxEmails.filter(e => !existingIds.has(e.id))];
    });
  }, []);

  const handleSyncSentEmails = useCallback((sentEmails) => {
    setEmails(prev => [...sentEmails, ...prev.filter(e => e.parentFolderId !== 'sent')]);
  }, []);

  // Appends a "load more" page without disturbing already-synced sent emails.
  const handleAppendSentEmails = useCallback((sentEmails) => {
    setEmails(prev => {
      const existingIds = new Set(prev.map(e => e.id));
      return [...prev, ...sentEmails.filter(e => !existingIds.has(e.id))];
    });
  }, []);

  const handleSyncEvents = useCallback((calendarEvents) => {
    setEvents(calendarEvents);
  }, []);

  // State modifiers
  const handleAddEmail = (email) => {
    setEmails(prev => [email, ...prev]);
  };

  const handleDeleteEmail = (id) => {
    setEmails(prev => prev.map(e => e.id === id ? { ...e, parentFolderId: 'trash' } : e));
  };

  const handleMarkEmailRead = (id, isRead = true) => {
    setEmails(prev => prev.map(e => e.id === id ? { ...e, isRead } : e));
  };

  const handleAddEvent = (event) => {
    setEvents(prev => [...prev, event]);
  };

  const handleDeleteEvent = (id) => {
    setEvents(prev => prev.filter(e => e.id !== id));
  };

  const handleSendMessage = (msg) => {
    setMessages(prev => [...prev, msg]);
  };

  const handleSimulateBotReply = (botMsg) => {
    setMessages(prev => [...prev, botMsg]);
  };

  const handleUpdateMessageText = useCallback((id, newText) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, text: newText } : m));
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        user,
        emails,
        events,
        messages,
        chatThreads,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toast,
        showToast,
        authToken,
        isSyncingInbox,
        setIsSyncingInbox,
        isSyncingEvents,
        setIsSyncingEvents,
        inboxUnread,
        adjustInboxUnread,
        handleSyncInboxEmails,
        handleAppendInboxEmails,
        handleSyncSentEmails,
        handleAppendSentEmails,
        handleSyncEvents,
        handleCreateSession,
        handleUpdateSessionTitle,
        handleUpdateSessionPreview,
        handleDeleteSession,
        handleLogin,
        handleLogout,
        handleAddEmail,
        handleDeleteEmail,
        handleMarkEmailRead,
        handleAddEvent,
        handleDeleteEvent,
        handleSendMessage,
        handleSimulateBotReply,
        handleUpdateMessageText
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
