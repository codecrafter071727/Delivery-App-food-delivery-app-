import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { partnerAnalyticsKeys } from '@/lib/delivery-partner/analytics-hooks';
import { partnerFinanceKeys } from '@/lib/delivery-partner/finance-hooks';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { partnerPerformanceApi } from '@/lib/delivery-partner/performance-api';
import type { WarningStatus } from '@/lib/delivery-partner/performance-types';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerPerformanceKeys = {
  all: [...deliveryPartnerKeys.all, 'performance-extra'] as const,
  acceptance: () => [...partnerPerformanceKeys.all, 'acceptance'] as const,
  cancellation: () => [...partnerPerformanceKeys.all, 'cancellation'] as const,
  ratings: () => [...partnerPerformanceKeys.all, 'ratings'] as const,
  reviews: () => [...partnerPerformanceKeys.all, 'reviews'] as const,
  ratingSummary: () => [...partnerPerformanceKeys.all, 'rating-summary'] as const,
  tier: () => [...partnerPerformanceKeys.all, 'tier'] as const,
  criteria: () => [...partnerPerformanceKeys.all, 'tier-criteria'] as const,
  warnings: (status?: string) =>
    [...partnerPerformanceKeys.all, 'warnings', status ?? 'all'] as const,
  referralCode: () => [...partnerPerformanceKeys.all, 'referral-code'] as const,
  referrals: () => [...partnerPerformanceKeys.all, 'referrals'] as const,
  referralEarnings: () => [...partnerPerformanceKeys.all, 'referral-earnings'] as const,
};

function liveQuery(isActive: boolean) {
  return {
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false as const,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  };
}

export function useAcceptanceRate(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerPerformanceKeys.acceptance(),
    queryFn: () => partnerPerformanceApi.getAcceptanceRate(),
    enabled,
    ...liveQuery(isActive),
  });
}

export function useCancellationRate(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerPerformanceKeys.cancellation(),
    queryFn: () => partnerPerformanceApi.getCancellationRate(),
    enabled,
    ...liveQuery(isActive),
  });
}

export function useRatingsHistory(enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerPerformanceKeys.ratings(),
    queryFn: ({ pageParam }) =>
      partnerPerformanceApi.getRatings({ page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useCustomerReviews(enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerPerformanceKeys.reviews(),
    queryFn: ({ pageParam }) =>
      partnerPerformanceApi.getReviews({ page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useRatingSummary(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerPerformanceKeys.ratingSummary(),
    queryFn: () => partnerPerformanceApi.getRatingSummary(),
    enabled,
    ...liveQuery(isActive),
  });
}

export function usePartnerTier(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerPerformanceKeys.tier(),
    queryFn: () => partnerPerformanceApi.getTier(),
    enabled,
    ...liveQuery(isActive),
  });
}

export function useTierCriteria(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerPerformanceKeys.criteria(),
    queryFn: () => partnerPerformanceApi.getTierCriteria(),
    enabled,
    ...liveQuery(isActive),
  });
}

export function usePartnerWarnings(status?: WarningStatus, enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerPerformanceKeys.warnings(status),
    queryFn: ({ pageParam }) =>
      partnerPerformanceApi.getWarnings({
        page: pageParam,
        limit: 20,
        status,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useReferralCode(enabled = true) {
  return useQuery({
    queryKey: partnerPerformanceKeys.referralCode(),
    queryFn: () => partnerPerformanceApi.getReferralCode(),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useReferredPartners(enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerPerformanceKeys.referrals(),
    queryFn: ({ pageParam }) =>
      partnerPerformanceApi.getReferrals({ page: pageParam, limit: 20 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useReferralEarnings(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerPerformanceKeys.referralEarnings(),
    queryFn: () => partnerPerformanceApi.getReferralEarnings(),
    enabled,
    ...liveQuery(isActive),
  });
}

export function usePerformanceMutations() {
  const queryClient = useQueryClient();

  const acknowledgeWarning = useMutation({
    mutationFn: (warningId: string) =>
      partnerPerformanceApi.acknowledgeWarning(warningId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: partnerPerformanceKeys.all }),
        queryClient.invalidateQueries({
          queryKey: partnerAnalyticsKeys.performance(),
        }),
        queryClient.invalidateQueries({ queryKey: partnerFinanceKeys.all }),
      ]);
    },
  });

  return { acknowledgeWarning };
}
