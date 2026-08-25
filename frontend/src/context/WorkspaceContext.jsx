import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../features/auth/useAuth';
import { useUi } from '../hooks/useUi';
import { WorkspaceContext } from './workspace-context';

const API_URL = import.meta.env.VITE_API_URL || '';

export function WorkspaceProvider({ children }) {
  const {
    user,
    authToken,
    isAuthReady,
    handleLogin,
    handleLogout,
    handleSwitchAccount,
    handleMsLogout,
  } = useAuth();
  const {
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    toast,
    showToast,
  } = useUi();
  // messages are no longer persisted to localStorage - they come from the
  // backend checkpoint (GET /api/agent/sessions/:id/messages) so they survive
  // cross-device / cross-browser sessions without a second source of truth.
  const [messages, setMessages] = useState([]);

  // Real chat sessions (thread_id for the LangGraph agent + Postgres
  // checkpointer), fetched from the backend rather than hardcoded.
  const [chatThreads, setChatThreads] = useState([]);

  // Auth owns the Supabase session. Keep the legacy workspace cache in sync
  // until each domain moves to its own query-backed feature module.
  useEffect(() => {
    if (!isAuthReady || authToken) return;
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
        messages,
        chatThreads,
        isSidebarCollapsed,
        setIsSidebarCollapsed,
        toast,
        showToast,
        authToken,
        handleCreateSession,
        handleUpdateSessionTitle,
        handleUpdateSessionPreview,
        handleDeleteSession,
        handleLogin,
        handleLogout,
        handleSwitchAccount,
        handleMsLogout,
        handleSendMessage,
        handleSimulateBotReply,
        handleUpdateMessageText
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
