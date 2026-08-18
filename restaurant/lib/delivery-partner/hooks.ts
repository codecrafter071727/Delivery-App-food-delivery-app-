import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { deliveryPartnerApi, normalizeDeliveryStatus } from '@/lib/delivery-partner/api';
import { announceOrderReturned } from '@/lib/delivery-partner/rider-ack';
import type {
  CancelDeliveryPayload,
  ConfirmBatchSequencePayload,
  CompleteReturnPayload,
  CustomerUnreachablePayload,
  DeliverOrderPayload,
  DeliveryChatTo,
  DeliveryPartnerProfile,
  FailDeliveryPayload,
  PartnerDelivery,
  PickupVerifyPayload,
  ReportIssuePayload,
  ReturnToRestaurantPayload,
  UpdatePartnerProfilePayload,
  UploadPartnerDocumentPayload,
} from '@/lib/delivery-partner/types';
import { getApiErrorCode } from '@/lib/errors';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const deliveryPartnerKeys = {
  all: ['delivery-partner'] as const,
  me: () => [...deliveryPartnerKeys.all, 'me'] as const,
  active: () => [...deliveryPartnerKeys.all, 'active-delivery'] as const,
  actives: () => [...deliveryPartnerKeys.all, 'active-deliveries'] as const,
  history: (limit: number, status?: string) =>
    [...deliveryPartnerKeys.all, 'deliveries', limit, status ?? 'default'] as const,
  delivery: (id: string) => [...deliveryPartnerKeys.all, 'delivery', id] as const,
  timeline: (id: string) => [...deliveryPartnerKeys.all, 'timeline', id] as const,
  events: (id: string) => [...deliveryPartnerKeys.all, 'events', id] as const,
  batch: (id: string) => [...deliveryPartnerKeys.all, 'batch', id] as const,
  chat: (id: string) => [...deliveryPartnerKeys.all, 'chat', id] as const,
  tripRoute: (id: string) => [...deliveryPartnerKeys.all, 'trip-route', id] as const,
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

export function useActiveDeliveries(
  enabled = true,
  options?: { fast?: boolean }
) {
  const isActive = useAppIsActive();
  const intervalMs = options?.fast
    ? Math.min(LIVE_INTERVALS.deliveryActive, 5_000)
    : LIVE_INTERVALS.deliveryActive;

  return useQuery<PartnerDelivery[]>({
    queryKey: deliveryPartnerKeys.actives(),
    queryFn: () => deliveryPartnerApi.getActiveDeliveries(),
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

export function useDeliveryDetail(
  deliveryId?: string,
  enabled = true,
  options?: { live?: boolean; intervalMs?: number }
) {
  const id = deliveryId?.trim() ?? '';
  const isActive = useAppIsActive();
  const intervalMs = options?.intervalMs ?? 4_000;
  return useQuery({
    queryKey: deliveryPartnerKeys.delivery(id),
    queryFn: () => deliveryPartnerApi.getDelivery(id),
    enabled: enabled && Boolean(id),
    staleTime: options?.live ? intervalMs / 2 : 8_000,
    gcTime: 5 * 60_000,
    refetchInterval: options?.live
      ? liveRefetchInterval(intervalMs, isActive)
      : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useDeliveryTimeline(
  deliveryId?: string,
  options?: { enabled?: boolean; live?: boolean }
) {
  const id = deliveryId?.trim() ?? '';
  const enabled = (options?.enabled ?? true) && Boolean(id);
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: deliveryPartnerKeys.timeline(id),
    queryFn: () => deliveryPartnerApi.getDeliveryTimeline(id),
    enabled,
    staleTime: 6_000,
    gcTime: 5 * 60_000,
    refetchInterval: options?.live
      ? liveRefetchInterval(12_000, isActive)
      : false,
    refetchOnWindowFocus: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useDeliveryEvents(
  deliveryId?: string,
  options?: { enabled?: boolean; live?: boolean }
) {
  const id = deliveryId?.trim() ?? '';
  const enabled = (options?.enabled ?? true) && Boolean(id);
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: deliveryPartnerKeys.events(id),
    queryFn: () => deliveryPartnerApi.getDeliveryEvents(id),
    enabled,
    staleTime: 8_000,
    gcTime: 5 * 60_000,
    refetchInterval: options?.live
      ? liveRefetchInterval(15_000, isActive)
      : false,
    refetchOnWindowFocus: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useDeliveryBatch(
  batchId?: string,
  options?: { enabled?: boolean; live?: boolean }
) {
  const id = batchId?.trim() ?? '';
  const enabled = (options?.enabled ?? true) && Boolean(id);
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: deliveryPartnerKeys.batch(id),
    queryFn: () => deliveryPartnerApi.getBatch(id),
    enabled,
    staleTime: 4_000,
    gcTime: 5 * 60_000,
    refetchInterval: options?.live
      ? liveRefetchInterval(5_000, isActive)
      : false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useTripChat(deliveryId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = deliveryId?.trim() ?? '';

  return useQuery({
    queryKey: deliveryPartnerKeys.chat(id),
    queryFn: () => deliveryPartnerApi.getTripChat(id),
    enabled: enabled && Boolean(id),
    staleTime: 4_000,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(8_000, isActive),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useSendTripChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deliveryId,
      to,
      text,
    }: {
      deliveryId: string;
      to: DeliveryChatTo;
      text: string;
    }) => deliveryPartnerApi.sendTripChat(deliveryId, { to, text }),
    onSuccess: (message) => {
      queryClient.setQueryData(
        deliveryPartnerKeys.chat(message.deliveryId),
        (current) => {
          if (!current || typeof current !== 'object') return current;
          const thread = current as {
            messages?: typeof message[];
            count?: number;
          };
          const existing = thread.messages ?? [];
          if (existing.some((row) => row.id === message.id)) return current;
          return {
            ...thread,
            count: (thread.count ?? existing.length) + 1,
            messages: [...existing, message],
          };
        }
      );
    },
  });
}

export function useSendQuickReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      deliveryId,
      templateId,
      to,
    }: {
      deliveryId: string;
      templateId: string;
      to?: DeliveryChatTo;
    }) =>
      deliveryPartnerApi.sendQuickReply({ deliveryId, templateId, to }),
    onSuccess: (message) => {
      queryClient.setQueryData(
        deliveryPartnerKeys.chat(message.deliveryId),
        (current) => {
          if (!current || typeof current !== 'object') return current;
          const thread = current as {
            messages?: typeof message[];
            count?: number;
          };
          const existing = thread.messages ?? [];
          if (existing.some((row) => row.id === message.id)) return current;
          return {
            ...thread,
            count: (thread.count ?? existing.length) + 1,
            messages: [...existing, message],
          };
        }
      );
    },
  });
}

export function useTripNavRoute(deliveryId?: string, enabled = true) {
  const isActive = useAppIsActive();
  const id = deliveryId?.trim() ?? '';

  return useQuery({
    queryKey: deliveryPartnerKeys.tripRoute(id),
    queryFn: async () => {
      try {
        return await deliveryPartnerApi.getTripRoute(id);
      } catch (error) {
        const code = getApiErrorCode(error);
        if (code === 'LOCATION_REQUIRED' || code === 'TRACKING_COMPLETE') {
          return null;
        }
        throw error;
      }
    },
    enabled: enabled && Boolean(id),
    staleTime: LIVE_INTERVALS.deliveryTracking / 2,
    gcTime: 5 * 60_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliveryTracking,
      isActive
    ),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: keepRetrying,
    placeholderData: (previous) => previous,
  });
}

export function useDeliveryHistory(
  limit = 20,
  enabled = true,
  status?: string
) {
  const isActive = useAppIsActive();

  return useInfiniteQuery({
    queryKey: deliveryPartnerKeys.history(limit, status),
    enabled,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      deliveryPartnerApi.getDeliveries({
        page: pageParam,
        limit,
        status: status || undefined,
      }),
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
      queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.actives() }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'deliveries'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'delivery'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'timeline'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'events'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'batch'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'chat'],
      }),
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'trip-route'],
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
      queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'finance'],
      }),
    ]);
  };

  const applyDeliveryResult = (delivery: PartnerDelivery) => {
    const status = normalizeDeliveryStatus(delivery.status);
    if (
      status === 'delivered' ||
      status === 'rejected' ||
      status === 'cancelled' ||
      status === 'returned' ||
      status === 'failed' ||
      status === 'reassigned'
    ) {
      queryClient.setQueryData(deliveryPartnerKeys.active(), null);
      if (status === 'returned') {
        announceOrderReturned(delivery.id, delivery.rtoFee);
      }
    } else if (delivery.id) {
      queryClient.setQueryData(deliveryPartnerKeys.active(), delivery);
      queryClient.setQueryData(
        deliveryPartnerKeys.delivery(delivery.id),
        delivery
      );
    }
  };

  const setOnline = useMutation({
    mutationFn: (isOnline: boolean) => deliveryPartnerApi.setOnline(isOnline),
    onMutate: async (isOnline) => {
      const statusKey = [...deliveryPartnerKeys.all, 'availability', 'status'] as const;
      await queryClient.cancelQueries({ queryKey: deliveryPartnerKeys.me() });
      await queryClient.cancelQueries({ queryKey: statusKey });
      const previous = queryClient.getQueryData<DeliveryPartnerProfile | null>(
        deliveryPartnerKeys.me()
      );
      const previousStatus = queryClient.getQueryData(statusKey);
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
      queryClient.setQueryData(statusKey, (prev) => {
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
      return { previous, previousStatus };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous !== undefined) {
        queryClient.setQueryData(deliveryPartnerKeys.me(), ctx.previous);
      }
      if (ctx?.previousStatus !== undefined) {
        queryClient.setQueryData(
          [...deliveryPartnerKeys.all, 'availability', 'status'],
          ctx.previousStatus
        );
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
          queryKey: [...deliveryPartnerKeys.all, 'availability'],
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

  const acceptBatch = useMutation({
    mutationFn: (batchId: string) => deliveryPartnerApi.acceptBatch(batchId),
    onSuccess: async () => {
      await invalidateAll();
    },
  });

  const confirmSequence = useMutation({
    mutationFn: ({
      batchId,
      payload,
    }: {
      batchId: string;
      payload?: ConfirmBatchSequencePayload;
    }) =>
      deliveryPartnerApi.confirmBatchSequence(
        batchId,
        payload ?? { confirm: true }
      ),
    onSuccess: async (batch) => {
      queryClient.setQueryData(deliveryPartnerKeys.batch(batch.batchId), batch);
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
      const currentStatus = previous
        ? normalizeDeliveryStatus(previous.status)
        : '';
      if (currentStatus !== 'returning_to_restaurant') {
        patchActiveCache(queryClient, (cur) =>
          cur ? { ...cur, status: 'arrived' } : cur ?? null
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

  const pickup = useMutation({
    mutationFn: ({
      deliveryId,
      otp,
      photoUrl,
    }: {
      deliveryId: string;
      otp?: string;
      photoUrl?: string;
    }) => deliveryPartnerApi.markPickedUp(deliveryId, { otp, photoUrl }),
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

  const orderNotReady = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.markOrderNotReady(deliveryId),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const waiting = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.markWaiting(deliveryId),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const orderReady = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.markOrderReady(deliveryId),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const pickupVerify = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload: PickupVerifyPayload;
    }) => deliveryPartnerApi.verifyPickup(deliveryId, payload),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const onTheWay = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.markOnTheWay(deliveryId),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const verifyOtp = useMutation({
    mutationFn: ({ deliveryId, otp }: { deliveryId: string; otp: string }) =>
      deliveryPartnerApi.verifyDropOtp(deliveryId, otp),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const cancelTrip = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload: CancelDeliveryPayload;
    }) => deliveryPartnerApi.cancelDelivery(deliveryId, payload),
    onSuccess: async () => {
      queryClient.setQueryData(deliveryPartnerKeys.active(), null);
      await invalidateAll();
    },
  });

  const reportIssue = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload: ReportIssuePayload;
    }) => deliveryPartnerApi.reportIssue(deliveryId, payload),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const captureSignature = useMutation({
    mutationFn: ({
      deliveryId,
      uri,
      signatureUrl,
    }: {
      deliveryId: string;
      uri?: string;
      signatureUrl?: string;
    }) => deliveryPartnerApi.captureSignature(deliveryId, { uri, signatureUrl }),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const uploadPod = useMutation({
    mutationFn: ({
      deliveryId,
      photoUri,
      signatureUri,
    }: {
      deliveryId: string;
      photoUri?: string;
      signatureUri?: string;
    }) =>
      deliveryPartnerApi.uploadProofOfDelivery(deliveryId, {
        photoUri,
        signatureUri,
      }),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const customerUnreachable = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload?: CustomerUnreachablePayload;
    }) =>
      deliveryPartnerApi.markCustomerUnreachable(deliveryId, payload ?? {}),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const returnToRestaurant = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload: ReturnToRestaurantPayload;
    }) => deliveryPartnerApi.returnToRestaurant(deliveryId, payload),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const completeReturn = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload: CompleteReturnPayload;
    }) => deliveryPartnerApi.completeReturn(deliveryId, payload),
    onSuccess: async (delivery) => {
      applyDeliveryResult(delivery);
      await invalidateAll();
    },
  });

  const failTrip = useMutation({
    mutationFn: ({
      deliveryId,
      payload,
    }: {
      deliveryId: string;
      payload: FailDeliveryPayload;
    }) => deliveryPartnerApi.markFailed(deliveryId, payload),
    onSuccess: async () => {
      queryClient.setQueryData(deliveryPartnerKeys.active(), null);
      await invalidateAll();
    },
  });

  const callCustomer = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.callCustomer(deliveryId),
  });

  const callRestaurant = useMutation({
    mutationFn: (deliveryId: string) =>
      deliveryPartnerApi.callRestaurant(deliveryId),
  });

  return {
    setOnline,
    accept,
    acceptBatch,
    confirmSequence,
    reject,
    arrived,
    pickup,
    reachedCustomer,
    deliver,
    orderNotReady,
    waiting,
    orderReady,
    pickupVerify,
    onTheWay,
    verifyOtp,
    cancelTrip,
    reportIssue,
    captureSignature,
    uploadPod,
    customerUnreachable,
    returnToRestaurant,
    completeReturn,
    failTrip,
    callCustomer,
    callRestaurant,
    invalidateAll,
  };
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
