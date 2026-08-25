import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  DEFAULT_ASSISTANT_NAME,
  getAssistantName,
  getAvatar,
  getAvatarPresets,
  getSignature,
  getTeamInfo,
  updateAssistantName,
  updateAvatar,
  updateSignature,
} from './api';
import { settingsKeys } from './queryKeys';

function useSettingsAccess() {
  const { authToken, user } = useAuth();
  return {
    authToken,
    scope: user?.id || user?.email || 'anonymous',
  };
}

export function useAssistantName() {
  const { authToken, scope } = useSettingsAccess();
  const queryClient = useQueryClient();
  const queryKey = settingsKeys.assistantName(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getAssistantName(authToken),
    enabled: Boolean(authToken),
  });
  const mutation = useMutation({
    mutationFn: name => updateAssistantName(authToken, name),
    onSuccess: name => queryClient.setQueryData(queryKey, name),
  });
  return {
    assistantName: query.data ?? DEFAULT_ASSISTANT_NAME,
    updateAssistantName: mutation.mutateAsync,
    isLoadingAssistantName: Boolean(authToken) && query.isPending,
    isUpdatingAssistantName: mutation.isPending,
  };
}

export function useSignature() {
  const { authToken, scope } = useSettingsAccess();
  const queryClient = useQueryClient();
  const queryKey = settingsKeys.signature(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getSignature(authToken),
    enabled: Boolean(authToken),
  });
  const mutation = useMutation({
    mutationFn: signature => updateSignature(authToken, signature),
    onSuccess: signature => queryClient.setQueryData(queryKey, signature),
  });
  return {
    signature: query.data ?? '',
    updateSignature: mutation.mutateAsync,
    isLoadingSignature: Boolean(authToken) && query.isPending,
    isUpdatingSignature: mutation.isPending,
  };
}

export function useAvatar() {
  const { authToken, scope } = useSettingsAccess();
  const queryClient = useQueryClient();
  const queryKey = settingsKeys.avatar(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getAvatar(authToken),
    enabled: Boolean(authToken),
  });
  const mutation = useMutation({
    mutationFn: avatarUrl => updateAvatar(authToken, avatarUrl),
    onSuccess: avatarUrl => queryClient.setQueryData(queryKey, avatarUrl),
  });
  return {
    avatarUrl: query.data ?? null,
    updateAvatar: mutation.mutateAsync,
    isLoadingAvatar: Boolean(authToken) && query.isPending,
    isUpdatingAvatar: mutation.isPending,
  };
}

export function useAvatarPresets() {
  const { authToken, scope } = useSettingsAccess();
  const query = useQuery({
    queryKey: settingsKeys.avatarPresets(scope),
    queryFn: () => getAvatarPresets(authToken),
    enabled: Boolean(authToken),
  });
  return {
    avatarPresets: query.data ?? [],
    isLoadingAvatarPresets: Boolean(authToken) && query.isPending,
  };
}

export function useTeamInfo() {
  const { authToken, scope } = useSettingsAccess();
  const query = useQuery({
    queryKey: settingsKeys.teamInfo(scope),
    queryFn: () => getTeamInfo(authToken),
    enabled: false,
  });
  return {
    teamInfo: query.data ?? null,
    isLoadingTeamInfo: query.isFetching,
    teamInfoError: query.isError,
    loadTeamInfo: () => {
      if (authToken) void query.refetch();
    },
  };
}
