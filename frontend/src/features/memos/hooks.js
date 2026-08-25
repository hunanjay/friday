import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  createMemo,
  deleteMemo,
  getMemos,
  updateMemo,
  uploadMemoAttachment,
} from './api';
import { memoKeys } from './queryKeys';

function useMemoAccess() {
  const { authToken, user } = useAuth();
  return {
    authToken,
    scope: user?.id || user?.email || 'anonymous',
  };
}

export function useMemos() {
  const { authToken, scope } = useMemoAccess();
  const queryClient = useQueryClient();
  const queryKey = memoKeys.list(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getMemos(authToken),
    enabled: Boolean(authToken),
  });
  const createMutation = useMutation({
    mutationFn: memo => createMemo(authToken, memo),
    onSuccess: created => {
      queryClient.setQueryData(queryKey, previous => [created, ...(previous || [])]);
    },
  });
  const updateMutation = useMutation({
    mutationFn: memo => updateMemo(authToken, memo),
    onSuccess: saved => {
      queryClient.setQueryData(queryKey, previous => (
        previous || []
      ).map(memo => memo.id === saved.id ? saved : memo));
    },
  });
  const deleteMutation = useMutation({
    mutationFn: memoId => deleteMemo(authToken, memoId),
    onSuccess: memoId => {
      queryClient.setQueryData(queryKey, previous => (
        previous || []
      ).filter(memo => memo.id !== memoId));
    },
  });
  const uploadMutation = useMutation({
    mutationFn: file => uploadMemoAttachment(authToken, file),
  });

  return {
    memos: query.data ?? [],
    addMemo: createMutation.mutateAsync,
    updateMemo: updateMutation.mutateAsync,
    deleteMemo: deleteMutation.mutateAsync,
    uploadMemoAttachment: uploadMutation.mutateAsync,
    isLoadingMemos: Boolean(authToken) && query.isPending,
    isAddingMemo: createMutation.isPending,
    isUpdatingMemo: updateMutation.isPending,
    isDeletingMemo: deleteMutation.isPending,
    isUploadingMemoAttachment: uploadMutation.isPending,
  };
}
