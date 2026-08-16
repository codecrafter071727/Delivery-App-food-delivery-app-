import { useAuthStore } from '@/store/auth-store';
import { useKitchenGatewaySocket } from '@/lib/gateway/kitchen-socket';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useUnreadNotificationCount } from '@/lib/notification/hooks';
import { useMyRestaurantId, useRestaurantOrders } from '@/lib/order/hooks';

/**
 * Kitchen live layer: Socket.IO `join:restaurant` plus REST poll fallback.
 */
export function RestaurantLiveSync() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role ?? s.role);
  const isActive = useAppIsActive();
  const enabled = Boolean(token) && role === 'restaurant';

  const restaurant = useMyRestaurantId({ enabled });
  const restaurantId = restaurant.data?.id;

  useRestaurantOrders(enabled ? restaurantId : undefined, {
    enabled: enabled && Boolean(restaurantId),
  });

  useUnreadNotificationCount({
    enabled,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.notifications,
      isActive && enabled
    ),
  });

  useKitchenGatewaySocket(restaurantId, enabled && Boolean(restaurantId));

  return null;
}
