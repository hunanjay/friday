import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  createSignature,
  DEFAULT_ASSISTANT_NAME,
  deleteSignature,
  getAssistantName,
  getAvatar,
  getAvatarPresets,
  getSignatures,
  getTeamInfo,
  getUsageStats,
  setDefaultSignature,
  updateAssistantName,
  updateAvatar,
  updateSignature,
} from './api';
import { settingsKeys } from './queryKeys';

const EMPTY_LIST = [];

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

function useSignatureQuery() {
  const { authToken, scope } = useSettingsAccess();
  const queryKey = settingsKeys.signatures(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getSignatures(authToken),
    enabled: Boolean(authToken),
  });
  return { authToken, queryKey, query };
}

/** The block that actually gets appended - what the compose and approval
 *  previews need. A selector over the same list the manager reads, so opening
 *  Settings does not refetch what the mail page already has. */
export function useSignature() {
  const { authToken, query } = useSignatureQuery();
  const signatures = query.data ?? EMPTY_LIST;
  return {
    signature: signatures.find(item => item.is_default)?.content ?? '',
    isLoadingSignature: Boolean(authToken) && query.isPending,
  };
}

// Every write can change more rows than it names - creating the first template
// makes it default, deleting the default promotes another - so each one
// refetches the list rather than patching the cache from its own response.
function useSignatureWrite(queryKey, mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });
}

export function useSignatures() {
  const { authToken, queryKey, query } = useSignatureQuery();
  const create = useSignatureWrite(queryKey, fields => createSignature(authToken, fields));
  const update = useSignatureWrite(queryKey, ({ id, ...fields }) => updateSignature(authToken, id, fields));
  const setDefault = useSignatureWrite(queryKey, id => setDefaultSignature(authToken, id));
  const remove = useSignatureWrite(queryKey, id => deleteSignature(authToken, id));
  return {
    signatures: query.data ?? EMPTY_LIST,
    isLoadingSignatures: Boolean(authToken) && query.isPending,
    createSignature: create.mutateAsync,
    updateSignature: update.mutateAsync,
    setDefaultSignature: setDefault.mutateAsync,
    deleteSignature: remove.mutateAsync,
    isSavingSignature: create.isPending || update.isPending,
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
    avatarPresets: query.data ?? EMPTY_LIST,
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

export function useUsageStats(days) {
  const { authToken, scope } = useSettingsAccess();
  const query = useQuery({
    queryKey: settingsKeys.usageStats(scope, days),
    queryFn: () => getUsageStats(authToken, days),
    enabled: Boolean(authToken),
    // A 403 means "not an admin" - an answer, not a failure worth retrying.
    retry: false,
  });
  const isForbidden = query.error?.status === 403;
  return {
    usageStats: query.data ?? null,
    // Forbidden is the normal case for most users, so it is not an error to show.
    usageStatsError: query.isError && !isForbidden,
    isUsageStatsForbidden: isForbidden,
  };
}
