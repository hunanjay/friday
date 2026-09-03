import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import {
  createContact,
  deleteContact,
  deleteContactFact,
  getContactTags,
  getContacts,
  getSelfMemory,
  syncMicrosoftContacts,
  updateContact,
} from './api';
import { contactKeys } from './queryKeys';

const EMPTY_LIST = [];

function useContactsAccess() {
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

export function useContactTags() {
  const { authToken, scope } = useContactsAccess();
  const query = useQuery({
    queryKey: contactKeys.tags(scope),
    queryFn: () => getContactTags(authToken),
    enabled: Boolean(authToken),
  });
  return { contactTags: query.data ?? EMPTY_LIST, refetchContactTags: query.refetch };
}

export function useContacts({ query = '', tag = null, debounceMs = 250 } = {}) {
  const { authToken, scope } = useContactsAccess();
  const queryClient = useQueryClient();
  const debouncedQuery = useDebouncedValue(query, debounceMs);
  const debouncedTag = useDebouncedValue(tag, debounceMs);
  const queryKey = contactKeys.list(scope, debouncedQuery, debouncedTag);
  const listQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => getContacts(authToken, { query: debouncedQuery, tag: debouncedTag, signal }),
    enabled: Boolean(authToken),
    placeholderData: previous => previous,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: contactKeys.all(scope) });

  const syncMutation = useMutation({
    mutationFn: () => syncMicrosoftContacts(authToken),
    onSuccess: invalidate,
  });
  const createMutation = useMutation({
    mutationFn: contact => createContact(authToken, contact),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ contactId, patch }) => updateContact(authToken, contactId, patch),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: contactId => deleteContact(authToken, contactId),
    onSuccess: invalidate,
  });
  const deleteFactMutation = useMutation({
    mutationFn: ({ contactId, factId }) => deleteContactFact(authToken, contactId, factId),
  });

  return {
    contacts: listQuery.data ?? EMPTY_LIST,
    isLoadingContacts: Boolean(authToken) && listQuery.isPending,
    syncMicrosoftContacts: syncMutation.mutateAsync,
    isSyncingContacts: syncMutation.isPending,
    createContact: createMutation.mutateAsync,
    isCreatingContact: createMutation.isPending,
    updateContact: (contactId, patch) => updateMutation.mutateAsync({ contactId, patch }),
    isUpdatingContact: updateMutation.isPending,
    deleteContact: deleteMutation.mutateAsync,
    deleteContactFact: (contactId, factId) => deleteFactMutation.mutateAsync({ contactId, factId }),
    refetchContacts: () => invalidate(),
  };
}

// The user's own long-term memory (profile/preference/topic facts), shaped
// like a contact so ContactsPage can show it with the same facts UI.
export function useSelfMemory() {
  const { authToken, scope } = useContactsAccess();
  const queryClient = useQueryClient();
  const queryKey = contactKeys.self(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getSelfMemory(authToken),
    enabled: Boolean(authToken),
  });
  const deleteFactMutation = useMutation({
    mutationFn: factId => deleteContactFact(authToken, 'me', factId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    selfMemory: query.data ?? null,
    isLoadingSelfMemory: Boolean(authToken) && query.isPending,
    deleteSelfMemoryFact: deleteFactMutation.mutateAsync,
  };
}
