import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';

import { isRateLimitedError, noteRateLimited } from '@/lib/live-query';

function onQueryError(error: unknown) {
  if (isRateLimitedError(error)) noteRateLimited(error);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: onQueryError,
  }),
  mutationCache: new MutationCache({
    onError: onQueryError,
  }),
  defaultOptions: {
    queries: {
      // Data can refresh in the background without a full app reload.
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24 hours
      retry: (failureCount, error) => {
        if (isRateLimitedError(error)) return false;
        return failureCount < 1;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8_000),
      // Works with focusManager wired in live-query.ts (RN AppState).
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      // Never poll from defaults — each screen sets its own safe interval.
      refetchIntervalInBackground: false,
    },
    mutations: {
      retry: false,
    },
  },
});

export const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
});
