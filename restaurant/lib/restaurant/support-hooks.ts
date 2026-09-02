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
  KitchenTicketStage,
} from '@/lib/restaurant/support-types';

export const kitchenSupportKeys = {
  all: ['kitchen-support'] as const,
  restaurant: (restaurantId: string) =>
    [...kitchenSupportKeys.all, restaurantId] as const,
  list: (
    restaurantId: string,
    page: number,
    stage?: KitchenTicketStage
  ) =>
    [...kitchenSupportKeys.restaurant(restaurantId), 'list', page, stage ?? 'all'] as const,
  ticket: (restaurantId: string, ticketId: string) =>
    [...kitchenSupportKeys.restaurant(restaurantId), 'ticket', ticketId] as const,
};

export function useKitchenTickets(
  page = 1,
  stage?: KitchenTicketStage
) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: kitchenSupportKeys.list(restaurantId, page, stage),
    queryFn: () =>
      kitchenSupportApi.listTickets(restaurantId, { page, limit: 20, stage }),
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

export function useKitchenTicket(
  restaurantId: string,
  ticketId: string | null
) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: kitchenSupportKeys.ticket(restaurantId, ticketId ?? ''),
    queryFn: () => kitchenSupportApi.getTicket(restaurantId, ticketId!),
    enabled: Boolean(restaurantId && ticketId),
    staleTime: 10_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.settings, isActive),
    refetchIntervalInBackground: false,
  });
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

export function useReopenKitchenTicket(restaurantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ticketId: string; reason: string }) =>
      kitchenSupportApi.reopenTicket(restaurantId, input.ticketId, input.reason),
    onSuccess: async (ticket) => {
      await queryClient.invalidateQueries({
        queryKey: kitchenSupportKeys.restaurant(restaurantId),
      });
      queryClient.setQueryData(
        kitchenSupportKeys.ticket(restaurantId, ticket.ticketId),
        ticket
      );
    },
  });
}
