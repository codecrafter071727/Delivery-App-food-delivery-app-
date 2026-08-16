import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardKeys } from '@/lib/dashboard/hooks';
import { restaurantOnboardingApi } from '@/lib/restaurant/onboarding-api';
import { IFSC_RE } from '@/lib/restaurant/onboarding-types';
import type {
  UpdateBankPayload,
  UploadKycPayload,
} from '@/lib/restaurant/onboarding-types';
import { restaurantOutletKeys } from '@/lib/restaurant/hooks';

export const onboardingKeys = {
  all: ['restaurant-onboarding'] as const,
  status: (restaurantId: string) =>
    [...onboardingKeys.all, 'status', restaurantId] as const,
  documents: (restaurantId: string) =>
    [...onboardingKeys.all, 'documents', restaurantId] as const,
  bank: (restaurantId: string) =>
    [...onboardingKeys.all, 'bank', restaurantId] as const,
  ifsc: (restaurantId: string, ifsc: string) =>
    [...onboardingKeys.all, 'ifsc', restaurantId, ifsc] as const,
};

export function useOnboardingStatus(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: onboardingKeys.status(restaurantId ?? ''),
    queryFn: () => restaurantOnboardingApi.getOnboarding(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useOnboardingDocuments(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: onboardingKeys.documents(restaurantId ?? ''),
    queryFn: () => restaurantOnboardingApi.getDocuments(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useRestaurantBank(
  restaurantId: string | undefined,
  enabled = true
) {
  return useQuery({
    queryKey: onboardingKeys.bank(restaurantId ?? ''),
    queryFn: () => restaurantOnboardingApi.getBank(restaurantId!),
    enabled: enabled && Boolean(restaurantId),
    staleTime: 20_000,
    retry: 1,
  });
}

export function useIfscLookup(
  restaurantId: string | undefined,
  ifsc: string,
  enabled = true
) {
  const code = ifsc.replace(/\s/g, '').toUpperCase();
  const valid = IFSC_RE.test(code);
  return useQuery({
    queryKey: onboardingKeys.ifsc(restaurantId ?? '', code),
    queryFn: () => restaurantOnboardingApi.lookupIfsc(restaurantId!, code),
    enabled: enabled && Boolean(restaurantId) && valid,
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });
}

export function useOnboardingMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all }),
      queryClient.invalidateQueries({
        queryKey: ['restaurant-settings'],
      }),
      queryClient.invalidateQueries({ queryKey: ['owner-restaurant', 'my'] }),
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all }),
      queryClient.invalidateQueries({
        queryKey: restaurantOutletKeys.duty(restaurantId),
      }),
    ]);
  };

  const uploadDocuments = useMutation({
    mutationFn: (payload: UploadKycPayload) =>
      restaurantOnboardingApi.uploadDocuments(restaurantId, payload),
    onSuccess: async (data) => {
      queryClient.setQueryData(onboardingKeys.documents(restaurantId), data);
      await invalidate();
    },
  });

  const submitKyc = useMutation({
    mutationFn: () => restaurantOnboardingApi.submit(restaurantId),
    onSuccess: async () => {
      await invalidate();
    },
  });

  const updateBank = useMutation({
    mutationFn: (payload: UpdateBankPayload) =>
      restaurantOnboardingApi.updateBank(restaurantId, payload),
    onSuccess: async (data) => {
      queryClient.setQueryData(onboardingKeys.bank(restaurantId), data);
      await invalidate();
    },
  });

  return { uploadDocuments, submitKyc, updateBank };
}
