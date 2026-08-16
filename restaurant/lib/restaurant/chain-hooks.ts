import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { restaurantChainApi } from '@/lib/restaurant/chain-api';
import type {
  ApplyAvailabilityPayload,
  ApplyPricesPayload,
  ApplySettingsPayload,
  CloneMenuPayload,
} from '@/lib/restaurant/chain-types';
import { useMyRestaurantId } from '@/lib/order/hooks';

export const chainKeys = {
  all: ['restaurant-chain'] as const,
  restaurant: (restaurantId: string) =>
    [...chainKeys.all, restaurantId] as const,
  siblings: (restaurantId: string) =>
    [...chainKeys.restaurant(restaurantId), 'siblings'] as const,
};

export function useChainSiblings() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';

  const query = useQuery({
    queryKey: chainKeys.siblings(restaurantId),
    queryFn: () => restaurantChainApi.listSiblings(restaurantId),
    enabled: Boolean(restaurantId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useChainMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: chainKeys.restaurant(restaurantId),
    });

  const cloneMenu = useMutation({
    mutationFn: (payload: CloneMenuPayload) =>
      restaurantChainApi.cloneMenu(restaurantId, payload),
    onSuccess: invalidate,
  });

  const applyPrices = useMutation({
    mutationFn: (payload: ApplyPricesPayload) =>
      restaurantChainApi.applyPrices(restaurantId, payload),
    onSuccess: invalidate,
  });

  const applyAvailability = useMutation({
    mutationFn: (payload: ApplyAvailabilityPayload) =>
      restaurantChainApi.applyAvailability(restaurantId, payload),
    onSuccess: invalidate,
  });

  const applySettings = useMutation({
    mutationFn: (payload: ApplySettingsPayload) =>
      restaurantChainApi.applySettings(restaurantId, payload),
    onSuccess: invalidate,
  });

  return { cloneMenu, applyPrices, applyAvailability, applySettings };
}
