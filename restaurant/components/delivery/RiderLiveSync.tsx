import { useEffect } from 'react';
import { Platform } from 'react-native';

import { IncomingOfferOverlay } from '@/components/delivery/orders/IncomingOfferOverlay';
import { usePartnerPricingRules } from '@/lib/delivery-partner/pricing-hooks';
import { usePartnerLocationSync } from '@/lib/delivery-partner/use-partner-location-sync';
import { useRiderGatewaySocket } from '@/lib/delivery-partner/use-rider-gateway';
import { ensureDeviceNotificationReady } from '@/lib/notification/device-alerts';
import { useAuthStore } from '@/store/auth-store';

/**
 * Keeps rider socket + GPS sync alive and mounts the incoming-offer popup globally.
 * Also warms Expo notification permission/channel so new offers alert in the tray.
 */
export function RiderLiveSync() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role ?? s.role);
  const enabled = Boolean(token) && role === 'delivery';

  useRiderGatewaySocket(enabled);
  usePartnerLocationSync(enabled);
  usePartnerPricingRules(enabled);

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    void ensureDeviceNotificationReady();
  }, [enabled]);

  if (!enabled) return null;
  return <IncomingOfferOverlay />;
}
