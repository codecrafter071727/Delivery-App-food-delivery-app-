import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';

import {
  addNotificationOpenListener,
  ensureDeviceNotificationReady,
  presentDeviceNotification,
} from '@/lib/notification/device-alerts';
import { subscribeKitchenEvents } from '@/lib/gateway/kitchen-client';
import type { KitchenInboundEvent } from '@/lib/gateway/kitchen-events';
import { useAuthStore } from '@/store/auth-store';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * While the kitchen process is alive (foreground or background):
 * show a local tray alert on `kitchen:order-new` when not focused.
 * Closed/killed app alerts come from FCM via notification-service.
 * Tapping a push/local alert opens the order ticket.
 */
export function KitchenNewOrderAlerts() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role ?? s.role);
  const router = useRouter();
  const seenRef = useRef(new Set<string>());
  const enabled = Boolean(token) && role === 'restaurant';

  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    void ensureDeviceNotificationReady();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeKitchenEvents((event: KitchenInboundEvent, payload) => {
      if (event !== 'kitchen:order-new') return;
      if (AppState.currentState === 'active') return;

      const record = asRecord(payload);
      const orderId = String(record.orderId ?? record.id ?? '').trim();
      if (!orderId || seenRef.current.has(orderId)) return;
      seenRef.current.add(orderId);
      if (seenRef.current.size > 80) {
        seenRef.current = new Set([...seenRef.current].slice(-40));
      }

      const orderNumber = String(record.orderNumber ?? '').trim();
      void presentDeviceNotification(
        {
          id: `kitchen-new-${orderId}`,
          title: 'New order',
          body: orderNumber
            ? `Order #${orderNumber} just arrived — open to accept.`
            : 'A new order just arrived — open to accept.',
          type: 'order_update',
          isRead: false,
          data: {
            orderId,
            restaurantId: record.restaurantId,
            kind: 'kitchen_new_order',
            screen: 'order',
          },
        },
        { channelId: 'tokajo-kitchen-orders' }
      );
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    return addNotificationOpenListener((data) => {
      const orderId = String(data.orderId ?? '').trim();
      const kind = String(data.kind ?? data.type ?? '');
      if (!orderId) return;
      if (
        kind === 'kitchen_new_order' ||
        kind === 'order_update' ||
        data.screen === 'order'
      ) {
        router.push(`/order/${encodeURIComponent(orderId)}`);
      }
    });
  }, [enabled, router]);

  return null;
}
