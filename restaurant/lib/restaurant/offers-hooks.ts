import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { dashboardKeys } from '@/lib/dashboard/hooks';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { restaurantOffersApi } from '@/lib/restaurant/offers-api';
import type {
  CreateOfferPayload,
  RestaurantOffer,
  UpdateOfferPayload,
} from '@/lib/restaurant/types';

export const offerKeys = {
  all: ['restaurant-offers'] as const,
  restaurant: (restaurantId: string) =>
    [...offerKeys.all, restaurantId] as const,
  list: (restaurantId: string) =>
    [...offerKeys.restaurant(restaurantId), 'list'] as const,
  detail: (restaurantId: string, offerId: string) =>
    [...offerKeys.restaurant(restaurantId), 'detail', offerId] as const,
};

async function invalidateOffers(
  queryClient: ReturnType<typeof useQueryClient>,
  restaurantId: string
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: offerKeys.restaurant(restaurantId),
    }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.stats() }),
  ]);
}

function upsertOffer(list: RestaurantOffer[], offer: RestaurantOffer) {
  return [offer, ...list.filter((row) => row.id !== offer.id)];
}

export function useRestaurantOffers() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: offerKeys.list(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => restaurantOffersApi.getOffers(restaurantId),
    staleTime: 30_000,
    retry: 1,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.offers, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useOfferDetail(
  restaurantId: string,
  offerId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: offerKeys.detail(restaurantId, offerId ?? ''),
    queryFn: () => restaurantOffersApi.getOffer(restaurantId, offerId!),
    enabled: Boolean(restaurantId && offerId) && enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useOfferMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const createOffer = useMutation({
    mutationFn: (payload: CreateOfferPayload) =>
      restaurantOffersApi.createOffer(restaurantId, payload),
    onSuccess: async (created) => {
      queryClient.setQueryData<RestaurantOffer[]>(
        offerKeys.list(restaurantId),
        (prev) => upsertOffer(prev ?? [], created)
      );
      queryClient.setQueryData(
        offerKeys.detail(restaurantId, created.id),
        created
      );
      await invalidateOffers(queryClient, restaurantId);
    },
  });

  const updateOffer = useMutation({
    mutationFn: ({
      offerId,
      payload,
    }: {
      offerId: string;
      payload: UpdateOfferPayload;
    }) => restaurantOffersApi.updateOffer(restaurantId, offerId, payload),
    onSuccess: async (updated) => {
      queryClient.setQueryData<RestaurantOffer[]>(
        offerKeys.list(restaurantId),
        (prev) => upsertOffer(prev ?? [], updated)
      );
      queryClient.setQueryData(
        offerKeys.detail(restaurantId, updated.id),
        updated
      );
      await invalidateOffers(queryClient, restaurantId);
    },
  });

  const deleteOffer = useMutation({
    mutationFn: (offerId: string) =>
      restaurantOffersApi.deleteOffer(restaurantId, offerId),
    onSuccess: async (_void, offerId) => {
      queryClient.setQueryData<RestaurantOffer[]>(
        offerKeys.list(restaurantId),
        (prev) => (prev ?? []).filter((offer) => offer.id !== offerId)
      );
      queryClient.removeQueries({
        queryKey: offerKeys.detail(restaurantId, offerId),
      });
      await invalidateOffers(queryClient, restaurantId);
    },
  });

  return { createOffer, updateOffer, deleteOffer };
}
