import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../supabaseClient';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8005';

const WorkspaceContext = createContext();

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

  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('messages');
    return saved ? JSON.parse(saved) : [];
  });

  const chatThreads = [
    { id: 'claude', name: 'Claude AI', description: 'Simulated AI Assistant', online: true },
    { id: 'friday', name: 'Project Friday', description: 'Team discussion channel', online: true },
    { id: 'lounge', name: 'General Lounge', description: 'Casual chit-chat', online: false }
  ];

  const [memos, setMemos] = useState(() => {
    const saved = localStorage.getItem('memos');
    return saved ? JSON.parse(saved) : [];
  });

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });

  // Toast State
  const [toast, setToast] = useState({ message: '', visible: false });

  const showToast = useCallback((message) => {
    setToast({ message, visible: true });
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
  useEffect(() => {
    localStorage.setItem('emails', JSON.stringify(emails));
  }, [emails]);

  useEffect(() => {
    localStorage.setItem('events', JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem('messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('memos', JSON.stringify(memos));
  }, [memos]);

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  // Supabase access token: sent to our backend so it can look up the
  // Microsoft Graph token it stored for this user (never held/used client-side).
  const [authToken, setAuthToken] = useState(null);

  // Surfaced globally (top marquee in MainLayout) instead of separate
  // per-page loading banners.
  const [isSyncingInbox, setIsSyncingInbox] = useState(false);
  const [isSyncingEvents, setIsSyncingEvents] = useState(false);

  // Apply Auth session
  useEffect(() => {
    const applySession = (session) => {
      if (!session) return;
      handleLogin({
        name: session.user.user_metadata?.full_name || session.user.email.split('@')[0],
        email: session.user.email,
        avatarUrl: session.user.user_metadata?.avatar_url,
      });
      setAuthToken(prev => (prev === session.access_token ? prev : session.access_token));
      // provider_token only comes back on fresh sign-in, not after a page reload;
      // hand it to the backend once so it can be reused across reloads.
      if (session.provider_token) {
        fetch(`${API_URL}/api/graph/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ ms_token: session.provider_token }),
        }).catch(() => {});
      }
    };

    // onAuthStateChange fires once immediately with the current session
    // (INITIAL_SESSION), so a separate getSession() call would double-fire
    // applySession on every mount.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const handleSyncInboxEmails = useCallback((inboxEmails) => {
    setEmails(prev => [...inboxEmails, ...prev.filter(e => e.parentFolderId !== 'inbox')]);
  }, []);

  const handleSyncEvents = useCallback((calendarEvents) => {
    setEvents(calendarEvents);
  }, []);

  const handleLogin = (userInfo) => {
    setUser(userInfo);
    localStorage.setItem('user', JSON.stringify(userInfo));
  };

  const handleLogout = () => {
    supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem('user');
  };

  // State modifiers
  const handleAddEmail = (email) => {
    setEmails(prev => [email, ...prev]);
  };

  const handleDeleteEmail = (id) => {
    setEmails(prev => prev.map(e => e.id === id ? { ...e, parentFolderId: 'trash' } : e));
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

  const handleAddMemo = (memo) => {
    setMemos(prev => [memo, ...prev]);
  };

  const handleUpdateMemo = (updatedMemo) => {
    setMemos(prev => prev.map(m => m.id === updatedMemo.id ? updatedMemo : m));
  };

  const handleDeleteMemo = (id) => {
    setMemos(prev => prev.filter(m => m.id !== id));
  };

  return (
    <WorkspaceContext.Provider
      value={{
        user,
        emails,
        events,
        messages,
        chatThreads,
        memos,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toast,
        showToast,
        authToken,
        isSyncingInbox,
        setIsSyncingInbox,
        isSyncingEvents,
        setIsSyncingEvents,
        handleSyncInboxEmails,
        handleSyncEvents,
        handleLogin,
        handleLogout,
        handleAddEmail,
        handleDeleteEmail,
        handleAddEvent,
        handleDeleteEvent,
        handleSendMessage,
        handleSimulateBotReply,
        handleAddMemo,
        handleUpdateMemo,
        handleDeleteMemo
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
