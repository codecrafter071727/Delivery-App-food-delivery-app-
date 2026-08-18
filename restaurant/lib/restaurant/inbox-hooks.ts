import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { kitchenInboxApi, loadStoredKitchenDevice } from '@/lib/restaurant/inbox-api';
import { notificationKeys } from '@/lib/notification/hooks';

export const kitchenInboxKeys = {
  all: ['kitchen-inbox'] as const,
  restaurant: (restaurantId: string) =>
    [...kitchenInboxKeys.all, restaurantId] as const,
  list: (
    restaurantId: string,
    params: { page?: number; unread?: boolean }
  ) =>
    [...kitchenInboxKeys.restaurant(restaurantId), 'list', params] as const,
  device: (restaurantId: string) =>
    [...kitchenInboxKeys.restaurant(restaurantId), 'device'] as const,
};

export function useKitchenInbox(params?: {
  page?: number;
  limit?: number;
  unread?: boolean;
}) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();
  const page = params?.page ?? 1;
  const unread = params?.unread;

  const query = useQuery({
    queryKey: kitchenInboxKeys.list(restaurantId, { page, unread }),
    queryFn: () =>
      kitchenInboxApi.listNotifications(restaurantId, {
        page,
        limit: params?.limit ?? 30,
        unread,
      }),
    enabled: Boolean(restaurantId),
    staleTime: 20_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.notifications, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    unreadCount: query.data?.unreadCount ?? 0,
  };
}

export function useKitchenUnreadCount() {
  const inbox = useKitchenInbox({ page: 1, limit: 30 });
  return {
    ...inbox,
    data: inbox.unreadCount,
  };
}

export function useStoredKitchenDevice() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  return useQuery({
    queryKey: kitchenInboxKeys.device(restaurantId),
    queryFn: loadStoredKitchenDevice,
    enabled: Boolean(restaurantId),
    staleTime: 10_000,
  });
}

export function useKitchenDeviceMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const register = useMutation({
    mutationFn: (input: { token: string; deviceId?: string }) =>
      kitchenInboxApi.registerDevice(restaurantId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: kitchenInboxKeys.device(restaurantId),
        }),
        queryClient.invalidateQueries({
          queryKey: notificationKeys.devices(),
        }),
      ]);
    },
  });

  const unregister = useMutation({
    mutationFn: (deviceId: string) =>
      kitchenInboxApi.unregisterDevice(restaurantId, deviceId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: kitchenInboxKeys.device(restaurantId),
        }),
        queryClient.invalidateQueries({
          queryKey: notificationKeys.devices(),
        }),
      ]);
    },
  });

  return { register, unregister };
}
