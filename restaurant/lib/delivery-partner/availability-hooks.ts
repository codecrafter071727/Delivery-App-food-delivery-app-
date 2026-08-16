import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  formatDutyError,
  partnerAvailabilityApi,
} from '@/lib/delivery-partner/availability-api';
import type {
  PartnerDutyStatusSnapshot,
  SetDutyStatusPayload,
  StartBreakPayload,
} from '@/lib/delivery-partner/availability-types';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerAvailabilityKeys = {
  all: [...deliveryPartnerKeys.all, 'availability'] as const,
  status: () => [...partnerAvailabilityKeys.all, 'status'] as const,
  dutySummary: () => [...partnerAvailabilityKeys.all, 'duty-summary'] as const,
  shifts: (from?: string, to?: string) =>
    [...partnerAvailabilityKeys.all, 'shifts', from ?? '', to ?? ''] as const,
  attendance: (from?: string, to?: string) =>
    [...partnerAvailabilityKeys.all, 'attendance', from ?? '', to ?? ''] as const,
  streak: () => [...partnerAvailabilityKeys.all, 'streak'] as const,
};

const keepRetrying = (failureCount: number, error: unknown) => {
  const msg = String((error as { message?: string })?.message ?? '').toLowerCase();
  if (
    msg.includes('too many request') ||
    msg.includes('rate limit') ||
    msg.includes('slow down')
  ) {
    return false;
  }
  return failureCount < 2;
};

export function usePartnerDutyStatus(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAvailabilityKeys.status(),
    queryFn: () => partnerAvailabilityApi.getStatus(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryStatus / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryStatus,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePartnerDutySummary(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAvailabilityKeys.dutySummary(),
    queryFn: () => partnerAvailabilityApi.getDutySummary(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryStatus,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryStatus,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePartnerShifts(
  range?: { from?: string; to?: string },
  enabled = true
) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAvailabilityKeys.shifts(range?.from, range?.to),
    queryFn: () => partnerAvailabilityApi.getShifts(range),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryShifts / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryShifts,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePartnerAttendance(
  range?: { from?: string; to?: string },
  enabled = true
) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAvailabilityKeys.attendance(range?.from, range?.to),
    queryFn: () => partnerAvailabilityApi.getAttendance(range),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAttendance / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAttendance,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePartnerAttendanceStreak(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerAvailabilityKeys.streak(),
    queryFn: () => partnerAvailabilityApi.getAttendanceStreak(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryAttendance / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryAttendance,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function usePartnerDutyMutations() {
  const queryClient = useQueryClient();

  const patchStatus = (next: PartnerDutyStatusSnapshot) => {
    queryClient.setQueryData(partnerAvailabilityKeys.status(), next);
  };

  const invalidateDuty = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: partnerAvailabilityKeys.status(),
      }),
      queryClient.invalidateQueries({
        queryKey: partnerAvailabilityKeys.dutySummary(),
      }),
      queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.me() }),
      queryClient.invalidateQueries({
        queryKey: deliveryPartnerKeys.active(),
      }),
      queryClient.invalidateQueries({
        queryKey: [...partnerAvailabilityKeys.all, 'attendance'],
      }),
      queryClient.invalidateQueries({
        queryKey: partnerAvailabilityKeys.streak(),
      }),
    ]);
  };

  const startBreak = useMutation({
    mutationFn: (payload?: StartBreakPayload) =>
      partnerAvailabilityApi.startBreak(payload ?? {}),
    onSuccess: async (status) => {
      patchStatus(status);
      await invalidateDuty();
    },
  });

  const endBreak = useMutation({
    mutationFn: () => partnerAvailabilityApi.endBreak(),
    onSuccess: async (status) => {
      patchStatus(status);
      await invalidateDuty();
    },
  });

  const setDutyStatus = useMutation({
    mutationFn: (payload: SetDutyStatusPayload) =>
      partnerAvailabilityApi.setStatus(payload),
    onSuccess: async (status) => {
      patchStatus(status);
      await invalidateDuty();
    },
  });

  return { startBreak, endBreak, setDutyStatus, invalidateDuty };
}

export function usePartnerShiftMutations() {
  const queryClient = useQueryClient();

  const invalidateShifts = async () => {
    await queryClient.invalidateQueries({
      queryKey: [...partnerAvailabilityKeys.all, 'shifts'],
    });
  };

  const bookShift = useMutation({
    mutationFn: (shiftId: string) => partnerAvailabilityApi.bookShift(shiftId),
    onSuccess: async () => {
      await invalidateShifts();
    },
  });

  const cancelShift = useMutation({
    mutationFn: (shiftId: string) => partnerAvailabilityApi.cancelShift(shiftId),
    onSuccess: async () => {
      await invalidateShifts();
    },
  });

  return { bookShift, cancelShift, invalidateShifts };
}

export { formatDutyError };
