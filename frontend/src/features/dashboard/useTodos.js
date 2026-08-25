import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/useAuth';
import { createTodo, deleteTodo, getTodos, updateTodo } from './api';
import { dashboardKeys } from './queryKeys';

export function useTodos() {
  const { authToken, user } = useAuth();
  const queryClient = useQueryClient();
  const scope = user?.id || user?.email || 'anonymous';
  const queryKey = dashboardKeys.todos(scope);
  const query = useQuery({
    queryKey,
    queryFn: () => getTodos(authToken),
    enabled: Boolean(authToken),
  });

  const createMutation = useMutation({
    mutationFn: input => createTodo(authToken, input),
    onSuccess: created => {
      queryClient.setQueryData(queryKey, current => [created, ...(current || [])]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: todo => updateTodo(authToken, todo),
    onMutate: async optimistic => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, current => (
        (current || []).map(todo => todo.id === optimistic.id ? optimistic : todo)
      ));
      return { previous };
    },
    onError: (_error, _todo, context) => {
      queryClient.setQueryData(queryKey, context?.previous || []);
    },
    onSuccess: saved => {
      queryClient.setQueryData(queryKey, current => (
        (current || []).map(todo => todo.id === saved.id ? saved : todo)
      ));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: todoId => deleteTodo(authToken, todoId),
    onMutate: async todoId => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, current => (
        (current || []).filter(todo => todo.id !== todoId)
      ));
      return { previous };
    },
    onError: (_error, _todoId, context) => {
      queryClient.setQueryData(queryKey, context?.previous || []);
    },
  });

  const clearCompletedMutation = useMutation({
    mutationFn: async completed => {
      const results = await Promise.allSettled(
        completed.map(todo => deleteTodo(authToken, todo.id).then(() => todo.id)),
      );
      const deletedIds = results
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value);
      if (deletedIds.length !== completed.length) {
        const error = new Error('Some completed todos could not be deleted');
        error.deletedIds = deletedIds;
        throw error;
      }
      return deletedIds;
    },
    onSuccess: deletedIds => {
      const ids = new Set(deletedIds);
      queryClient.setQueryData(queryKey, current => (
        (current || []).filter(todo => !ids.has(todo.id))
      ));
    },
    onError: error => {
      if (!error.deletedIds?.length) return;
      const ids = new Set(error.deletedIds);
      queryClient.setQueryData(queryKey, current => (
        (current || []).filter(todo => !ids.has(todo.id))
      ));
    },
  });

  return {
    clearCompletedTodos: clearCompletedMutation.mutateAsync,
    createTodo: createMutation.mutateAsync,
    deleteTodo: deleteMutation.mutateAsync,
    isLoadingTodos: Boolean(authToken) && query.isPending,
    refetchTodos: query.refetch,
    todos: query.data || [],
    todosError: query.isError
      || createMutation.isError
      || updateMutation.isError
      || deleteMutation.isError
      || clearCompletedMutation.isError,
    updateTodo: updateMutation.mutateAsync,
  };
}
