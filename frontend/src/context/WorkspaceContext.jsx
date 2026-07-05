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

  // Microsoft Graph Outlook Mail API Mock Structure
  const [emails, setEmails] = useState(() => {
    const saved = localStorage.getItem('emails');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'email_1',
        subject: 'Welcome to your Claude Suite Workspace 🪶',
        bodyPreview: 'Hello! Welcome to your brand new workspace. This suite brings together Email, Calendar...',
        body: {
          content: `Hello! Welcome to your brand new workspace.\n\nThis suite brings together Email, Calendar, Chat, and Memos in one unified, Claude-inspired experience.\n\nHere are a few things you can do here:\n1. Check your email, compose new ones, and read threads.\n2. Add events to your calendar in the Calendar tab.\n3. Chat with an interactive simulation of Claude in the Chat tab!\n4. Capture notes and thoughts in the Memos tab.\n\nEverything is backed up in your browser's local storage so it persists between reloads.\n\nExplore around and let us know what you think!`,
          contentType: 'text'
        },
        sender: {
          emailAddress: {
            name: 'Claude AI',
            address: 'claude@anthropic.com'
          }
        },
        toRecipients: [
          {
            emailAddress: {
              name: 'User',
              address: 'user@workspace.com'
            }
          }
        ],
        receivedDateTime: '2026-07-05T10:30:00Z',
        isRead: false,
        parentFolderId: 'inbox'
      },
      {
        id: 'email_2',
        subject: 'Draft UI/UX mockups for review',
        bodyPreview: "Hey team! I've uploaded the draft mockups for the new landing page. We are going with a...",
        body: {
          content: `Hey team!\n\nI've uploaded the draft mockups for the new landing page. We are going with a warm, minimalist palette based on the feedback we got last week.\n\nLet me know if the font sizes feel right and if the transitions are smooth enough. We really want to hit that cozy paper-like feel.`,
          contentType: 'text'
        },
        sender: {
          emailAddress: {
            name: 'Sarah (Design)',
            address: 'sarah.design@company.com'
          }
        },
        toRecipients: [
          {
            emailAddress: {
              name: 'User',
              address: 'user@workspace.com'
            }
          }
        ],
        receivedDateTime: '2026-07-05T09:15:00Z',
        isRead: false,
        parentFolderId: 'inbox'
      },
      {
        id: 'email_3',
        subject: 'Vite dev server successfully deployed',
        bodyPreview: 'Your workspace is live on port 5173. The hot module replacement (HMR) is active...',
        body: {
          content: `Your workspace is live on port 5173. The hot module replacement (HMR) is active.\n\nThe application builds cleanly and is optimized for the web. Ready for deployment.`,
          contentType: 'text'
        },
        sender: {
          emailAddress: {
            name: 'Antigravity System',
            address: 'system@antigravity.internal'
          }
        },
        toRecipients: [
          {
            emailAddress: {
              name: 'User',
              address: 'user@workspace.com'
            }
          }
        ],
        receivedDateTime: '2026-07-04T18:00:00Z',
        isRead: true,
        parentFolderId: 'inbox'
      }
    ];
  });

  // Microsoft Graph Outlook Calendar API Mock Structure
  const [events, setEvents] = useState(() => {
    const saved = localStorage.getItem('events');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'event_1',
        subject: 'Team Sync Meeting 💼',
        start: {
          dateTime: '2026-07-05T10:00:00',
          timeZone: 'UTC'
        },
        end: {
          dateTime: '2026-07-05T11:30:00',
          timeZone: 'UTC'
        },
        body: {
          content: 'Weekly alignment, sprint planning, and frontend review.',
          contentType: 'text'
        },
        categories: ['Work'],
        location: {
          displayName: 'Microsoft Teams Room'
        }
      },
      {
        id: 'event_2',
        subject: 'Fix production bug 🐞',
        start: {
          dateTime: '2026-07-05T15:00:00',
          timeZone: 'UTC'
        },
        end: {
          dateTime: '2026-07-05T16:30:00',
          timeZone: 'UTC'
        },
        body: {
          content: 'Review logs and patch authentication check error.',
          contentType: 'text'
        },
        categories: ['Urgent'],
        location: {
          displayName: 'Online - Meet'
        }
      },
      {
        id: 'event_3',
        subject: 'Doctor Appointment 🩺',
        start: {
          dateTime: '2026-07-08T14:00:00',
          timeZone: 'UTC'
        },
        end: {
          dateTime: '2026-07-08T15:00:00',
          timeZone: 'UTC'
        },
        body: {
          content: 'Routine annual checkup at the clinic.',
          contentType: 'text'
        },
        categories: ['Personal'],
        location: {
          displayName: 'Central Clinic'
        }
      },
      {
        id: 'event_4',
        subject: 'Study AI Agents 📚',
        start: {
          dateTime: '2026-07-10T19:00:00',
          timeZone: 'UTC'
        },
        end: {
          dateTime: '2026-07-10T21:00:00',
          timeZone: 'UTC'
        },
        body: {
          content: 'Read the Google Antigravity SDK manuals and run mock simulations.',
          contentType: 'text'
        },
        categories: ['Study'],
        location: {
          displayName: 'Study Room'
        }
      }
    ];
  });

  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('messages');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'msg_1',
        threadId: 'claude',
        sender: 'bot',
        senderName: 'Claude AI',
        text: 'Welcome to your Workspace Chat! I am Claude, your virtual assistant. Ask me anything about your emails, calendar events, or memos!',
        timestamp: '10:00 AM'
      },
      {
        id: 'msg_2',
        threadId: 'friday',
        sender: 'member',
        senderName: 'Sarah (Design)',
        text: 'Hey guys, I have uploaded the mockups. Please review them when you have a moment!',
        timestamp: '10:15 AM'
      },
      {
        id: 'msg_3',
        threadId: 'friday',
        sender: 'member',
        senderName: 'Alex (Backend)',
        text: 'Awesome work Sarah, I will check them after I finish updating the database schemas.',
        timestamp: '10:20 AM'
      }
    ];
  });

  const chatThreads = [
    { id: 'claude', name: 'Claude AI', description: 'Simulated AI Assistant', online: true },
    { id: 'friday', name: 'Project Friday', description: 'Team discussion channel', online: true },
    { id: 'lounge', name: 'General Lounge', description: 'Casual chit-chat', online: false }
  ];

  const [memos, setMemos] = useState(() => {
    const saved = localStorage.getItem('memos');
    if (saved) return JSON.parse(saved);
    return [
      {
        id: 'memo_1',
        title: 'Project Ideas 💡',
        content: `1. Create a beautiful dashboard with warm colors.\n2. Add simulated AI chatbot responses.\n3. Make it fully responsive and light/dark theme switchable.\n4. Ensure forms conform to autofill best practices.`,
        category: 'ideas',
        color: 'amber',
        pinned: true,
        updatedAt: Date.now() - 3600000,
        dateStr: 'Jul 5, 2026'
      },
      {
        id: 'memo_2',
        title: 'Meeting Notes - Jul 5',
        content: `Discussed: UI revamp referencing Claude.\nTasks:\n- Logan to design icons and layout.\n- Alex to configure Vite environments.`,
        category: 'work',
        color: 'beige',
        pinned: false,
        updatedAt: Date.now() - 7200000,
        dateStr: 'Jul 5, 2026'
      },
      {
        id: 'memo_3',
        title: 'React 19 Hooks',
        content: `Keep an eye on the new useActionState and useFormStatus hooks for future forms updates!`,
        category: 'snippets',
        color: 'purple',
        pinned: false,
        updatedAt: Date.now() - 86400000,
        dateStr: 'Jul 4, 2026'
      }
    ];
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

  // Apply Auth session
  useEffect(() => {
    const applySession = (session) => {
      if (!session) return;
      handleLogin({
        name: session.user.user_metadata?.full_name || session.user.email.split('@')[0],
        email: session.user.email,
        avatarUrl: session.user.user_metadata?.avatar_url,
      });
      setAuthToken(session.access_token);
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

    supabase.auth.getSession().then(({ data: { session } }) => applySession(session));

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
