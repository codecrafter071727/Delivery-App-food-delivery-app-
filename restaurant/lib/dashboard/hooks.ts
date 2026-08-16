import { useQuery } from '@tanstack/react-query';

import { dashboardApi } from '@/lib/dashboard/api';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const dashboardKeys = {
  all: ['dashboard'] as const,
  stats: () => [...dashboardKeys.all, 'stats'] as const,
};

export function useDashboardStats(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: dashboardKeys.stats(),
    queryFn: () => dashboardApi.getDashboard(),
    enabled,
    // Heavier payload — slow poll; Orders owns fast live traffic.
    staleTime: 60_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.dashboard, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: (previous) => previous,
  });
}
