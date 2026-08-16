import Constants from 'expo-constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/lib/dashboard/hooks';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { restaurantOwnerApi } from '@/lib/restaurant/api';
import { CUISINE_OPTIONS } from '@/lib/restaurant/settings-types';
import type { HolidayRow, PauseReasonCode, SpecialHoursDay } from '@/lib/restaurant/types';

export const restaurantOutletKeys = {
  all: ['restaurant-outlet'] as const,
  health: () => [...restaurantOutletKeys.all, 'health'] as const,
  cuisines: () => [...restaurantOutletKeys.all, 'cuisines'] as const,
  config: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'config', restaurantId] as const,
  duty: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'duty', restaurantId] as const,
  surge: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'surge', restaurantId] as const,
  timings: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'timings', restaurantId] as const,
  holidays: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'holidays', restaurantId] as const,
  specialHours: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'special-hours', restaurantId] as const,
  hygiene: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'hygiene', restaurantId] as const,
  ratings: (restaurantId: string) =>
    [...restaurantOutletKeys.all, 'ratings', restaurantId] as const,
};

export function kitchenAppVersion() {
  return (
    Constants.expoConfig?.version?.trim() ||
    Constants.nativeAppVersion?.trim() ||
    '1.0.0'
  );
}

/** GET /health + GET /health/ready on restaurant-service. */
export function useRestaurantServiceHealth(enabled = true) {
  return useQuery({
    queryKey: restaurantOutletKeys.health(),
    queryFn: () => restaurantOwnerApi.getServiceHealth(),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/** GET /cuisines — catalog chips for create/edit. Falls back to local list. */
export function useCuisineCatalog(enabled = true) {
  const query = useQuery({
    queryKey: restaurantOutletKeys.cuisines(),
    queryFn: () => restaurantOwnerApi.listCuisines(),
    enabled,
    staleTime: 10 * 60_000,
    retry: 1,
  });

  const names =
    query.data && query.data.length
      ? query.data.map((row) => row.name)
      : [...CUISINE_OPTIONS];

  return {
    ...query,
    names,
    fromApi: Boolean(query.data && query.data.length),
  };
}

/** GET /restaurants/:id/config?appVersion= */
export function useKitchenConfig(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: restaurantOutletKeys.config(restaurantId ?? ''),
    queryFn: () =>
      restaurantOwnerApi.getConfig(restaurantId!, kitchenAppVersion()),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 60_000,
    retry: false,
  });
}

/** GET /restaurants/:id/duty — online / pause / hours snapshot. */
export function useKitchenDuty(
  restaurantId: string | undefined,
  enabled = true
) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: restaurantOutletKeys.duty(restaurantId ?? ''),
    queryFn: () => restaurantOwnerApi.getDuty(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 8_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.duty, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** GET /restaurants/:id/surge-status — zone rain/surge chip. */
export function useKitchenSurge(
  restaurantId: string | undefined,
  enabled = true
) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: restaurantOutletKeys.surge(restaurantId ?? ''),
    queryFn: () => restaurantOwnerApi.getSurgeStatus(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 30_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.duty, isActive),
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** GET /restaurants/:id/timings — week hours + isOpenNow. */
export function useOutletTimings(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: restaurantOutletKeys.timings(restaurantId ?? ''),
    queryFn: () => restaurantOwnerApi.getTimings(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 20_000,
    retry: 1,
  });
}

/** GET /restaurants/:id/holidays — closed dates. */
export function useOutletHolidays(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: restaurantOutletKeys.holidays(restaurantId ?? ''),
    queryFn: () => restaurantOwnerApi.getHolidays(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 60_000,
    retry: 1,
  });
}

export function useKitchenDutyMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const seedDuty = (duty: Awaited<ReturnType<typeof restaurantOwnerApi.getDuty>>) => {
    queryClient.setQueryData(restaurantOutletKeys.duty(restaurantId), duty);
  };

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.duty(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.surge(restaurantId),
      }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['owner-restaurant', 'my'] }),
      queryClient.invalidateQueries({ queryKey: ['restaurant-settings'] }),
    ]);
  };

  const goOnline = useMutation({
    mutationFn: () => restaurantOwnerApi.goOnline(restaurantId),
    onSuccess: async (duty) => {
      seedDuty(duty);
      await invalidate();
    },
  });

  const goOffline = useMutation({
    mutationFn: () => restaurantOwnerApi.goOffline(restaurantId),
    onSuccess: async (duty) => {
      seedDuty(duty);
      await invalidate();
    },
  });

  const pauseDuty = useMutation({
    mutationFn: (input: { minutes: number; reason: PauseReasonCode }) =>
      restaurantOwnerApi.pauseDuty(restaurantId, input),
    onSuccess: async (duty) => {
      seedDuty(duty);
      await invalidate();
    },
  });

  const setDutyStatus = useMutation({
    mutationFn: (status: 'online' | 'offline') =>
      restaurantOwnerApi.setDutyStatus(restaurantId, status),
    onSuccess: async (duty) => {
      seedDuty(duty);
      await invalidate();
    },
  });

  return { goOnline, goOffline, pauseDuty, setDutyStatus };
}

/** GET /restaurants/:id/special-hours */
export function useOutletSpecialHours(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: restaurantOutletKeys.specialHours(restaurantId ?? ''),
    queryFn: () => restaurantOwnerApi.getSpecialHours(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 20_000,
    retry: 1,
  });
}

/** GET /restaurants/:id/hygiene — 404 until listing is live. */
export function useOutletHygiene(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: restaurantOutletKeys.hygiene(restaurantId ?? ''),
    queryFn: () => restaurantOwnerApi.getHygiene(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 60_000,
    retry: false,
  });
}

/** GET /restaurants/:id/ratings — star histogram. */
export function useOutletRatings(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: restaurantOutletKeys.ratings(restaurantId ?? ''),
    queryFn: () => restaurantOwnerApi.getRatings(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 30_000,
    retry: false,
  });
}

export function useOutletCalendarMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.holidays(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.specialHours(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.timings(restaurantId),
      }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.duty(restaurantId),
      }),
    ]);
  };

  const updateHolidays = useMutation({
    mutationFn: (holidays: HolidayRow[]) =>
      restaurantOwnerApi.updateHolidays(restaurantId, holidays),
    onSuccess: async (data) => {
      queryClient.setQueryData(restaurantOutletKeys.holidays(restaurantId), data);
      await invalidate();
    },
  });

  const updateSpecialHours = useMutation({
    mutationFn: (
      input:
        | { date: string; remove: true }
        | {
            date: string;
            isOpen: boolean;
            slots?: SpecialHoursDay['slots'];
            reason?: string;
          }
    ) => restaurantOwnerApi.updateSpecialHours(restaurantId, input),
    onSuccess: async (data) => {
      queryClient.setQueryData(
        restaurantOutletKeys.specialHours(restaurantId),
        data
      );
      await invalidate();
    },
  });

  return { updateHolidays, updateSpecialHours };
}
