import { useQuery } from '@tanstack/react-query';

import { restaurantFinanceApi } from '@/lib/restaurant/finance-api';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useMyRestaurantId } from '@/lib/order/hooks';

export const financeKeys = {
  all: ['restaurant-finance'] as const,
  restaurant: (restaurantId: string) =>
    [...financeKeys.all, restaurantId] as const,
  payouts: (restaurantId: string, page: number) =>
    [...financeKeys.restaurant(restaurantId), 'payouts', page] as const,
  payout: (restaurantId: string, payoutId: string) =>
    [...financeKeys.restaurant(restaurantId), 'payout', payoutId] as const,
  invoices: (restaurantId: string, page: number) =>
    [...financeKeys.restaurant(restaurantId), 'invoices', page] as const,
  commission: (restaurantId: string) =>
    [...financeKeys.restaurant(restaurantId), 'commission'] as const,
};

export function useRestaurantPayouts(page = 1) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: financeKeys.payouts(restaurantId, page),
    queryFn: () => restaurantFinanceApi.listPayouts(restaurantId, { page, limit: 20 }),
    enabled: Boolean(restaurantId),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useRestaurantPayout(payoutId: string | null) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';

  return useQuery({
    queryKey: financeKeys.payout(restaurantId, payoutId ?? ''),
    queryFn: () => restaurantFinanceApi.getPayout(restaurantId, payoutId!),
    enabled: Boolean(restaurantId && payoutId),
    staleTime: 30_000,
  });
}

export function useRestaurantInvoices(page = 1) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: financeKeys.invoices(restaurantId, page),
    queryFn: () =>
      restaurantFinanceApi.listInvoices(restaurantId, { page, limit: 20 }),
    enabled: Boolean(restaurantId),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useRestaurantCommission() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: financeKeys.commission(restaurantId),
    queryFn: () => restaurantFinanceApi.getCommission(restaurantId),
    enabled: Boolean(restaurantId),
    staleTime: 60_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}
