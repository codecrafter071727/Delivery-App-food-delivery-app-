import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { deliveryPartnerApi } from '@/lib/delivery-partner/api';
import type {
  DeliverOrderPayload,
  DeliveryPartnerProfile,
  PartnerDelivery,
  UpdatePartnerProfilePayload,
  UploadPartnerDocumentPayload,
} from '@/lib/delivery-partner/types';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const deliveryPartnerKeys = {
  all: ['delivery-partner'] as const,
  me: () => [...deliveryPartnerKeys.all, 'me'] as const,
  active: () => [...deliveryPartnerKeys.all, 'active-delivery'] as const,
  history: (limit: number) =>
    [...deliveryPartnerKeys.all, 'deliveries', limit] as const,
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

function patchActiveCache(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (current: PartnerDelivery | null | undefined) => PartnerDelivery | null
) {
  queryClient.setQueryData<PartnerDelivery | null>(
    deliveryPartnerKeys.active(),
    (current) => updater(current)
  );
}

export function useDeliveryPartnerMe(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: deliveryPartnerKeys.me(),
    queryFn: () => deliveryPartnerApi.getMe(),
    enabled,
    staleTime: LIVE_INTERVALS.deliveryMe / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.deliveryMe, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useActiveDelivery(
  enabled = true,
  options?: { fast?: boolean }
) {
  const isActive = useAppIsActive();
  const intervalMs = options?.fast
    ? Math.min(LIVE_INTERVALS.deliveryActive, 5_000)
    : LIVE_INTERVALS.deliveryActive;

  return useQuery({
    queryKey: deliveryPartnerKeys.active(),
    queryFn: () => deliveryPartnerApi.getActiveDelivery(),
    enabled,
    staleTime: intervalMs / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(intervalMs, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useDeliveryHistory(limit = 20, enabled = true) {
  const isActive = useAppIsActive();

  return useInfiniteQuery({
    queryKey: deliveryPartnerKeys.history(limit),
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      deliveryPartnerApi.getDeliveries({ page: pageParam, limit }),
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    staleTime: LIVE_INTERVALS.deliveryHistory / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryHistory,
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

/**
 * @deprecated Queries already live-poll via refetchInterval.
 * Kept as a no-op so existing call sites don't break.
 */
export function useOrdersAutoRefresh(_enabled = true) {
  // Active delivery + me hooks auto-refresh while the app is foregrounded.
}

export function useDeliveryOrderMutations() {
  const queryClient = useQueryClient();

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.active() }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'deliveries'],
      }),
      queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.me() }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'analytics'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'availability'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'tracking'],
      }),
    ]);
  };

  const applyDeliveryResult = (delivery: PartnerDelivery) => {
    const status = delivery.status.toLowerCase();
    if (
      status === 'delivered' ||
      status === 'rejected' ||
      status === 'cancelled'
    ) {
      queryClient.setQueryData(deliveryPartnerKeys.active(), null);
    } else if (delivery.id) {
      queryClient.setQueryData(deliveryPartnerKeys.active(), delivery);
    }
  };

  const setOnline = useMutation({
    mutationFn: (isOnline: boolean) => deliveryPartnerApi.setOnline(isOnline),
    onMutate: async (isOnline) => {
      await queryClient.cancelQueries({ queryKey: deliveryPartnerKeys.me() });
      const previous = queryClient.getQueryData<DeliveryPartnerProfile | null>(
        deliveryPartnerKeys.me()
      );
      if (previous) {
        queryClient.setQueryData<DeliveryPartnerProfile>(
          deliveryPartnerKeys.me(),
          {
            ...previous,
            isOnline,
            isAvailable: isOnline,
            dutyStatus: isOnline ? 'online' : 'offline',
          }
        );
      }
      queryClient.setQueryData(
        [...deliveryPartnerKeys.all, 'availability', 'status'],
        (prev) => {
        if (!prev || typeof prev !== 'object') return prev;
        const current = prev as {
          dutyStatus?: string;
          isOnline?: boolean;
          isAvailable?: boolean;
          break?: { active?: boolean };
        };
        return {
          ...current,
          dutyStatus: isOnline ? 'online' : 'offline',
          isOnline,
          isAvailable: isOnline,
          break: current.break
            ? { ...current.break, active: isOnline ? current.break.active : false }
            : current.break,
        };
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(deliveryPartnerKeys.me(), ctx.previous);
      }
    },
    onSuccess: async (profile) => {
      queryClient.setQueryData(deliveryPartnerKeys.me(), profile);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: deliveryPartnerKeys.active(),
        }),
        queryClient.invalidateQueries({
          queryKey: [...deliveryPartnerKeys.all, 'deliveries'],
        }),
        queryClient.invalidateQueries({
          queryKey: deliveryPartnerKeys.me(),
        }),
        queryClient.invalidateQueries({
          queryKey: [...deliveryPartnerKeys.all, 'availability', 'status'],
        }),
      ]);
    },
  });

  const accept = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.acceptDelivery(deliveryId),
    onMutate: async () => {
      const previous = queryClient.getQueryData<PartnerDelivery | null>(
        deliveryPartnerKeys.active()
      );
      if (previous) {
        patchActiveCache(queryClient, (cur) =>
          cur ? { ...cur, status: 'accepted' } : cur ?? null
        );
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(deliveryPartnerKeys.active(), ctx.previous);
      }
    },
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const reject = useMutation({
    mutationFn: ({
      deliveryId,
      reason,
      reasonCode,
    }: {
      deliveryId: string;
      reason: string;
      reasonCode?: string;
    }) => deliveryPartnerApi.rejectDelivery(deliveryId, { reason, reasonCode }),
    onSuccess: async () => {
      queryClient.setQueryData(deliveryPartnerKeys.active(), null);
      await invalidateAll();
    },
  });

  const arrived = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.markArrived(deliveryId),
    onMutate: async () => {
      const previous = queryClient.getQueryData<PartnerDelivery | null>(
        deliveryPartnerKeys.active()
      );
      patchActiveCache(queryClient, (cur) =>
        cur ? { ...cur, status: 'arrived' } : cur ?? null
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(deliveryPartnerKeys.active(), ctx.previous);
      }
    },
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const pickup = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.markPickedUp(deliveryId),
    onMutate: async () => {
      const previous = queryClient.getQueryData<PartnerDelivery | null>(
        deliveryPartnerKeys.active()
      );
      patchActiveCache(queryClient, (cur) =>
        cur ? { ...cur, status: 'picked_up' } : cur ?? null
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(deliveryPartnerKeys.active(), ctx.previous);
      }
    },
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const reachedCustomer = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.markReachedCustomer(deliveryId),
    onMutate: async () => {
      const previous = queryClient.getQueryData<PartnerDelivery | null>(
        deliveryPartnerKeys.active()
      );
      patchActiveCache(queryClient, (cur) =>
        cur ? { ...cur, status: 'at_customer' } : cur ?? null
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(deliveryPartnerKeys.active(), ctx.previous);
      }
    },
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const deliver = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload?: DeliverOrderPayload;
    }) => deliveryPartnerApi.markDelivered(deliveryId, payload ?? {}),
    onSuccess: async () => {
      queryClient.setQueryData(deliveryPartnerKeys.active(), null);
      await invalidateAll();
    },
  });

  return { setOnline, accept, reject, arrived, pickup, reachedCustomer, deliver, invalidateAll };
}

/** POST /partners/me/documents */
export function useUploadPartnerDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UploadPartnerDocumentPayload) =>
      deliveryPartnerApi.uploadDocument(payload),
    onSuccess: (profile) => {
      if (profile?.id) {
        queryClient.setQueryData(deliveryPartnerKeys.me(), profile);
      }
      void queryClient.invalidateQueries({
        queryKey: deliveryPartnerKeys.me(),
      });
    },
  });
}

/** PUT /partners/me */
export function useUpdatePartnerProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdatePartnerProfilePayload) =>
      deliveryPartnerApi.updateProfile(payload),
    onSuccess: (profile) => {
      if (profile?.id) {
        queryClient.setQueryData(deliveryPartnerKeys.me(), profile);
      }
      void queryClient.invalidateQueries({
        queryKey: deliveryPartnerKeys.me(),
      });
    },
  });
}
