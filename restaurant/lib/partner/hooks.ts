import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { restaurantOrderApi, type KitchenRider } from '@/lib/order/owner-api';
import { restaurantOrderKeys, useMyRestaurantId } from '@/lib/order/hooks';
import type { RestaurantOwnerRestaurant } from '@/lib/restaurant/types';
import { restaurantPartnerApi } from '@/lib/partner/api';
import type {
  CreateInvitationPayload,
  DeliveryPartner,
  ManualAssignPayload,
  PartnerInvitation,
  UpdatePartnerStatusPayload,
} from '@/lib/partner/types';

export const partnerKeys = {
  all: ['delivery-partners'] as const,
  restaurant: (restaurantId: string) =>
    [...partnerKeys.all, restaurantId] as const,
  partners: (restaurantId: string) =>
    [...partnerKeys.restaurant(restaurantId), 'partners'] as const,
  partner: (restaurantId: string, partnerId: string) =>
    [...partnerKeys.partners(restaurantId), partnerId] as const,
  invitations: (restaurantId: string) =>
    [...partnerKeys.restaurant(restaurantId), 'invitations'] as const,
  available: (restaurantId: string) =>
    [...partnerKeys.restaurant(restaurantId), 'available'] as const,
  orderPartner: (orderId: string) =>
    [...partnerKeys.all, 'order', orderId, 'partner'] as const,
};

function restaurantPin(row?: RestaurantOwnerRestaurant | null): {
  lat?: number;
  lng?: number;
} {
  if (!row) return {};
  const loc = row.location as
    | { coordinates?: number[]; lat?: number; lng?: number }
    | undefined;
  if (Array.isArray(loc?.coordinates) && loc.coordinates.length >= 2) {
    const lng = Number(loc.coordinates[0]);
    const lat = Number(loc.coordinates[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  const lat = Number(row.lat ?? row.latitude ?? loc?.lat);
  const lng = Number(row.lng ?? row.longitude ?? loc?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0) {
    return { lat, lng };
  }
  return {};
}

async function invalidatePartners(
  queryClient: ReturnType<typeof useQueryClient>,
  restaurantId: string
) {
  await queryClient.invalidateQueries({
    queryKey: partnerKeys.restaurant(restaurantId),
  });
}

export function useRestaurantPartners() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: partnerKeys.partners(restaurantId),
    queryFn: () => restaurantPartnerApi.getPartners(restaurantId),
    enabled: Boolean(restaurantId),
    staleTime: 20_000,
    retry: 1,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.partners, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useRestaurantInvitations() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: partnerKeys.invitations(restaurantId),
    queryFn: () => restaurantPartnerApi.getInvitations(restaurantId),
    enabled: Boolean(restaurantId),
    staleTime: 20_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.partners, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useAvailablePartners(enabled = true) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const pin = restaurantPin(restaurantQuery.data);
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: [...partnerKeys.available(restaurantId), pin.lat, pin.lng] as const,
    queryFn: () =>
      restaurantPartnerApi.getAvailablePartners(restaurantId, pin),
    enabled: Boolean(restaurantId) && enabled,
    staleTime: 10_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.partnersAvailable,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useOrderAssignedPartner(
  orderId?: string,
  enabled = true
) {
  const restaurantQuery = useMyRestaurantId({ enabled });
  const restaurantId = restaurantQuery.data?.id;
  const isActive = useAppIsActive();
  const live = Boolean(orderId) && enabled && Boolean(restaurantId);

  return useQuery({
    queryKey: restaurantOrderKeys.rider(restaurantId ?? '', orderId ?? ''),
    queryFn: () => restaurantOrderApi.getRider(restaurantId!, orderId!),
    enabled: live,
    staleTime: 8_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.partnersAvailable,
      isActive && live
    ),
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function usePartnerDetail(
  restaurantId: string,
  partnerId?: string,
  enabled = true
) {
  return useQuery({
    queryKey: partnerKeys.partner(restaurantId, partnerId ?? ''),
    queryFn: () => restaurantPartnerApi.getPartner(restaurantId, partnerId!),
    enabled: Boolean(restaurantId && partnerId) && enabled,
    staleTime: 30_000,
    retry: 1,
  });
}

export function usePartnerMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const invite = useMutation({
    mutationFn: (payload: CreateInvitationPayload) =>
      restaurantPartnerApi.createInvitation(restaurantId, payload),
    onSuccess: async (created) => {
      queryClient.setQueryData<PartnerInvitation[]>(
        partnerKeys.invitations(restaurantId),
        (prev) => [created, ...(prev ?? []).filter((row) => row.id !== created.id)]
      );
      await invalidatePartners(queryClient, restaurantId);
    },
  });

  const cancelInvite = useMutation({
    mutationFn: (invitationId: string) =>
      restaurantPartnerApi.cancelInvitation(restaurantId, invitationId),
    onSuccess: async (updated, invitationId) => {
      queryClient.setQueryData<PartnerInvitation[]>(
        partnerKeys.invitations(restaurantId),
        (prev) =>
          (prev ?? []).map((row) =>
            row.id === invitationId
              ? { ...row, ...updated, status: updated.status || 'cancelled' }
              : row
          )
      );
      await invalidatePartners(queryClient, restaurantId);
    },
  });

  const setStatus = useMutation({
    mutationFn: ({
      partnerId,
      payload,
    }: {
      partnerId: string;
      payload: UpdatePartnerStatusPayload;
    }) =>
      restaurantPartnerApi.updatePartnerStatus(
        restaurantId,
        partnerId,
        payload
      ),
    onSuccess: async (updated) => {
      queryClient.setQueryData<DeliveryPartner[]>(
        partnerKeys.partners(restaurantId),
        (prev) =>
          (prev ?? []).map((row) =>
            row.id === updated.id ? { ...row, ...updated } : row
          )
      );
      queryClient.setQueryData(
        partnerKeys.partner(restaurantId, updated.id),
        updated
      );
      await invalidatePartners(queryClient, restaurantId);
    },
  });

  const manualAssign = useMutation({
    mutationFn: ({
      orderId,
      payload,
    }: {
      orderId: string;
      payload: ManualAssignPayload;
    }) =>
      restaurantOrderApi.manualAssign(
        restaurantId,
        orderId,
        payload.partnerId
      ),
    onSuccess: async (result: KitchenRider) => {
      queryClient.setQueryData(
        restaurantOrderKeys.rider(restaurantId, result.orderId),
        result
      );
      queryClient.setQueryData(partnerKeys.orderPartner(result.orderId), result);
      await invalidatePartners(queryClient, restaurantId);
    },
  });

  return { invite, cancelInvite, setStatus, manualAssign };
}
