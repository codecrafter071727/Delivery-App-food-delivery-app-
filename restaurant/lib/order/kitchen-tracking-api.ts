import { api } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/errors';
import { mapOrderTracking } from '@/lib/delivery-partner/tracking-api';
import type { OrderTracking } from '@/lib/delivery-partner/tracking-types';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

/**
 * Kitchen live rider map — restaurant-service proxy only (no customer /tracking/*).
 * GET /api/v1/restaurant-service/restaurants/:id/orders/:orderId/tracking
 */
export async function fetchKitchenOrderTracking(
  restaurantId: string,
  orderId: string
): Promise<OrderTracking> {
  try {
    const response = await api.get<Envelope<unknown>>(
      `/api/v1/restaurant-service/restaurants/${encodeURIComponent(restaurantId)}/orders/${encodeURIComponent(orderId)}/tracking`,
      { timeout: 15_000 }
    );
    return mapOrderTracking(response.data?.data ?? response.data);
  } catch (error) {
    throw new Error(getApiErrorMessage(error) || 'Unable to load rider location');
  }
}
