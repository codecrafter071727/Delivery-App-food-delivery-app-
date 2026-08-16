import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { IncomingOfferOverlay } from '@/components/delivery/orders/IncomingOfferOverlay';
import { RiderLiveToasts } from '@/components/delivery/shared/RiderLiveToasts';
import { refreshCsrfToken } from '@/lib/api';
import { useRiderGatewaySocket } from '@/lib/delivery-partner/use-rider-gateway';

/**
 * Delivery live layer: CSRF, persistent Socket.IO, incoming offers, toasts.
 * REST poll remains the fallback if the socket drops.
 */
export function DeliveryLiveSync({ enabled }: { enabled: boolean }) {
  useRiderGatewaySocket(enabled);

  useEffect(() => {
    if (!enabled) return;
    void refreshCsrfToken(true).catch(() => undefined);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <IncomingOfferOverlay />
      <RiderLiveToasts />
    </View>
  );
}
