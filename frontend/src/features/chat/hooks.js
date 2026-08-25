import { useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import { createChatSession, deleteChatSession, getChatSessions } from './api';
import { chatKeys } from './queryKeys';

const handledUnauthorizedErrors = new WeakSet();
const EMPTY_LIST = [];

function logoutIfUnauthorized(error, handleLogout) {
  if (!isApiError(error) || error.status !== 401 || handledUnauthorizedErrors.has(error)) return;
  handledUnauthorizedErrors.add(error);
  void handleLogout();
}

export function useChatSessions() {
  const { authToken, handleLogout, user } = useAuth();
  const scope = user?.id || user?.email || 'anonymous';
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => chatKeys.sessions(scope), [scope]);
  const query = useQuery({
    queryKey,
    queryFn: () => getChatSessions(authToken),
    enabled: Boolean(authToken),
  });
  const createMutation = useMutation({
    mutationFn: title => createChatSession(authToken, title),
    onSuccess: session => {
      queryClient.setQueryData(queryKey, previous => [
        session,
        ...(previous || []).filter(item => item.id !== session.id),
      ]);
    },
    onError: error => logoutIfUnauthorized(error, handleLogout),
  });
  const deleteMutation = useMutation({
    mutationFn: sessionId => deleteChatSession(authToken, sessionId),
    onSuccess: sessionId => {
      queryClient.setQueryData(queryKey, previous => (
        previous || []
      ).filter(session => session.id !== sessionId));
      queryClient.removeQueries({ queryKey: chatKeys.session(scope, sessionId) });
    },
    onError: error => logoutIfUnauthorized(error, handleLogout),
  });

  useEffect(() => {
    logoutIfUnauthorized(query.error, handleLogout);
  }, [handleLogout, query.error]);

  const updateChatSession = useCallback((sessionId, update) => {
    queryClient.setQueryData(queryKey, previous => (
      previous || []
    ).map(session => (session.id === sessionId ? { ...session, ...update } : session)));
  }, [queryClient, queryKey]);

  const updateChatSessionTitle = useCallback((sessionId, title) => {
    updateChatSession(sessionId, { title });
  }, [updateChatSession]);

  const updateChatSessionPreview = useCallback((sessionId, preview) => {
    if (preview) updateChatSession(sessionId, { preview });
  }, [updateChatSession]);

  return {
    chatSessions: query.data ?? EMPTY_LIST,
    createChatSession: createMutation.mutateAsync,
    deleteChatSession: deleteMutation.mutateAsync,
    updateChatSessionTitle,
    updateChatSessionPreview,
    refetchChatSessions: query.refetch,
    chatSessionsError: query.error,
    isLoadingChatSessions: Boolean(authToken) && query.isPending,
    isCreatingChatSession: createMutation.isPending,
    isDeletingChatSession: deleteMutation.isPending,
  };
}
