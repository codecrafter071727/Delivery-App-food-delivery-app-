import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { partnerAnalyticsKeys } from '@/lib/delivery-partner/analytics-hooks';
import { partnerFinanceKeys } from '@/lib/delivery-partner/finance-hooks';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { partnerIncentivesApi } from '@/lib/delivery-partner/incentives-api';
import type {
  LeaderboardMetric,
  LeaderboardPeriod,
  LeaderboardScope,
} from '@/lib/delivery-partner/incentives-types';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerIncentivesKeys = {
  all: [...deliveryPartnerKeys.all, 'incentives'] as const,
  list: () => [...partnerIncentivesKeys.all, 'list'] as const,
  current: () => [...partnerIncentivesKeys.all, 'current'] as const,
  history: () => [...partnerIncentivesKeys.all, 'history'] as const,
  detail: (id: string) => [...partnerIncentivesKeys.all, 'detail', id] as const,
  progress: (id: string) => [...partnerIncentivesKeys.all, 'progress', id] as const,
  rewards: () => [...partnerIncentivesKeys.all, 'rewards'] as const,
  catalog: () => [...partnerIncentivesKeys.all, 'catalog'] as const,
  quests: () => [...partnerIncentivesKeys.all, 'quests'] as const,
  challenges: () => [...partnerIncentivesKeys.all, 'challenges'] as const,
  leaderboard: (
    metric: LeaderboardMetric,
    scope: LeaderboardScope,
    period: LeaderboardPeriod
  ) => [...partnerIncentivesKeys.all, 'board', metric, scope, period] as const,
};

function invalidateIncentives(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: partnerIncentivesKeys.all }),
    queryClient.invalidateQueries({ queryKey: partnerAnalyticsKeys.incentives() }),
    queryClient.invalidateQueries({ queryKey: partnerAnalyticsKeys.earnings() }),
    queryClient.invalidateQueries({ queryKey: partnerFinanceKeys.all }),
  ]);
}

export function useIncentivePrograms(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerIncentivesKeys.list(),
    queryFn: () => partnerIncentivesApi.getIncentives(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useCurrentIncentives(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerIncentivesKeys.current(),
    queryFn: () => partnerIncentivesApi.getCurrentIncentives(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useIncentiveHistory(enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerIncentivesKeys.history(),
    queryFn: ({ pageParam }) =>
      partnerIncentivesApi.getIncentiveHistory({
        page: pageParam,
        limit: 20,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useIncentiveDetail(incentiveId?: string, enabled = true) {
  const id = incentiveId?.trim() ?? '';
  return useQuery({
    queryKey: partnerIncentivesKeys.detail(id),
    queryFn: () => partnerIncentivesApi.getIncentive(id),
    enabled: enabled && Boolean(id),
    staleTime: 8_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useIncentiveProgress(incentiveId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = incentiveId?.trim() ?? '';
  return useQuery({
    queryKey: partnerIncentivesKeys.progress(id),
    queryFn: () => partnerIncentivesApi.getIncentiveProgress(id),
    enabled: enabled && Boolean(id),
    staleTime: LIVE_INTERVALS.deliveryActive / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryActive,
      isActive && enabled
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useRewardBalance(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerIncentivesKeys.rewards(),
    queryFn: () => partnerIncentivesApi.getRewards(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryEarnings / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryEarnings,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useRewardsCatalog(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerIncentivesKeys.catalog(),
    queryFn: () => partnerIncentivesApi.getRewardsCatalog(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useQuests(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerIncentivesKeys.quests(),
    queryFn: () => partnerIncentivesApi.getQuests(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useChallenges(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerIncentivesKeys.challenges(),
    queryFn: () => partnerIncentivesApi.getChallenges(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useLeaderboard(
  input: {
    metric: LeaderboardMetric;
    scope: LeaderboardScope;
    period: LeaderboardPeriod;
  },
  enabled = true
) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerIncentivesKeys.leaderboard(
      input.metric,
      input.scope,
      input.period
    ),
    queryFn: () => partnerIncentivesApi.getLeaderboard(input),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAnalytics / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAnalytics,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useIncentiveMutations() {
  const queryClient = useQueryClient();

  const optIn = useMutation({
    mutationFn: (incentiveId: string) =>
      partnerIncentivesApi.optInIncentive(incentiveId),
    onSuccess: async (program) => {
      queryClient.setQueryData(
        partnerIncentivesKeys.detail(program.incentiveId),
        program
      );
      if (program.code) {
        queryClient.setQueryData(partnerIncentivesKeys.detail(program.code), program);
      }
      await invalidateIncentives(queryClient);
    },
  });

  const redeem = useMutation({
    mutationFn: (input: { itemId?: string; sku?: string }) =>
      partnerIncentivesApi.redeemReward(input),
    onSuccess: async () => {
      await invalidateIncentives(queryClient);
    },
  });

  return { optIn, redeem };
}
