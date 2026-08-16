import { useQuery } from '@tanstack/react-query';

import {
  resolveAnalyticsRange,
  restaurantAnalyticsApi,
} from '@/lib/analytics/api';
import type { AnalyticsPeriod } from '@/lib/analytics/types';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useMyRestaurantId } from '@/lib/order/hooks';

export const analyticsKeys = {
  all: ['restaurant-analytics'] as const,
  restaurant: (restaurantId: string) =>
    [...analyticsKeys.all, restaurantId] as const,
  overview: (restaurantId: string) =>
    [...analyticsKeys.restaurant(restaurantId), 'overview'] as const,
  revenue: (restaurantId: string, period: AnalyticsPeriod) =>
    [...analyticsKeys.restaurant(restaurantId), 'revenue', period] as const,
  topItems: (restaurantId: string, limit: number) =>
    [...analyticsKeys.restaurant(restaurantId), 'top-items', limit] as const,
  orders: (restaurantId: string, from: string, to: string) =>
    [...analyticsKeys.restaurant(restaurantId), 'orders', from, to] as const,
  cancellations: (restaurantId: string, from: string, to: string) =>
    [
      ...analyticsKeys.restaurant(restaurantId),
      'cancellations',
      from,
      to,
    ] as const,
};

function restaurantLocationLabel(
  restaurant?: {
    name?: string;
    city?: unknown;
    address?: unknown;
  } | null
) {
  if (!restaurant) return undefined;
  if (typeof restaurant.city === 'string' && restaurant.city.trim()) {
    return restaurant.city.trim();
  }
  const address =
    restaurant.address && typeof restaurant.address === 'object'
      ? (restaurant.address as Record<string, unknown>)
      : null;
  if (!address) return undefined;
  const city = String(address.city ?? '').trim();
  const state = String(address.state ?? '').trim();
  if (city && state) return `${city}, ${state}`;
  return city || state || undefined;
}

export function useAnalyticsRestaurant() {
  return useMyRestaurantId();
}

export function useAnalyticsOverview() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: analyticsKeys.overview(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => restaurantAnalyticsApi.getOverview(restaurantId),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
    restaurantCity: restaurantLocationLabel(restaurantQuery.data),
  };
}

export function useAnalyticsRevenue(period: AnalyticsPeriod) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: analyticsKeys.revenue(restaurantId, period),
    enabled: Boolean(restaurantId),
    queryFn: () => restaurantAnalyticsApi.getRevenue(restaurantId, period),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useAnalyticsTopItems(limit: number) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: analyticsKeys.topItems(restaurantId, limit),
    enabled: Boolean(restaurantId),
    queryFn: () => restaurantAnalyticsApi.getTopItems(restaurantId, limit),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useAnalyticsOrders(period: AnalyticsPeriod) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();
  const range = resolveAnalyticsRange(period);

  return useQuery({
    queryKey: analyticsKeys.orders(restaurantId, range.from, range.to),
    enabled: Boolean(restaurantId),
    queryFn: () => restaurantAnalyticsApi.getOrders(restaurantId, range),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useAnalyticsCancellations(period: AnalyticsPeriod) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();
  const range = resolveAnalyticsRange(period);

  return useQuery({
    queryKey: analyticsKeys.cancellations(restaurantId, range.from, range.to),
    enabled: Boolean(restaurantId),
    queryFn: () => restaurantAnalyticsApi.getCancellations(restaurantId, range),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.analytics, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}
