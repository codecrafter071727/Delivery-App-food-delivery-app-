import type { QueryClient } from '@tanstack/react-query';

import { partnerAnalyticsKeys } from '@/lib/delivery-partner/analytics-hooks';
import { partnerAvailabilityKeys } from '@/lib/delivery-partner/availability-hooks';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import type { RiderGatewayEvent } from '@/lib/delivery-partner/rider-gateway-types';
import { partnerTrackingKeys } from '@/lib/delivery-partner/tracking-hooks';
import { notificationKeys } from '@/lib/notification/hooks';

function invalidate(queryClient: QueryClient, queryKey: readonly unknown[]) {
  void queryClient.invalidateQueries({ queryKey, refetchType: 'active' });
}

/**
 * Apply rider Socket.IO events to TanStack Query — REST remains the fallback.
 */
export function applyRiderSocketEvent(
  queryClient: QueryClient,
  event: RiderGatewayEvent,
  _payload: unknown
) {
  switch (event) {
    case 'delivery:new':
    case 'delivery:assigned':
    case 'delivery:assignment-expiring':
    case 'delivery:cancelled':
    case 'delivery:updated':
    case 'delivery:status':
      invalidate(queryClient, deliveryPartnerKeys.active());
      invalidate(queryClient, deliveryPartnerKeys.all);
      invalidate(queryClient, partnerAvailabilityKeys.status());
      invalidate(queryClient, partnerTrackingKeys.all);
      break;
    case 'notification:new':
      invalidate(queryClient, notificationKeys.all);
      break;
    case 'earnings:updated':
    case 'wallet:credited':
      invalidate(queryClient, partnerAnalyticsKeys.all);
      break;
    default:
      break;
  }
}
