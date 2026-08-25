import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../api/client';
import { supabase } from '../../supabaseClient';
import { AuthContext } from './auth-context';
import { cacheUser, clearPrivateWorkspaceStorage, readCachedUser } from './storage';

function sessionUser(session) {
  const email = session.user.email;
  return {
    name: session.user.user_metadata?.full_name || email.split('@')[0],
    email,
    avatarUrl: session.user.user_metadata?.avatar_url,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readCachedUser);
  const [authToken, setAuthToken] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const sessionRevision = useRef(0);

  const handleLogin = useCallback((userInfo) => {
    setUser(userInfo);
    cacheUser(userInfo);
  }, []);

  const clearSession = useCallback(() => {
    clearPrivateWorkspaceStorage();
    setUser(null);
    setAuthToken(null);
  }, []);

  const handleLogout = useCallback(async () => {
    sessionRevision.current += 1;
    clearSession();
    setIsAuthReady(true);
    await supabase.auth.signOut();
  }, [clearSession]);

  useEffect(() => {
    let active = true;

    const applySession = async (session) => {
      const revision = ++sessionRevision.current;
      if (!session) {
        if (active) {
          clearSession();
          setIsAuthReady(true);
        }
        return;
      }

      handleLogin(sessionUser(session));

      // Supabase only exposes provider_token on a fresh OAuth sign-in. Persist
      // it before publishing authToken so workspace requests cannot race the
      // backend's Microsoft token storage.
      if (session.provider_token) {
        await apiRequest('/api/graph/token', {
          method: 'POST',
          token: session.access_token,
          body: {
            ms_token: session.provider_token,
            refresh_token: session.provider_refresh_token,
          },
        }).catch(() => {});
      }

      if (active && revision === sessionRevision.current) {
        setAuthToken(previous => (
          previous === session.access_token ? previous : session.access_token
        ));
        setIsAuthReady(true);
      }
    };

    // INITIAL_SESSION is emitted immediately, so a separate getSession call
    // would duplicate initialization and the provider-token handoff.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [clearSession, handleLogin]);

  const value = useMemo(() => ({
    user,
    authToken,
    isAuthReady,
    handleLogin,
    handleLogout,
  }), [authToken, handleLogin, handleLogout, isAuthReady, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
