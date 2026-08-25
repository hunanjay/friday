import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isApiError } from '../../api/errors';
import { useAuth } from '../auth/useAuth';
import { useMailAccounts } from '../mail/accountHooks';
import { useMailMessages } from '../mail/mailboxHooks';
import {
  getMailFolderPage,
  MICROSOFT_MAIL_CHANNEL,
  normalizeMailMessage,
} from '../mail/mailboxApi';
import { dashboardKeys } from './queryKeys';

export function useDashboardInbox() {
  const { authToken, handleLogout, user } = useAuth();
  const { mailAccounts } = useMailAccounts();
  const { syncInboxEmails } = useMailMessages();
  const scope = user?.id || user?.email || 'anonymous';
  const accountIds = useMemo(
    () => mailAccounts.map(account => account.id),
    [mailAccounts],
  );
  const channels = useMemo(
    () => [MICROSOFT_MAIL_CHANNEL, ...accountIds],
    [accountIds],
  );
  const query = useQuery({
    queryKey: dashboardKeys.inbox(scope, accountIds),
    enabled: Boolean(authToken),
    queryFn: async () => {
      const results = await Promise.allSettled(
        channels.map(channel => getMailFolderPage(authToken, { channel, folder: 'inbox' })),
      );
      const unauthorized = results.find(result => (
        result.status === 'rejected'
          && isApiError(result.reason)
          && result.reason.status === 401
      ));
      if (unauthorized) {
        void handleLogout();
        throw unauthorized.reason;
      }
      const pages = results
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
      if (pages.length === 0 && results.length > 0) {
        throw results[0].reason;
      }
      return pages.flatMap(page => (
        (page?.value || []).map(message => normalizeMailMessage(message, 'inbox'))
      ));
    },
  });

  useEffect(() => {
    if (query.data) syncInboxEmails(query.data);
  }, [query.data, syncInboxEmails]);

  return {
    inboxError: query.isError,
    isLoadingInbox: Boolean(authToken) && query.isPending,
    refetchInbox: query.refetch,
  };
}
