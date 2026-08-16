import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import {
  isGloballyBackingOff,
  isRateLimitedError,
  noteRateLimited,
} from '@/lib/live-query';
import { notificationApi } from '@/lib/notification/api';
import {
  addNotificationOpenListener,
  syncDeviceAlertsForNotifications,
} from '@/lib/notification/device-alerts';
import { notificationKeys } from '@/lib/notification/hooks';
import {
  isNotificationAllowed,
  loadNotificationPreferences,
} from '@/lib/notification/preferences';
import { useAuthStore } from '@/store/auth-store';

/** Gentle poll — light enough to avoid rate limits, fast enough to feel live. */
const POLL_MS = 25_000;
const BACKOFF_POLL_MS = 75_000;

/**
 * Background sync while signed in as delivery partner:
 * - Refreshes notification list + unread count automatically
 * - Shows phone tray alerts in native/dev builds (skipped in Expo Go)
 */
export function useDeliveryNotificationSync(enabled = true) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const lastCountRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    const active = Boolean(enabled && token && role === 'delivery');
    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (ms: number) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void tick();
      }, ms);
    };

    const tick = async () => {
      if (cancelled || runningRef.current) {
        scheduleNext(POLL_MS);
        return;
      }
      if (AppState.currentState !== 'active') {
        scheduleNext(POLL_MS);
        return;
      }
      if (isGloballyBackingOff()) {
        scheduleNext(BACKOFF_POLL_MS);
        return;
      }

      runningRef.current = true;
      try {
        const [unread, list, prefs] = await Promise.all([
          notificationApi.getUnreadCount(),
          notificationApi.getNotifications({ page: 1, limit: 50 }),
          loadNotificationPreferences(),
        ]);

        if (cancelled) return;

        queryClient.setQueryData(notificationKeys.unreadCount(), unread);
        queryClient.setQueryData(
          notificationKeys.list({ page: 1, limit: 50 }),
          list
        );
        // Keep any other list variants in sync (e.g. unread filter caches)
        queryClient.setQueriesData(
          { queryKey: [...notificationKeys.all, 'list'] },
          (current) => {
            if (current == null) return list;
            return list;
          }
        );

        const count = unread.count;
        const prev = lastCountRef.current;
        lastCountRef.current = count;

        await syncDeviceAlertsForNotifications(list.notifications, {
          allowed: (item) => isNotificationAllowed(item, prefs),
        });

        if (prev != null && count > prev) {
          void queryClient.invalidateQueries({
            queryKey: notificationKeys.all,
            refetchType: 'none',
          });
        }

        scheduleNext(POLL_MS);
      } catch (error) {
        if (isRateLimitedError(error)) {
          noteRateLimited(error);
          scheduleNext(BACKOFF_POLL_MS);
        } else {
          scheduleNext(POLL_MS);
        }
      } finally {
        runningRef.current = false;
      }
    };

    scheduleNext(1_200);

    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !runningRef.current) {
        if (timer) clearTimeout(timer);
        scheduleNext(400);
      }
    });

    const responseSub = addNotificationOpenListener(() => {
      router.push(DELIVERY_ROUTES.notifications as never);
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      appSub.remove();
      responseSub.remove();
    };
  }, [enabled, token, role, queryClient, router]);
}
