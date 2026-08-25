import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { useMailAccounts } from './accountHooks';
import { getInboxUnread } from './mailboxApi';
import { mailKeys } from './queryKeys';

function useMailAccess() {
  const { authToken, user } = useAuth();
  return {
    authToken,
    scope: user?.id || user?.email || 'anonymous',
  };
}

export function useMailMessages() {
  const { scope } = useMailAccess();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => mailKeys.messages(scope), [scope]);
  const query = useQuery({
    queryKey,
    queryFn: async () => [],
    enabled: false,
    initialData: [],
    staleTime: Infinity,
  });
  useEffect(() => {
    localStorage.removeItem('emails');
  }, []);
  const update = useCallback(
    updater => queryClient.setQueryData(queryKey, previous => updater(previous || [])),
    [queryClient, queryKey],
  );
  const syncFolderEmails = useCallback((folder, emails) => update(previous => [
    ...emails,
    ...previous.filter(email => email.parentFolderId !== folder),
  ]), [update]);
  const syncInboxEmails = useCallback(emails => syncFolderEmails('inbox', emails), [syncFolderEmails]);
  const syncSentEmails = useCallback(emails => syncFolderEmails('sent', emails), [syncFolderEmails]);
  const appendEmails = useCallback(emails => update(previous => {
    const existingIds = new Set(previous.map(email => email.id));
    return [...previous, ...emails.filter(email => !existingIds.has(email.id))];
  }), [update]);
  const addEmail = useCallback(email => update(previous => [email, ...previous]), [update]);
  const moveEmailToTrash = useCallback(emailId => update(previous => previous.map(email => (
    email.id === emailId ? { ...email, parentFolderId: 'trash' } : email
  ))), [update]);
  const markEmailRead = useCallback((emailId, isRead = true) => update(previous => previous.map(email => (
    email.id === emailId ? { ...email, isRead } : email
  ))), [update]);

  return {
    emails: query.data,
    syncFolderEmails,
    syncInboxEmails,
    syncSentEmails,
    appendEmails,
    addEmail,
    moveEmailToTrash,
    markEmailRead,
  };
}

export function useInboxUnread() {
  const { authToken, scope } = useMailAccess();
  const { mailAccounts } = useMailAccounts();
  const queryClient = useQueryClient();
  const accountIds = useMemo(
    () => mailAccounts.map(account => account.id).sort(),
    [mailAccounts],
  );
  const queryKey = useMemo(
    () => mailKeys.inboxUnread(scope, accountIds),
    [accountIds, scope],
  );
  const query = useQuery({
    queryKey,
    queryFn: () => getInboxUnread(authToken, accountIds),
    enabled: Boolean(authToken),
  });

  const adjustInboxUnread = useCallback(
    delta => queryClient.setQueryData(queryKey, previous => (
      previous == null ? previous : Math.max(0, previous + delta)
    )),
    [queryClient, queryKey],
  );

  return {
    inboxUnread: query.data ?? null,
    adjustInboxUnread,
    isLoadingInboxUnread: Boolean(authToken) && query.isPending,
  };
}

export function useMailSyncStatus() {
  const { scope } = useMailAccess();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => mailKeys.syncingInbox(scope), [scope]);
  const query = useQuery({
    queryKey,
    queryFn: async () => false,
    enabled: false,
    initialData: false,
    staleTime: Infinity,
  });
  const setIsSyncingInbox = useCallback(
    value => queryClient.setQueryData(queryKey, Boolean(value)),
    [queryClient, queryKey],
  );
  return {
    isSyncingInbox: query.data,
    setIsSyncingInbox,
  };
}
