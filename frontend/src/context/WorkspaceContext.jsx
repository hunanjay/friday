import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { WorkspaceContext } from './workspace-context';

const API_URL = import.meta.env.VITE_API_URL || '';

// All keys written to localStorage for this app's workspace data.
// Clearing all of them on logout prevents a subsequent user on the same
// machine from reading prior session data via DevTools.
const _WORKSPACE_KEYS = ['user', 'emails', 'events', 'messages'];

function clearWorkspaceStorage() {
  _WORKSPACE_KEYS.forEach(k => localStorage.removeItem(k));
}

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

// Backend returns updated_at as an ISO string; MemosPage sorts/displays via
// the derived updatedAt (epoch ms) and dateStr fields it already expects.
function mapMemo(memo) {
  return {
    ...memo,
    updatedAt: Date.parse(memo.updated_at),
    dateStr: new Date(memo.updated_at).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}

export function WorkspaceProvider({ children }) {
  // User state
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

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

  // Memos are backend-persisted (Postgres + Qdrant hybrid search index), not
  // localStorage - fetched once authToken is available (see effect below).
  const [memos, setMemos] = useState([]);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  // Toast State
  const [toast, setToast] = useState({ message: '', visible: false });

  const showToast = useCallback((message) => {
    setToast({ message, visible: true });
  }, []);

  const handleLogin = useCallback((userInfo) => {
    setUser(userInfo);
    localStorage.setItem('user', JSON.stringify(userInfo));
  }, []);

  const handleLogout = useCallback(() => {
    supabase.auth.signOut();
    // Wipe all workspace data from both memory and localStorage so the next
    // user on this machine can't see prior session data.
    clearWorkspaceStorage();
    setUser(null);
    setEmails([]);
    setEvents([]);
    setMessages([]);
  }, []);

  useEffect(() => {
    if (toast.visible) {
      const timer = setTimeout(() => {
        setToast({ message: '', visible: false });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.visible]);

  // Sync to Local Storage
  // emails and events are cached for fast initial render; messages are NOT
  // cached here (they come from the backend checkpoint - see 1.1).
  useEffect(() => {
    safeSetItem('emails', JSON.stringify(emails));
  }, [emails]);

  useEffect(() => {
    safeSetItem('events', JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  // Supabase access token: sent to our backend so it can look up the
  // Microsoft Graph token it stored for this user (never held/used client-side).
  const [authToken, setAuthToken] = useState(null);

  // { connected: bool } | null (null = not checked yet). No polling like the
  // Graph status check below - GitHub OAuth App tokens don't expire, only
  // get revoked, so a one-shot check on load is enough.
  const [githubStatus, setGithubStatus] = useState(null);

  // All bound IMAP/SMTP mail accounts (sanitized views, never contain
  // credentials). Fetched on login; mutated by bind/unbind/verify handlers.
  const [mailAccounts, setMailAccounts] = useState([]);

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

  // Apply Auth session
  useEffect(() => {
    const applySession = async (session) => {
      if (!session) {
        // Supabase session gone (expired refresh_token, signed out elsewhere,
        // or never logged in) - wipe all cached workspace data so a subsequent
        // user on the same machine can't read it from DevTools / localStorage.
        clearWorkspaceStorage();
        setUser(null);
        setEmails([]);
        setEvents([]);
        setMessages([]);
        setAuthToken(null);
        return;
      }
      handleLogin({
        name: session.user.user_metadata?.full_name || session.user.email.split('@')[0],
        email: session.user.email,
        avatarUrl: session.user.user_metadata?.avatar_url,
      });
      // provider_token only comes back on fresh sign-in, not after a page reload;
      // hand it (plus the refresh_token, if Microsoft granted one) to the
      // backend once so it can refresh silently and reuse it across reloads.
      // Awaited (not fire-and-forget) so setAuthToken below can't fire the
      // /api/graph/status check before the fresh token is actually persisted -
      // that race used to make the status check see the old expired token,
      // self-inflict a logout right after a successful sign-in, and force the
      // user to log in a second time.
      if (session.provider_token) {
        await fetch(`${API_URL}/api/graph/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            ms_token: session.provider_token,
            refresh_token: session.provider_refresh_token,
          }),
        }).catch(() => {});
      }
      setAuthToken(prev => (prev === session.access_token ? prev : session.access_token));
    };

    // onAuthStateChange fires once immediately with the current session
    // (INITIAL_SESSION), so a separate getSession() call would double-fire
    // applySession on every mount.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, [handleLogin]);

  // Periodically confirm the backend can still use the stored Microsoft
  // token (it silently refreshes on our behalf). If the Microsoft connection
  // is unrecoverable, we DO NOT sign the user out - mail providers are now
  // decoupled from the Friday account (see #11). We only flag the Microsoft
  // mailbox as disconnected so the UI can show "Microsoft 邮箱已断开".
  const [msDisconnected, setMsDisconnected] = useState(false);
  useEffect(() => {
    if (!authToken) {
      setMsDisconnected(false);
      return;
    }
    const checkStatus = () => {
      fetch(`${API_URL}/api/graph/status`, {
        headers: { Authorization: `Bearer ${authToken}` },
      })
        .then(res => res.json())
        .then(data => {
          if (data.expired) setMsDisconnected(true);
          else if (data.connected) setMsDisconnected(false);
        })
        .catch(() => {});
    };
    checkStatus();
    const interval = setInterval(checkStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [authToken]);

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

  useEffect(() => {
    if (!authToken) {
      setMemos([]);
      return;
    }
    fetch(`${API_URL}/api/memos`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { memos: [] }))
      .then(data => setMemos((data.memos || []).map(mapMemo)))
      .catch(() => {});
  }, [authToken]);

  const [assistantName, setAssistantName] = useState('Friday');
  useEffect(() => {
    if (!authToken) {
      setAssistantName('Friday');
      return;
    }
    fetch(`${API_URL}/api/settings/assistant-name`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => data?.assistant_name && setAssistantName(data.assistant_name))
      .catch(() => {});
  }, [authToken]);

  useEffect(() => {
    document.title = assistantName;
  }, [assistantName]);

  const handleUpdateAssistantName = useCallback(async (name) => {
    const res = await fetch(`${API_URL}/api/settings/assistant-name`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ assistant_name: name }),
    });
    if (!res.ok) throw new Error('Failed to update assistant name');
    const data = await res.json();
    setAssistantName(data.assistant_name);
    return data.assistant_name;
  }, [authToken]);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarPresets, setAvatarPresets] = useState([]);
  useEffect(() => {
    if (!authToken) {
      setAvatarUrl(null);
      setAvatarPresets([]);
      return;
    }
    fetch(`${API_URL}/api/settings/avatar`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => setAvatarUrl(data?.avatar_url ?? null))
      .catch(() => {});
    fetch(`${API_URL}/api/settings/avatar-presets`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { presets: [] }))
      .then(data => setAvatarPresets(data.presets || []))
      .catch(() => {});
  }, [authToken]);

  const handleUpdateAvatar = useCallback(async (url) => {
    const res = await fetch(`${API_URL}/api/settings/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ avatar_url: url }),
    });
    if (!res.ok) throw new Error('Failed to update avatar');
    const data = await res.json();
    setAvatarUrl(data.avatar_url);
    return data.avatar_url;
  }, [authToken]);

  useEffect(() => {
    if (!authToken) {
      setGithubStatus(null);
      return;
    }
    fetch(`${API_URL}/api/github/status`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => data && setGithubStatus(data))
      .catch(() => {});
  }, [authToken]);

  // Bound IMAP/SMTP mail accounts: one-shot fetch on login (credentials are
  // stored encrypted server-side; the API never returns them).
  useEffect(() => {
    if (!authToken) {
      setMailAccounts([]);
      return;
    }
    fetch(`${API_URL}/api/mail-accounts`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : { accounts: [] }))
      .then(data => setMailAccounts(data.accounts || []))
      .catch(() => {});
  }, [authToken]);

  const handleBindMailAccount = useCallback(async (body) => {
    const res = await fetch(`${API_URL}/api/mail-accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Failed to bind mail account');
    setMailAccounts(prev => [...prev, data.account]);
    return data.account;
  }, [authToken]);

  const handleUnbindMailAccount = useCallback(async (accountId) => {
    const res = await fetch(`${API_URL}/api/mail-accounts/${accountId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error('Failed to unbind mail account');
    setMailAccounts(prev => prev.filter(a => a.id !== accountId));
  }, [authToken]);

  // Re-fetch the account list. BindMailAccountModal performs its own POST, so
  // after a successful bind we refresh here instead of duplicating the call.
  const handleRefreshMailAccounts = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/mail-accounts`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const data = await res.json().catch(() => ({ accounts: [] }));
    setMailAccounts(data.accounts || []);
  }, [authToken]);

  const handleVerifyMailAccount = useCallback(async (accountId) => {
    const res = await fetch(`${API_URL}/api/mail-accounts/${accountId}/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error('Verification failed');
    return res.json();
  }, [authToken]);

  // Prefetched as soon as GitHub is known to be connected, not lazily when
  // the settings panel opens - so opening it never shows a loading flash.
  const [githubRepos, setGithubRepos] = useState({ available: [], selected: [] });
  useEffect(() => {
    if (!authToken || !githubStatus?.connected) {
      setGithubRepos({ available: [], selected: [] });
      return;
    }
    fetch(`${API_URL}/api/github/repos`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => data && setGithubRepos({ available: data.repos || [], selected: data.selected || [] }))
      .catch(() => {});
  }, [authToken, githubStatus?.connected]);

  const handleSaveGithubRepos = useCallback(async (repos) => {
    await fetch(`${API_URL}/api/github/repos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ repos }),
    });
    setGithubRepos(prev => ({ ...prev, selected: repos }));
  }, [authToken]);

  // Not supabase.auth.linkIdentity() - that only verifies a second identity
  // for login purposes and doesn't hand back a usable GitHub API token. This
  // is a plain browser navigation into GitHub's own OAuth flow, handled
  // entirely by the backend (see api/github_auth.py's /connect + /callback).
  const handleConnectGithub = useCallback(() => {
    window.location.href = `${API_URL}/api/github/connect?token=${encodeURIComponent(authToken)}`;
  }, [authToken]);

  const handleDisconnectGithub = useCallback(async () => {
    await fetch(`${API_URL}/api/github/token`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    }).catch(() => {});
    setGithubStatus({ connected: false, expired: false });
    setGithubRepos({ available: [], selected: [] });
  }, [authToken]);

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

  // `memo` here is the editable fields only (title/content/category/color) -
  // the backend assigns id/pinned/updated_at.
  const handleAddMemo = useCallback(async (memo) => {
    const res = await fetch(`${API_URL}/api/memos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(memo),
    });
    const created = mapMemo(await res.json());
    setMemos(prev => [created, ...prev]);
    return created;
  }, [authToken]);

  const handleUpdateMemo = useCallback(async (updatedMemo) => {
    const res = await fetch(`${API_URL}/api/memos/${updatedMemo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(updatedMemo),
    });
    const saved = mapMemo(await res.json());
    setMemos(prev => prev.map(m => m.id === saved.id ? saved : m));
    return saved;
  }, [authToken]);

  const handleDeleteMemo = useCallback(async (id) => {
    await fetch(`${API_URL}/api/memos/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    setMemos(prev => prev.filter(m => m.id !== id));
  }, [authToken]);

  return (
    <WorkspaceContext.Provider
      value={{
        user,
        emails,
        events,
        messages,
        chatThreads,
        memos,
        assistantName,
        handleUpdateAssistantName,
        avatarUrl,
        avatarPresets,
        handleUpdateAvatar,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toast,
        showToast,
        authToken,
        mailAccounts,
        handleBindMailAccount,
        handleUnbindMailAccount,
        handleVerifyMailAccount,
        handleRefreshMailAccounts,
        msDisconnected,
        githubStatus,
        handleConnectGithub,
        handleDisconnectGithub,
        githubRepos,
        handleSaveGithubRepos,
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
        handleUpdateMessageText,
        handleAddMemo,
        handleUpdateMemo,
        handleDeleteMemo
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
