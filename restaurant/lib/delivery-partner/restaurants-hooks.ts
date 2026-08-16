import { useQuery } from '@tanstack/react-query';

import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { partnerRestaurantsApi } from '@/lib/delivery-partner/restaurants-api';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerRestaurantsKeys = {
  all: [...deliveryPartnerKeys.all, 'restaurants'] as const,
  list: () => [...partnerRestaurantsKeys.all, 'list'] as const,
};

/**
 * Partner restaurants list.
 * Uses mock data until USE_MOCK_PARTNER_RESTAURANTS is flipped off.
 */
export function usePartnerRestaurants(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerRestaurantsKeys.list(),
    queryFn: () => partnerRestaurantsApi.getRestaurants(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryRestaurants / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryRestaurants,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });
}
