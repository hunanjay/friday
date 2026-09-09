import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  createMemo,
  deleteMemo,
  getMemos,
  updateMemo,
  uploadMemoAttachment,
} from './api';
import { memoKeys } from './queryKeys';

const EMPTY_LIST = [];
const PAGE_SIZE = 24;

function useMemoAccess() {
  const { authToken, user } = useAuth();
  return {
    authToken,
    scope: user?.id || user?.email || 'anonymous',
  };
}

function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Server-side paginated + filtered (category/search now run in SQL - see
// list_memos_page - instead of loading every memo, attachments and all,
// on every visit).
export function useMemos({ category = 'all', search = '', debounceMs = 250 } = {}) {
  const { authToken, scope } = useMemoAccess();
  const queryClient = useQueryClient();
  const debouncedSearch = useDebouncedValue(search, debounceMs);
  const [page, setPage] = useState(0);

  // A changed filter invalidates the current offset - jump back to page 0
  // rather than risk landing past the end of the new, smaller result set.
  useEffect(() => { setPage(0); }, [category, debouncedSearch]);

  const queryKey = memoKeys.list(scope, { category, search: debouncedSearch, page });
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => getMemos(authToken, {
      category,
      search: debouncedSearch,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      signal,
    }),
    enabled: Boolean(authToken),
    placeholderData: previous => previous,
  });

  // Pagination makes "insert/patch/remove this one item in the cached page"
  // unreliable (the item may belong on a different page after the change),
  // so mutations just invalidate every cached page instead.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: memoKeys.all(scope) });

  const createMutation = useMutation({
    mutationFn: memo => createMemo(authToken, memo),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: memo => updateMemo(authToken, memo),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: memoId => deleteMemo(authToken, memoId),
    onSuccess: invalidate,
  });
  const uploadMutation = useMutation({
    mutationFn: file => uploadMemoAttachment(authToken, file),
  });

  return {
    memos: query.data?.memos ?? EMPTY_LIST,
    hasMore: query.data?.hasMore ?? false,
    page,
    goToNextPage: () => setPage(p => p + 1),
    goToPrevPage: () => setPage(p => Math.max(0, p - 1)),
    addMemo: createMutation.mutateAsync,
    updateMemo: updateMutation.mutateAsync,
    deleteMemo: deleteMutation.mutateAsync,
    uploadMemoAttachment: uploadMutation.mutateAsync,
    isLoadingMemos: Boolean(authToken) && query.isPending,
    isFetchingMemos: query.isFetching,
    isAddingMemo: createMutation.isPending,
    isUpdatingMemo: updateMutation.isPending,
    isDeletingMemo: deleteMutation.isPending,
    isUploadingMemoAttachment: uploadMutation.isPending,
  };
}
