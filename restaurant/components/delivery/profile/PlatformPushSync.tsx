import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { getAuthDeviceId } from '@/lib/auth/device';
import { deliveryPartnerApi } from '@/lib/delivery-partner/api';
import { userAccountApi } from '@/lib/user/account-api';
import { platformAccountKeys } from '@/lib/user/account-hooks';
import {
  clearStoredPushDevice,
  clearStoredRiderOfferDevice,
  loadStoredPushDevice,
  loadStoredRiderOfferDevice,
  platformAppVersion,
  platformPushPlatform,
  resolvePlatformPushToken,
  saveStoredPushDevice,
  saveStoredRiderOfferDevice,
} from '@/lib/user/push-token';
import { useAuthStore } from '@/store/auth-store';

/**
 * After rider login:
 * 1) user-service POST /users/me/devices — platform account token (profile list)
 * 2) delivery-service POST /partners/me/devices/register — offer push (app: rider)
 * Never hits notification-service /devices/register (that would double FCM).
 */
export function PlatformPushSync({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const token = useAuthStore((s) => s.token);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const lastKey = useRef('');

  useEffect(() => {
    if (!enabled || !token) return;

    let cancelled = false;
    const register = async () => {
      const pushToken = await resolvePlatformPushToken();
      if (!pushToken || cancelled) return;
      try {
        const deviceId = await getAuthDeviceId();
        const platform = platformPushPlatform();
        const appVersion = platformAppVersion();

        const device = await userAccountApi.registerDevice({
          token: pushToken,
          platform,
          deviceId,
          appVersion,
          app: 'rider',
        });
        if (!cancelled) {
          await saveStoredPushDevice(device);
          await queryClient.invalidateQueries({
            queryKey: platformAccountKeys.devices(),
          });
        }

        try {
          const offer = await deliveryPartnerApi.registerOfferDevice({
            token: pushToken,
            platform,
            deviceId,
            appVersion,
          });
          if (!cancelled && offer.deviceId) {
            await saveStoredRiderOfferDevice(offer.deviceId);
          }
        } catch {
          // Partner profile may not exist yet (setup). Retry on next foreground.
        }
      } catch {
        // Permission / Expo Go / network — rider can retry from Profile.
      }
    };

    const key = token;
    if (lastKey.current !== key) {
      lastKey.current = key;
      void register();
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void register();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [enabled, token, queryClient]);

  useEffect(() => {
    if (!isHydrated || token) return;
    lastKey.current = '';
    let cancelled = false;
    void (async () => {
      const stored = await loadStoredPushDevice();
      const offerId = await loadStoredRiderOfferDevice();
      if (cancelled) return;
      try {
        if (stored?.deviceId) {
          await userAccountApi.unregisterDevice(stored.deviceId);
        }
      } catch {
        // Already gone.
      }
      try {
        if (offerId) {
          await deliveryPartnerApi.unregisterOfferDevice(offerId);
        }
      } catch {
        // Partner session already ended.
      } finally {
        if (!cancelled) {
          await clearStoredPushDevice();
          await clearStoredRiderOfferDevice();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, token]);

  return null;
}
