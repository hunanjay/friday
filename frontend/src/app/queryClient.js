import { QueryClient } from '@tanstack/react-query';
import { isApiError } from '../api/errors';

function shouldRetry(failureCount, error) {
  if (failureCount >= 2) return false;
  if (!isApiError(error)) return true;
  if (error.status >= 400 && error.status < 500) return false;
  return true;
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryClient = createAppQueryClient();
