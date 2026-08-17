import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { partnerTrackingApi } from '@/lib/delivery-partner/tracking-api';
import { getApiErrorCode } from '@/lib/errors';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerTrackingKeys = {
  all: [...deliveryPartnerKeys.all, 'tracking'] as const,
  heatmap: () => [...partnerTrackingKeys.all, 'heatmap'] as const,
  lastLocation: () => [...partnerTrackingKeys.all, 'last-location'] as const,
  homeLocation: () => [...partnerTrackingKeys.all, 'home-location'] as const,
  order: (orderId?: string, deliveryId?: string) =>
    [...partnerTrackingKeys.all, 'order', orderId ?? '', deliveryId ?? ''] as const,
  route: (orderId?: string) =>
    [...partnerTrackingKeys.all, 'route', orderId ?? ''] as const,
  eta: (orderId?: string) =>
    [...partnerTrackingKeys.all, 'eta', orderId ?? ''] as const,
  history: (deliveryId?: string) =>
    [...partnerTrackingKeys.all, 'history', deliveryId ?? ''] as const,
  live: (orderId?: string) =>
    [...partnerTrackingKeys.all, 'live', orderId ?? ''] as const,
};

const keepRetrying = (failureCount: number, error: unknown) => {
  const msg = String((error as { message?: string })?.message ?? '').toLowerCase();
  const code = String((error as { code?: string })?.code ?? '').toUpperCase();
  if (
    msg.includes('too many request') ||
    msg.includes('rate limit') ||
    msg.includes('slow down')
  ) {
    return false;
  }
  if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED') return false;
  return failureCount < 2;
};

export function useNearbyHeatmap(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerTrackingKeys.heatmap(),
    queryFn: () => partnerTrackingApi.getNearbyHeatmap(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryHeatmap / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryHeatmap,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useOrderTracking(options: {
  orderId?: string;
  deliveryId?: string;
  enabled?: boolean;
}) {
  const isActive = useAppIsActive();
  const orderId = options.orderId?.trim();
  const deliveryId = options.deliveryId?.trim();
  const enabled = (options.enabled ?? true) && Boolean(orderId || deliveryId);

  return useQuery({
    queryKey: partnerTrackingKeys.order(orderId, deliveryId),
    queryFn: () =>
      orderId
        ? partnerTrackingApi.getOrderTracking(orderId)
        : partnerTrackingApi.getTrackingStatus(deliveryId!),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryTracking / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryTracking,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useTrackingRoute(orderId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = orderId?.trim();

  return useQuery({
    queryKey: partnerTrackingKeys.route(id),
    queryFn: () => partnerTrackingApi.getRoute(id!),
    enabled: enabled && Boolean(id),
    staleTime: LIVE_INTERVALS.deliveryTracking / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryTracking,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useTrackingEta(orderId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = orderId?.trim();

  return useQuery({
    queryKey: partnerTrackingKeys.eta(id),
    queryFn: async () => {
      try {
        return await partnerTrackingApi.getEta(id!);
      } catch (error) {
        const code = getApiErrorCode(error);
        if (code === 'LOCATION_REQUIRED' || code === 'LOCATION_NOT_FOUND') {
          return null;
        }
        throw error;
      }
    },
    enabled: enabled && Boolean(id),
    staleTime: LIVE_INTERVALS.deliveryTracking / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryTracking,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useLocationHistory(deliveryId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = deliveryId?.trim();

  return useQuery({
    queryKey: partnerTrackingKeys.history(id),
    queryFn: () => partnerTrackingApi.getLocationHistory(id!),
    enabled: enabled && Boolean(id),
    staleTime: LIVE_INTERVALS.deliveryTracking,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryHistoryTrail,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useLastLocation(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerTrackingKeys.lastLocation(),
    queryFn: async () => {
      try {
        return await partnerTrackingApi.getLastLocation();
      } catch (error) {
        const code = getApiErrorCode(error);
        if (code === 'LOCATION_NOT_FOUND' || code === 'LOCATION_REQUIRED') {
          return null;
        }
        throw error;
      }
    },
    enabled,
    staleTime: LIVE_INTERVALS.deliveryTracking,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryStatus,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useLiveLocation(orderId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = orderId?.trim();

  return useQuery({
    queryKey: partnerTrackingKeys.live(id),
    queryFn: async () => {
      try {
        return await partnerTrackingApi.getLiveLocation(id!);
      } catch (error) {
        const code = getApiErrorCode(error);
        if (code === 'LOCATION_NOT_FOUND' || code === 'LOCATION_REQUIRED') {
          return null;
        }
        throw error;
      }
    },
    enabled: enabled && Boolean(id),
    staleTime: LIVE_INTERVALS.deliveryTracking / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryTracking,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useTrackingStatus(deliveryId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = deliveryId?.trim();

  return useQuery({
    queryKey: [...partnerTrackingKeys.all, 'status', id ?? ''] as const,
    queryFn: () => partnerTrackingApi.getTrackingStatus(id!),
    enabled: enabled && Boolean(id),
    staleTime: LIVE_INTERVALS.deliveryTracking / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryTracking,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useSaveHomeLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      latitude: number;
      longitude: number;
      address?: string;
      zoneId?: string;
    }) => partnerTrackingApi.saveHomeLocation(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: partnerTrackingKeys.heatmap(),
        }),
        queryClient.invalidateQueries({
          queryKey: partnerTrackingKeys.homeLocation(),
        }),
        queryClient.invalidateQueries({
          queryKey: partnerTrackingKeys.lastLocation(),
        }),
      ]);
    },
  });
}
