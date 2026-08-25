import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  disconnectGitHub,
  EMPTY_GITHUB_REPOSITORIES,
  getGitHubRepositories,
  getGitHubStatus,
  githubConnectUrl,
  updateGitHubRepositories,
} from './api';
import { githubKeys } from './queryKeys';

function useGitHubAccess() {
  const { authToken, user } = useAuth();
  return {
    authToken,
    scope: user?.id || user?.email || 'anonymous',
  };
}

export function useGitHubConnection() {
  const { authToken, scope } = useGitHubAccess();
  const queryClient = useQueryClient();
  const statusKey = githubKeys.status(scope);
  const repositoriesKey = githubKeys.repositories(scope);
  const query = useQuery({
    queryKey: statusKey,
    queryFn: () => getGitHubStatus(authToken),
    enabled: Boolean(authToken),
  });
  const disconnectMutation = useMutation({
    mutationFn: () => disconnectGitHub(authToken),
    onSuccess: () => {
      queryClient.setQueryData(statusKey, { connected: false, expired: false });
      queryClient.setQueryData(repositoriesKey, EMPTY_GITHUB_REPOSITORIES);
    },
  });

  return {
    githubStatus: query.data ?? null,
    connectGitHub: () => {
      window.location.href = githubConnectUrl(authToken);
    },
    disconnectGitHub: disconnectMutation.mutateAsync,
    isLoadingGitHubStatus: Boolean(authToken) && query.isPending,
    isDisconnectingGitHub: disconnectMutation.isPending,
  };
}

export function useGitHubRepositories({ enabled = true } = {}) {
  const { authToken, scope } = useGitHubAccess();
  const queryClient = useQueryClient();
  const queryKey = githubKeys.repositories(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getGitHubRepositories(authToken),
    enabled: Boolean(authToken) && enabled,
  });
  const mutation = useMutation({
    mutationFn: repositories => updateGitHubRepositories(authToken, repositories),
    onSuccess: selected => {
      queryClient.setQueryData(queryKey, previous => ({
        available: previous?.available || [],
        selected,
      }));
    },
  });

  return {
    githubRepositories: query.data ?? EMPTY_GITHUB_REPOSITORIES,
    saveGitHubRepositories: mutation.mutateAsync,
    isLoadingGitHubRepositories: Boolean(authToken) && enabled && query.isPending,
    isSavingGitHubRepositories: mutation.isPending,
  };
}
