import { useEffect, useRef } from 'react';

import { getAuthDeviceId } from '@/lib/auth/device';
import {
  clearStoredKitchenDevice,
  kitchenInboxApi,
  loadStoredKitchenDevice,
  resolveKitchenPushToken,
} from '@/lib/restaurant/inbox-api';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { userAccountApi } from '@/lib/user/account-api';
import {
  clearStoredPushDevice,
  loadStoredPushDevice,
  platformAppVersion,
  platformPushPlatform,
  saveStoredPushDevice,
} from '@/lib/user/push-token';
import { useAuthStore } from '@/store/auth-store';

/**
 * After kitchen login:
 * 1) restaurant-service POST .../devices — order alerts
 * 2) user-service POST /users/me/devices — account token (app: kitchen)
 * Never invents a token. Unregisters both when the session ends.
 */
export function KitchenPushSync() {
  const token = useAuthStore((s) => s.token);
  const restaurant = useMyRestaurantId();
  const restaurantId = restaurant.data?.id ?? '';
  const lastOutletKey = useRef<string>('');
  const lastAccountKey = useRef<string>('');

  useEffect(() => {
    if (!token || !restaurantId) return;
    const key = `${restaurantId}:${token}`;
    if (lastOutletKey.current === key) return;
    lastOutletKey.current = key;

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
    if (!token) return;
    if (lastAccountKey.current === token) return;
    lastAccountKey.current = token;

    let cancelled = false;
    void (async () => {
      const pushToken = await resolveKitchenPushToken();
      if (!pushToken || cancelled) return;
      try {
        const device = await userAccountApi.registerDevice({
          token: pushToken,
          platform: platformPushPlatform(),
          deviceId: await getAuthDeviceId(),
          appVersion: platformAppVersion(),
          app: 'kitchen',
        });
        if (!cancelled) await saveStoredPushDevice(device);
      } catch {
        // Owner can retry from Admin → Your account.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (token) return;
    lastOutletKey.current = '';
    lastAccountKey.current = '';
    let cancelled = false;
    void (async () => {
      const stored = await loadStoredKitchenDevice();
      if (stored && !cancelled) {
        try {
          await kitchenInboxApi.unregisterDevice(stored.restaurantId, stored.deviceId);
        } catch {
          await clearStoredKitchenDevice();
        }
      }
      const account = await loadStoredPushDevice();
      if (account && !cancelled) {
        try {
          await userAccountApi.unregisterDevice(account.deviceId);
        } catch {
          await clearStoredPushDevice();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return null;
}
