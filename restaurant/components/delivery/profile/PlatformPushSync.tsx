import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { getAuthDeviceId } from '@/lib/auth/device';
import { userAccountApi } from '@/lib/user/account-api';
import { platformAccountKeys } from '@/lib/user/account-hooks';
import {
  clearStoredPushDevice,
  loadStoredPushDevice,
  platformAppVersion,
  platformPushPlatform,
  resolvePlatformPushToken,
  saveStoredPushDevice,
} from '@/lib/user/push-token';
import { useAuthStore } from '@/store/auth-store';

/**
 * Registers this phone on user-service POST /users/me/devices after rider login.
 * Unregisters when the session ends. Never fakes a token.
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
        const device = await userAccountApi.registerDevice({
          token: pushToken,
          platform: platformPushPlatform(),
          deviceId,
          appVersion: platformAppVersion(),
          app: 'rider',
        });
        if (!cancelled) {
          await saveStoredPushDevice(device);
          await queryClient.invalidateQueries({
            queryKey: platformAccountKeys.devices(),
          });
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
      if (!stored || cancelled) return;
      try {
        await userAccountApi.unregisterDevice(stored.deviceId);
      } catch {
        // Already gone.
      } finally {
        if (!cancelled) await clearStoredPushDevice();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHydrated, token]);

  return null;
}
