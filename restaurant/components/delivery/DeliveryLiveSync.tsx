import { useEffect } from 'react';

import { refreshCsrfToken } from '@/lib/api';
import { useRiderGatewaySocket } from '@/lib/delivery-partner/use-rider-gateway';

/**
 * Delivery live layer: CSRF warm-up + persistent gateway Socket.IO.
 * REST poll on orders / duty / inbox remains the fallback if the socket drops.
 */
export function DeliveryLiveSync({ enabled }: { enabled: boolean }) {
  useRiderGatewaySocket(enabled);

  useEffect(() => {
    if (!enabled) return;
    void refreshCsrfToken(true).catch(() => undefined);
  }, [enabled]);

  return null;
}
