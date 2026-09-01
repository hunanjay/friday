import { useEffect } from 'react';
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvents,
  updateCalendarEvent,
} from './api';
import { calendarKeys } from './queryKeys';

const handledUnauthorizedErrors = new WeakSet();
const EMPTY_LIST = [];

function useCalendarAccess() {
  const { authToken, handleLogout, user } = useAuth();
  return {
    authToken,
    handleLogout,
    scope: user?.id || user?.email || 'anonymous',
  };
}

function logoutIfUnauthorized(error, handleLogout) {
  if (!isApiError(error) || error.status !== 401 || handledUnauthorizedErrors.has(error)) return;
  handledUnauthorizedErrors.add(error);
  void handleLogout();
}

export function useCalendarEvents({ start, end }) {
  const { authToken, handleLogout, scope } = useCalendarAccess();
  const queryClient = useQueryClient();
  const eventsKey = calendarKeys.events(scope);
  const queryKey = calendarKeys.eventRange(scope, start, end);
  const query = useQuery({
    queryKey,
    queryFn: () => getCalendarEvents(authToken, { start, end }),
    enabled: Boolean(authToken && start && end),
  });
  const createMutation = useMutation({
    mutationFn: event => createCalendarEvent(authToken, event),
    onSuccess: created => {
      queryClient.setQueryData(queryKey, previous => [...(previous || []), created]);
      void queryClient.invalidateQueries({ queryKey: eventsKey, refetchType: 'none' });
    },
    onError: error => logoutIfUnauthorized(error, handleLogout),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, ...changes }) => updateCalendarEvent(authToken, id, changes),
    onSuccess: updated => {
      queryClient.setQueryData(queryKey, previous => (
        previous || []
      ).map(event => (event.id === updated.id ? { ...event, ...updated } : event)));
      void queryClient.invalidateQueries({ queryKey: eventsKey, refetchType: 'none' });
    },
    onError: error => logoutIfUnauthorized(error, handleLogout),
  });
  const deleteMutation = useMutation({
    mutationFn: eventId => deleteCalendarEvent(authToken, eventId),
    onSuccess: eventId => {
      queryClient.setQueryData(queryKey, previous => (
        previous || []
      ).filter(event => event.id !== eventId));
      void queryClient.invalidateQueries({ queryKey: eventsKey, refetchType: 'none' });
    },
    onError: error => logoutIfUnauthorized(error, handleLogout),
  });

  useEffect(() => {
    logoutIfUnauthorized(query.error, handleLogout);
  }, [handleLogout, query.error]);

  return {
    events: query.data ?? EMPTY_LIST,
    addCalendarEvent: createMutation.mutateAsync,
    updateCalendarEvent: updateMutation.mutateAsync,
    deleteCalendarEvent: deleteMutation.mutateAsync,
    refetchCalendarEvents: query.refetch,
    calendarError: query.error,
    isCalendarError: query.isError,
    isLoadingCalendarEvents: Boolean(authToken && start && end) && query.isPending,
    isCreatingCalendarEvent: createMutation.isPending,
    isUpdatingCalendarEvent: updateMutation.isPending,
    isDeletingCalendarEvent: deleteMutation.isPending,
  };
}

export function useCalendarSyncStatus() {
  const { scope } = useCalendarAccess();
  return useIsFetching({ queryKey: calendarKeys.events(scope) }) > 0;
}
