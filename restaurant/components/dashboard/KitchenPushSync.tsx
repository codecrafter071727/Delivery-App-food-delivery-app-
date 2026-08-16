import { useEffect, useRef } from 'react';

import {
  clearStoredKitchenDevice,
  kitchenInboxApi,
  loadStoredKitchenDevice,
  resolveKitchenPushToken,
} from '@/lib/restaurant/inbox-api';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { useAuthStore } from '@/store/auth-store';

/**
 * Registers this phone for kitchen FCM/APNs via restaurant-service.
 * Never fakes a token. Unregisters when the session ends.
 */
export function KitchenPushSync() {
  const token = useAuthStore((s) => s.token);
  const restaurant = useMyRestaurantId();
  const restaurantId = restaurant.data?.id ?? '';
  const lastKey = useRef<string>('');

  useEffect(() => {
    if (!token || !restaurantId) return;
    const key = `${restaurantId}:${token}`;
    if (lastKey.current === key) return;
    lastKey.current = key;

    let cancelled = false;
    void (async () => {
      const pushToken = await resolveKitchenPushToken();
      if (!pushToken || cancelled) return;
      const stored = await loadStoredKitchenDevice();
      try {
        await kitchenInboxApi.registerDevice(restaurantId, {
          token: pushToken,
          deviceId: stored?.restaurantId === restaurantId ? stored.deviceId : undefined,
        });
      } catch {
        // Permission or Expo Go — owner can retry from Settings.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, restaurantId]);

  useEffect(() => {
    if (token) return;
    let cancelled = false;
    void (async () => {
      const stored = await loadStoredKitchenDevice();
      if (!stored || cancelled) return;
      try {
        await kitchenInboxApi.unregisterDevice(stored.restaurantId, stored.deviceId);
      } catch {
        await clearStoredKitchenDevice();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return null;
}
