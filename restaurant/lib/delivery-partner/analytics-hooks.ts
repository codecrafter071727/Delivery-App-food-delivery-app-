import { useQuery } from '@tanstack/react-query';

import { partnerAnalyticsApi } from '@/lib/delivery-partner/analytics-api';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerAnalyticsKeys = {
  all: [...deliveryPartnerKeys.all, 'analytics'] as const,
  performance: () => [...partnerAnalyticsKeys.all, 'performance'] as const,
  earnings: () => [...partnerAnalyticsKeys.all, 'earnings'] as const,
  dailyEarnings: (days: number) =>
    [...partnerAnalyticsKeys.all, 'daily-earnings', days] as const,
  incentives: () => [...partnerAnalyticsKeys.all, 'incentives'] as const,
};

/** GET /partners/me/performance */
export function usePartnerPerformance(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAnalyticsKeys.performance(),
    queryFn: () => partnerAnalyticsApi.getPerformance(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });
}

/** GET /partners/me/earnings */
export function usePartnerEarnings(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAnalyticsKeys.earnings(),
    queryFn: () => partnerAnalyticsApi.getEarnings(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryEarnings / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryEarnings,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });
}

/** GET /partners/me/earnings/daily?days= */
export function usePartnerDailyEarnings(days = 30, enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAnalyticsKeys.dailyEarnings(days),
    queryFn: () => partnerAnalyticsApi.getDailyEarnings(days),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryEarnings / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryEarnings,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });
}

/** GET /partners/me/incentives */
export function usePartnerIncentives(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAnalyticsKeys.incentives(),
    queryFn: () => partnerAnalyticsApi.getIncentives(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });
}
