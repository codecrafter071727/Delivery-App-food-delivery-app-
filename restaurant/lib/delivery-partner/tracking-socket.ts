import { useEffect, useRef } from 'react';

import {
  subscribeRiderGateway,
  trackRiderOrder,
  untrackRiderOrder,
} from '@/lib/delivery-partner/rider-gateway';
import type {
  OrderTracking,
  PartnerLiveLocation,
  TrackingEta,
} from '@/lib/delivery-partner/tracking-types';

type SocketHandlers = {
  onLocation?: (point: Pick<PartnerLiveLocation, 'latitude' | 'longitude' | 'speed' | 'heading'>) => void;
  onEta?: (
    eta: Pick<
      TrackingEta,
      'etaSeconds' | 'distanceMeters' | 'provider' | 'durationInTraffic'
    > & { polyline?: string }
  ) => void;
  onStatus?: (payload: { orderId?: string; status?: string }) => void;
  onAssigned?: (data: unknown) => void;
};

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

/**
 * Live trip updates on the shared rider gateway socket (`track:order`).
 * Does not open a second Socket.IO connection.
 */
export function useOrderTrackingSocket(
  orderId: string | undefined,
  _userId: string | undefined,
  enabled: boolean,
  handlers: SocketHandlers
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const id = orderId?.trim();
    if (!enabled || !id) return;

    trackRiderOrder(id);

    const unsubscribe = subscribeRiderGateway((event, payload) => {
      const record = asRecord(payload);
      const payloadOrderId = String(
        record.orderId ?? record.order_id ?? ''
      ).trim();
      if (payloadOrderId && payloadOrderId !== id) return;

      if (event === 'partner:location' || event === 'tracking:location') {
        const nested = asRecord(
          record.location ?? record.coords ?? record.coordinates ?? record
        );
        const latitude = pickNumber(nested, ['latitude', 'lat']);
        const longitude = pickNumber(nested, ['longitude', 'lng', 'lon']);
        if (latitude == null || longitude == null) return;
        handlersRef.current.onLocation?.({
          latitude,
          longitude,
          speed: pickNumber(nested, ['speed']),
          heading: pickNumber(nested, ['heading', 'bearing']),
        });
        return;
      }

      if (event === 'tracking:eta') {
        handlersRef.current.onEta?.({
          etaSeconds: pickNumber(record, ['etaSeconds', 'eta']),
          distanceMeters: pickNumber(record, ['distanceMeters', 'distance']),
          polyline:
            typeof record.polyline === 'string' ? record.polyline : undefined,
          provider:
            typeof record.provider === 'string' ? record.provider : undefined,
          durationInTraffic: record.durationInTraffic === true,
        });
        return;
      }

      if (event === 'delivery:updated' || event === 'delivery:status') {
        const status =
          typeof record.status === 'string' ? record.status : undefined;
        handlersRef.current.onStatus?.({
          orderId: payloadOrderId || id,
          status,
        });
        return;
      }

      if (event === 'delivery:assigned') {
        handlersRef.current.onAssigned?.(payload);
      }
    });

    return () => {
      unsubscribe();
      untrackRiderOrder(id);
    };
  }, [enabled, orderId]);
}

export type SocketTrackingPatch = Partial<
  Pick<OrderTracking, 'etaSeconds' | 'distanceMeters' | 'polyline' | 'provider' | 'durationInTraffic' | 'status'>
> & {
  riderLocation?: Pick<PartnerLiveLocation, 'latitude' | 'longitude' | 'speed' | 'heading'>;
};
