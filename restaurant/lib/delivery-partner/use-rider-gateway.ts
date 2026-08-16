import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { applyRiderSocketEvent } from '@/lib/delivery-partner/rider-events';
import {
  getRiderGatewayStatus,
  startRiderGateway,
  subscribeRiderGateway,
  subscribeRiderGatewayStatus,
  trackRiderOrder,
  untrackRiderOrder,
} from '@/lib/delivery-partner/rider-gateway';
import type { RiderGatewayStatus } from '@/lib/delivery-partner/rider-gateway-types';

/**
 * Owns the rider Socket.IO session while the delivery portal is open:
 * mint `POST /api/v1/socket-token`, connect `{GATEWAY}/socket.io/`,
 * apply live events, REST poll remains the fallback.
 */
export function useRiderGatewaySocket(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    startRiderGateway(enabled);
    return () => {
      startRiderGateway(false);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeRiderGateway((event, payload) => {
      applyRiderSocketEvent(queryClient, event, payload);
    });
  }, [enabled, queryClient]);
}

export function useRiderGatewayStatus(): RiderGatewayStatus {
  const [status, setStatus] = useState<RiderGatewayStatus>(getRiderGatewayStatus);

  useEffect(() => subscribeRiderGatewayStatus(setStatus), []);

  return status;
}

export function useRiderOrderRoom(orderId: string | undefined, enabled: boolean) {
  useEffect(() => {
    const id = orderId?.trim();
    if (!enabled || !id) return;
    trackRiderOrder(id);
    return () => untrackRiderOrder(id);
  }, [enabled, orderId]);
}
