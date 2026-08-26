import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAppIsActive } from '@/lib/live-query';
import { fetchKitchenOrderTracking } from '@/lib/order/kitchen-tracking-api';
import { restaurantOrderKeys } from '@/lib/order/hooks';
import type { OrderTracking, PartnerLiveLocation } from '@/lib/delivery-partner/tracking-types';
import {
  subscribeKitchenEvents,
  trackKitchenOrder,
  untrackKitchenOrder,
} from '@/lib/gateway/kitchen-client';
import type { KitchenInboundEvent } from '@/lib/gateway/kitchen-events';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

export function kitchenTrackingKeys(restaurantId: string, orderId: string) {
  return [...restaurantOrderKeys.detail(restaurantId, orderId), 'tracking'] as const;
}

/**
 * Polls kitchen tracking REST and merges live `tracking:location` from the
 * restaurant Socket.IO room (assign → delivered).
 */
export function useKitchenOrderTracking(
  restaurantId: string | undefined,
  orderId: string | undefined,
  enabled: boolean
) {
  const isActive = useAppIsActive();
  const queryClient = useQueryClient();
  const [livePatch, setLivePatch] = useState<PartnerLiveLocation | null>(null);
  const orderRef = useRef(orderId);
  orderRef.current = orderId;

  const query = useQuery({
    queryKey: kitchenTrackingKeys(restaurantId ?? '', orderId ?? ''),
    queryFn: () => fetchKitchenOrderTracking(restaurantId!, orderId!),
    enabled: Boolean(restaurantId && orderId && enabled),
    staleTime: 4_000,
    refetchInterval: isActive && enabled ? 8_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    const id = orderId?.trim();
    if (!enabled || !id) return;
    trackKitchenOrder(id);
    return () => untrackKitchenOrder(id);
  }, [enabled, orderId]);

  useEffect(() => {
    if (!enabled || !orderId || !restaurantId) return;
    return subscribeKitchenEvents((event: KitchenInboundEvent, payload) => {
      if (event !== 'tracking:location' && event !== 'partner:location') return;
      const record = asRecord(payload);
      const eventOrderId = String(record.orderId ?? '');
      if (eventOrderId && eventOrderId !== orderRef.current) return;
      const latitude = pickNumber(record, ['latitude', 'lat']);
      const longitude = pickNumber(record, ['longitude', 'lng', 'lon']);
      if (latitude == null || longitude == null) return;
      const point: PartnerLiveLocation = {
        latitude,
        longitude,
        speed: pickNumber(record, ['speed']) ?? null,
        heading: pickNumber(record, ['heading']) ?? null,
        updatedAt: new Date().toISOString(),
        stale: false,
      };
      setLivePatch(point);
      queryClient.setQueryData(
        kitchenTrackingKeys(restaurantId, orderId),
        (current: OrderTracking | undefined) =>
          current
            ? { ...current, riderLocation: { ...current.riderLocation, ...point } }
            : current
      );
    });
  }, [enabled, orderId, restaurantId, queryClient]);

  const tracking: OrderTracking | null = query.data
    ? {
        ...query.data,
        riderLocation: livePatch
          ? { ...query.data.riderLocation, ...livePatch }
          : query.data.riderLocation,
      }
    : null;

  return {
    tracking,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
