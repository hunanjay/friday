import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  bindMailAccount,
  getMailAccounts,
  getMailProviders,
  getMicrosoftMailStatus,
  unbindMailAccount,
  verifyMailAccount,
} from './accountsApi';
import { mailKeys } from './queryKeys';

function useMailAccess() {
  const { authToken, user } = useAuth();
  return {
    authToken,
    scope: user?.id || user?.email || 'anonymous',
  };
}

export function useMailAccounts() {
  const { authToken, scope } = useMailAccess();
  const queryClient = useQueryClient();
  const queryKey = mailKeys.accounts(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getMailAccounts(authToken),
    enabled: Boolean(authToken),
  });
  const bindMutation = useMutation({
    mutationFn: account => bindMailAccount(authToken, account),
    onSuccess: account => {
      queryClient.setQueryData(queryKey, previous => [...(previous || []), account]);
    },
  });
  const unbindMutation = useMutation({
    mutationFn: accountId => unbindMailAccount(authToken, accountId),
    onSuccess: accountId => {
      queryClient.setQueryData(queryKey, previous => (
        previous || []
      ).filter(account => account.id !== accountId));
    },
  });
  const verifyMutation = useMutation({
    mutationFn: accountId => verifyMailAccount(authToken, accountId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    mailAccounts: query.data ?? [],
    bindMailAccount: bindMutation.mutateAsync,
    unbindMailAccount: unbindMutation.mutateAsync,
    verifyMailAccount: verifyMutation.mutateAsync,
    refreshMailAccounts: query.refetch,
    isLoadingMailAccounts: Boolean(authToken) && query.isPending,
    isBindingMailAccount: bindMutation.isPending,
    isUnbindingMailAccount: unbindMutation.isPending,
    isVerifyingMailAccount: verifyMutation.isPending,
  };
}

export function useMailProviders({ enabled = true } = {}) {
  const { authToken } = useMailAccess();
  const query = useQuery({
    queryKey: mailKeys.providers(),
    queryFn: () => getMailProviders(authToken),
    enabled: Boolean(authToken) && enabled,
  });
  return {
    mailProviders: query.data ?? [],
    isLoadingMailProviders: Boolean(authToken) && enabled && query.isPending,
  };
}

export function useMicrosoftMailStatus() {
  const { authToken, scope } = useMailAccess();
  const query = useQuery({
    queryKey: mailKeys.microsoftStatus(scope),
    queryFn: () => getMicrosoftMailStatus(authToken),
    enabled: Boolean(authToken),
    refetchInterval: 5 * 60 * 1000,
  });
  return {
    microsoftMailStatus: query.data ?? null,
    msDisconnected: Boolean(query.data?.expired),
    isLoadingMicrosoftMailStatus: Boolean(authToken) && query.isPending,
  };
}
