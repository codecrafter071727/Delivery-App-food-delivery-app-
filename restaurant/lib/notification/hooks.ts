import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  LIVE_INTERVALS,
} from '@/lib/live-query';
import { notificationApi } from '@/lib/notification/api';
import type { AppNotification } from '@/lib/notification/types';

export const notificationKeys = {
  all: ['notification'] as const,
  list: (params?: { page?: number; limit?: number; unread?: boolean }) =>
    [...notificationKeys.all, 'list', params ?? {}] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
};

function invalidateNotificationQueries(
  queryClient: ReturnType<typeof useQueryClient>
) {
  // Mark cache stale only — live sync / screen poll refresh the data.
  void queryClient.invalidateQueries({
    queryKey: notificationKeys.all,
    refetchType: 'none',
  });
}

/** GET /notifications — cache updated by delivery notification sync + mutations. */
export function useNotifications(
  params?: { page?: number; limit?: number; unread?: boolean },
  options?: { refetchInterval?: number | false; enabled?: boolean }
) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => notificationApi.getNotifications(params),
    enabled: options?.enabled ?? true,
    staleTime: LIVE_INTERVALS.notifications / 2,
    gcTime: 30 * 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Default: no extra poll (background sync owns cadence). Screens may opt in.
    refetchInterval: options?.refetchInterval ?? false,
    refetchIntervalInBackground: false,
    retry: 1,
    retryDelay: 4_000,
    placeholderData: (previous) => previous,
  });
}

/** GET /notifications/unread-count — kept fresh by delivery notification sync. */
export function useUnreadNotificationCount(options?: {
  refetchInterval?: number | false;
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}) {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: notificationApi.getUnreadCount,
    enabled: options?.enabled ?? true,
    staleTime: LIVE_INTERVALS.notifications / 2,
    gcTime: 30 * 60_000,
    refetchInterval: options?.refetchInterval ?? false,
    refetchOnMount: options?.refetchOnMount ?? true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchIntervalInBackground: false,
    retry: 1,
    retryDelay: 4_000,
    select: (data) => data.count,
    placeholderData: (previous) => previous,
  });
}

/** PUT /notifications/:id/read */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationApi.markRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });

      const previousLists = queryClient.getQueriesData({
        queryKey: [...notificationKeys.all, 'list'],
      });
      const previousCount = queryClient.getQueryData<
        Awaited<ReturnType<typeof notificationApi.getUnreadCount>>
      >(notificationKeys.unreadCount());

      queryClient.setQueriesData(
        { queryKey: [...notificationKeys.all, 'list'] },
        (old: unknown) => {
          if (!old || typeof old !== 'object') return old;
          const data = old as {
            notifications: AppNotification[];
            meta?: unknown;
          };
          if (!Array.isArray(data.notifications)) return old;
          return {
            ...data,
            notifications: data.notifications.map((n) =>
              n.id === id ? { ...n, isRead: true } : n
            ),
          };
        }
      );

      if (previousCount) {
        queryClient.setQueryData(notificationKeys.unreadCount(), {
          count: Math.max(0, (previousCount.count ?? 0) - 1),
        });
      }

      return { previousLists, previousCount };
    },
    onError: (_err, _id, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(
          notificationKeys.unreadCount(),
          context.previousCount
        );
      }
    },
    onSettled: () => {
      invalidateNotificationQueries(queryClient);
    },
  });
}

/** PUT /notifications/read-all */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationApi.markAllRead(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });

      const previousLists = queryClient.getQueriesData({
        queryKey: [...notificationKeys.all, 'list'],
      });
      const previousCount = queryClient.getQueryData(
        notificationKeys.unreadCount()
      );

      queryClient.setQueriesData(
        { queryKey: [...notificationKeys.all, 'list'] },
        (old: unknown) => {
          if (!old || typeof old !== 'object') return old;
          const data = old as {
            notifications: AppNotification[];
            meta?: unknown;
          };
          if (!Array.isArray(data.notifications)) return old;
          return {
            ...data,
            notifications: data.notifications.map((n) => ({
              ...n,
              isRead: true,
            })),
          };
        }
      );
      queryClient.setQueryData(notificationKeys.unreadCount(), { count: 0 });

      return { previousLists, previousCount };
    },
    onError: (_err, _void, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(
          notificationKeys.unreadCount(),
          context.previousCount
        );
      }
    },
    onSettled: () => {
      invalidateNotificationQueries(queryClient);
    },
  });
}

/** DELETE /notifications/:id */
export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => notificationApi.deleteNotification(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });

      const previousLists = queryClient.getQueriesData({
        queryKey: [...notificationKeys.all, 'list'],
      });
      const previousCount = queryClient.getQueryData<
        Awaited<ReturnType<typeof notificationApi.getUnreadCount>>
      >(notificationKeys.unreadCount());

      let removedUnread = false;
      queryClient.setQueriesData(
        { queryKey: [...notificationKeys.all, 'list'] },
        (old: unknown) => {
          if (!old || typeof old !== 'object') return old;
          const data = old as {
            notifications: AppNotification[];
            meta?: unknown;
          };
          if (!Array.isArray(data.notifications)) return old;
          const target = data.notifications.find((n) => n.id === id);
          if (target && !target.isRead) removedUnread = true;
          return {
            ...data,
            notifications: data.notifications.filter((n) => n.id !== id),
          };
        }
      );

      if (removedUnread && previousCount) {
        queryClient.setQueryData(notificationKeys.unreadCount(), {
          count: Math.max(0, (previousCount.count ?? 0) - 1),
        });
      }

      return { previousLists, previousCount };
    },
    onError: (_err, _id, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(
          notificationKeys.unreadCount(),
          context.previousCount
        );
      }
    },
    onSettled: () => {
      invalidateNotificationQueries(queryClient);
    },
  });
}

/** DELETE /notifications/clear-all */
export function useClearAllNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => notificationApi.clearAll(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.all });
      const previousLists = queryClient.getQueriesData({
        queryKey: [...notificationKeys.all, 'list'],
      });
      const previousCount = queryClient.getQueryData(
        notificationKeys.unreadCount()
      );

      queryClient.setQueriesData(
        { queryKey: [...notificationKeys.all, 'list'] },
        (old: unknown) => {
          if (!old || typeof old !== 'object') return old;
          return { ...(old as object), notifications: [] };
        }
      );
      queryClient.setQueryData(notificationKeys.unreadCount(), { count: 0 });

      return { previousLists, previousCount };
    },
    onError: (_err, _void, context) => {
      context?.previousLists?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context?.previousCount !== undefined) {
        queryClient.setQueryData(
          notificationKeys.unreadCount(),
          context.previousCount
        );
      }
    },
    onSettled: () => {
      invalidateNotificationQueries(queryClient);
    },
  });
}
