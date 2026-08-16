import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { kitchenSupportApi } from '@/lib/restaurant/support-api';
import type {
  CreateKitchenTicketInput,
  KitchenTicketStatus,
} from '@/lib/restaurant/support-types';

export const kitchenSupportKeys = {
  all: ['kitchen-support'] as const,
  restaurant: (restaurantId: string) =>
    [...kitchenSupportKeys.all, restaurantId] as const,
  list: (
    restaurantId: string,
    page: number,
    status?: KitchenTicketStatus
  ) =>
    [...kitchenSupportKeys.restaurant(restaurantId), 'list', page, status ?? 'all'] as const,
};

export function useKitchenTickets(
  page = 1,
  status?: KitchenTicketStatus
) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: kitchenSupportKeys.list(restaurantId, page, status),
    queryFn: () =>
      kitchenSupportApi.listTickets(restaurantId, { page, limit: 20, status }),
    enabled: Boolean(restaurantId),
    staleTime: 20_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.settings, isActive),
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useCreateKitchenTicket(restaurantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateKitchenTicketInput) =>
      kitchenSupportApi.createTicket(restaurantId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: kitchenSupportKeys.restaurant(restaurantId),
      });
    },
  });
}
