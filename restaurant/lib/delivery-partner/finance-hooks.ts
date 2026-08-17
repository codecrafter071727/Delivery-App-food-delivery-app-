import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { partnerFinanceApi } from '@/lib/delivery-partner/finance-api';
import type { CodRemitPayload } from '@/lib/delivery-partner/finance-types';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerFinanceKeys = {
  all: [...deliveryPartnerKeys.all, 'finance'] as const,
  wallet: () => [...partnerFinanceKeys.all, 'wallet'] as const,
  transactions: (type?: string) =>
    [...partnerFinanceKeys.all, 'txns', type ?? 'all'] as const,
  tripEarnings: (deliveryId: string) =>
    [...partnerFinanceKeys.all, 'trip-earnings', deliveryId] as const,
  payouts: () => [...partnerFinanceKeys.all, 'payouts'] as const,
  payout: (payoutId: string) =>
    [...partnerFinanceKeys.all, 'payout', payoutId] as const,
  eligibility: () => [...partnerFinanceKeys.all, 'eligibility'] as const,
  schedule: () => [...partnerFinanceKeys.all, 'schedule'] as const,
  codPending: () => [...partnerFinanceKeys.all, 'cod-pending'] as const,
  codLimit: () => [...partnerFinanceKeys.all, 'cod-limit'] as const,
  remittances: () => [...partnerFinanceKeys.all, 'remittances'] as const,
};

function invalidateFinance(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: partnerFinanceKeys.all }),
    queryClient.invalidateQueries({
      queryKey: [...deliveryPartnerKeys.all, 'analytics'],
    }),
    queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.active() }),
    queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.actives() }),
    queryClient.invalidateQueries({
      queryKey: [...deliveryPartnerKeys.all, 'delivery'],
    }),
  ]);
}

export function usePartnerWallet(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerFinanceKeys.wallet(),
    queryFn: () => partnerFinanceApi.getWallet(),
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

export function useWalletTransactions(type?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerFinanceKeys.transactions(type),
    queryFn: ({ pageParam }) =>
      partnerFinanceApi.getWalletTransactions({
        page: pageParam,
        limit: 20,
        type: type || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useTripEarnings(deliveryId?: string, enabled = true) {
  return useQuery({
    queryKey: partnerFinanceKeys.tripEarnings(deliveryId ?? ''),
    queryFn: () => partnerFinanceApi.getTripEarnings(deliveryId!),
    enabled: enabled && Boolean(deliveryId),
    staleTime: 30_000,
    retry: 1,
  });
}

export function usePartnerPayouts(enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerFinanceKeys.payouts(),
    queryFn: ({ pageParam }) => partnerFinanceApi.getPayouts(pageParam, 20),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function usePartnerPayout(payoutId?: string, enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerFinanceKeys.payout(payoutId ?? ''),
    queryFn: () => partnerFinanceApi.getPayout(payoutId!),
    enabled: enabled && Boolean(payoutId),
    staleTime: 8_000,
    refetchInterval: (query) => {
      const status = String(query.state.data?.status ?? '').toLowerCase();
      if (!isActive) return false;
      if (status === 'processing' || status === 'pending') {
        return liveRefetchInterval(12_000, isActive);
      }
      return false;
    },
    refetchOnWindowFocus: true,
  });
}

export function useInstantPayoutEligibility(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerFinanceKeys.eligibility(),
    queryFn: () => partnerFinanceApi.getInstantEligibility(),
    enabled,
    staleTime: 15_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryEarnings,
      isActive
    ),
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function usePayoutSchedule(enabled = true) {
  return useQuery({
    queryKey: partnerFinanceKeys.schedule(),
    queryFn: () => partnerFinanceApi.getPayoutSchedule(),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useCodPending(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerFinanceKeys.codPending(),
    queryFn: () => partnerFinanceApi.getCodPending(),
    enabled,
    staleTime: 15_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryEarnings,
      isActive
    ),
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useCodLimitStatus(enabled = true) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerFinanceKeys.codLimit(),
    queryFn: () => partnerFinanceApi.getCodLimitStatus(),
    enabled,
    staleTime: 15_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryStatus,
      isActive
    ),
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useCodRemittanceHistory(enabled = true) {
  return useInfiniteQuery({
    queryKey: partnerFinanceKeys.remittances(),
    queryFn: ({ pageParam }) =>
      partnerFinanceApi.getCodRemittanceHistory(pageParam, 20),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export function useFinanceMutations() {
  const queryClient = useQueryClient();

  const instantPayout = useMutation({
    mutationFn: (amount?: number) =>
      partnerFinanceApi.requestInstantPayout(amount),
    onSuccess: async (payout) => {
      queryClient.setQueryData(partnerFinanceKeys.payout(payout.payoutId), payout);
      await invalidateFinance(queryClient);
    },
  });

  const remitCod = useMutation({
    mutationFn: (payload: CodRemitPayload) => partnerFinanceApi.remitCod(payload),
    onSuccess: async () => {
      await invalidateFinance(queryClient);
    },
  });

  const createUpiQr = useMutation({
    mutationFn: (deliveryId: string) =>
      partnerFinanceApi.createCodUpiQr(deliveryId),
  });

  const markUpi = useMutation({
    mutationFn: (input: { deliveryId: string; txnRef: string; note?: string }) =>
      partnerFinanceApi.markCodUpi(input.deliveryId, input.txnRef, input.note),
    onSuccess: async (result) => {
      const patch = (current: unknown) => {
        if (!current || typeof current !== 'object') return current;
        const row = current as { id?: string };
        if (row.id && row.id !== result.deliveryId) return current;
        return {
          ...(current as object),
          settledVia: result.settledVia,
          cashCollected: false,
        };
      };
      queryClient.setQueryData(
        [...deliveryPartnerKeys.all, 'delivery', result.deliveryId],
        patch
      );
      queryClient.setQueryData(deliveryPartnerKeys.active(), patch);
      queryClient.setQueryData(
        deliveryPartnerKeys.actives(),
        (list: unknown) =>
          Array.isArray(list)
            ? list.map((item) =>
                (item as { id?: string }).id === result.deliveryId
                  ? patch(item)
                  : item
              )
            : list
      );
      await invalidateFinance(queryClient);
    },
  });

  return { instantPayout, remitCod, createUpiQr, markUpi };
}
