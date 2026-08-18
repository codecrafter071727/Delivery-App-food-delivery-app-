import { useEffect, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { dashboardKeys } from '@/lib/dashboard/hooks';
import type { OwnerOrder } from '@/lib/dashboard/types';
import {
  LIVE_INTERVALS,
  isGloballyBackingOff,
  isRateLimitedError,
  liveRefetchInterval,
  noteRateLimited,
  useAppIsActive,
} from '@/lib/live-query';
import {
  isOrderApiBackingOff,
  resetOrderApiDiscovery,
  restaurantOrderApi,
  type KitchenHandover,
  type KitchenHandoverMethod,
  type KitchenKdsBoard,
  type RestaurantOrderAction,
} from '@/lib/order/owner-api';
import { restaurantOwnerApi } from '@/lib/restaurant/api';
import type { RestaurantOwnerRestaurant } from '@/lib/restaurant/types';

/**
 * Kitchen-board cadence: Socket.IO `join:restaurant` plus REST poll
 * fallback while foregrounded. Rate-limit safe because owner-api locks
 * onto ONE working endpoint after first success + global backoff.
 */
const LIVE_POLL_MS = LIVE_INTERVALS.orders;
const URGENT_POLL_MS = LIVE_INTERVALS.ordersUrgent;
const BACKOFF_POLL_MS = LIVE_INTERVALS.ordersBackoff;
const ORDERS_STALE_MS = 8_000;
const URGENT_STATUSES = new Set(['pending', 'placed', 'pending_payment']);
const ACTIVE_STATUSES = new Set([
  'pending',
  'placed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
]);

export const restaurantOrderKeys = {
  all: ['restaurant-orders'] as const,
  restaurant: (restaurantId: string) =>
    [...restaurantOrderKeys.all, restaurantId] as const,
  list: (restaurantId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'list'] as const,
  kds: (restaurantId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'kds'] as const,
  scheduled: (restaurantId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'scheduled'] as const,
  history: (restaurantId: string, from: string, to: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'history', from, to] as const,
  rejectReasons: (restaurantId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'reject-reasons'] as const,
  detail: (restaurantId: string, orderId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'detail', orderId] as const,
  sla: (restaurantId: string, orderId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'sla', orderId] as const,
  handover: (restaurantId: string, orderId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'handover', orderId] as const,
  rider: (restaurantId: string, orderId: string) =>
    [...restaurantOrderKeys.restaurant(restaurantId), 'rider', orderId] as const,
};

/** Patch dashboard pending/active counts from the live orders board (no extra API). */
export function syncDashboardFromOrders(
  queryClient: ReturnType<typeof useQueryClient>,
  orders: OwnerOrderLike[]
) {
  const pending = orders.filter((order) =>
    URGENT_STATUSES.has(String(order.status ?? ''))
  );
  const activeCount = orders.filter((order) =>
    ACTIVE_STATUSES.has(String(order.status ?? ''))
  ).length;

  queryClient.setQueryData(dashboardKeys.stats(), (current: unknown) => {
    if (!current || typeof current !== 'object') return current;
    const dashboard = current as {
      pendingOrders?: OwnerOrderLike[];
      quickActions?: { activeOrders?: number; [key: string]: unknown };
      [key: string]: unknown;
    };
    return {
      ...dashboard,
      pendingOrders: pending.slice(0, 12),
      quickActions: {
        ...(dashboard.quickActions ?? {}),
        activeOrders: activeCount,
      },
    };
  });
}

type OwnerOrderLike = {
  id?: string;
  status?: string;
  [key: string]: unknown;
};

export function useMyRestaurantId(options?: { enabled?: boolean }) {
  const queryClient = useQueryClient();
  const enabled = options?.enabled ?? true;

  return useQuery({
    queryKey: ['owner-restaurant', 'my'] as const,
    queryFn: async () => {
      const restaurants = await restaurantOwnerApi.getMyRestaurants();
      if (!restaurants.length) return null;

      const preferredId = await restaurantOwnerApi.getSelectedRestaurantId();
      const selected =
        restaurants.find((row) => row.id === preferredId) ?? restaurants[0];

      // Do NOT probe every outlet's orders here — that caused rate limits.
      // Prefer saved selection, otherwise first/most recent from API mapping.
      await restaurantOwnerApi.setSelectedRestaurantId(selected.id);
      return selected;
    },
    enabled,
    // Short stale window so admin "approve → active" shows up quickly.
    staleTime: 30_000,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    // placeholderData does not mark the query fresh (unlike initialData),
    // so we still refetch real listing status from /restaurants/my.
    placeholderData: (): RestaurantOwnerRestaurant | undefined => {
      const dashboard = queryClient.getQueryData<{
        restaurantId?: string;
        restaurantName?: string;
        logoUrl?: string;
      }>(dashboardKeys.stats());
      if (!dashboard?.restaurantId) return undefined;
      return {
        id: dashboard.restaurantId,
        name: dashboard.restaurantName ?? '',
        logoUrl: dashboard.logoUrl,
      };
    },
  });
}

export function useRestaurantOrders(
  restaurantId?: string,
  options?: { enabled?: boolean }
) {
  const isActive = useAppIsActive();
  const queryClient = useQueryClient();
  const [backingOff, setBackingOff] = useState(false);
  const enabled = (options?.enabled ?? true) && Boolean(restaurantId);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setBackingOff(isOrderApiBackingOff() || isGloballyBackingOff());
    }, 2_000);
    return () => clearInterval(timer);
  }, [isActive]);

  const query = useQuery({
    queryKey: restaurantOrderKeys.list(restaurantId ?? ''),
    queryFn: async () => {
      try {
        return await restaurantOrderApi.getRestaurantOrders(restaurantId!, {
          bypassCache: true,
        });
      } catch (error) {
        if (isRateLimitedError(error)) noteRateLimited(error);
        throw error;
      }
    },
    enabled,
    staleTime: ORDERS_STALE_MS,
    // Live board while open; faster when new orders are waiting.
    refetchInterval: (query) => {
      if (!isActive) return false;
      if (backingOff || isGloballyBackingOff()) return BACKOFF_POLL_MS;
      const rows = query.state.data ?? [];
      const urgent = rows.some((order) =>
        URGENT_STATUSES.has(String(order.status ?? ''))
      );
      return urgent ? URGENT_POLL_MS : LIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    // Keep last board visible during transient rate-limit / network blips.
    placeholderData: (previous) => previous,
  });

  // Keep dashboard pending/active in sync without re-fetching the heavy dashboard.
  useEffect(() => {
    if (!query.data) return;
    syncDashboardFromOrders(queryClient, query.data);
  }, [query.data, queryClient]);

  return query;
}

/** Hard refresh: rediscover endpoints then reload (for pull-to-refresh / refresh button). */
export async function hardRefreshRestaurantOrders(restaurantId: string) {
  resetOrderApiDiscovery();
  return restaurantOrderApi.getRestaurantOrders(restaurantId, {
    bypassCache: true,
  });
}

function kdsHasUrgent(board?: KitchenKdsBoard) {
  return Boolean(board?.new.length || board?.delayed.length);
}

function patchKdsStatus(
  board: KitchenKdsBoard | undefined,
  orderId: string,
  nextStatus: string
): KitchenKdsBoard | undefined {
  if (!board) return board;
  const all = [...board.new, ...board.preparing, ...board.ready, ...board.delayed];
  const found = all.find((row) => row.id === orderId);
  if (!found) return board;
  const drop = (rows: typeof all) => rows.filter((row) => row.id !== orderId);
  const next: KitchenKdsBoard = {
    new: drop(board.new),
    preparing: drop(board.preparing),
    ready: drop(board.ready),
    delayed: drop(board.delayed),
  };
  const updated = { ...found, status: nextStatus };
  if (nextStatus === 'cancelled' || nextStatus === 'rejected') return next;
  if (nextStatus === 'ready') next.ready.unshift(updated);
  else if (nextStatus === 'preparing' || nextStatus === 'accepted') {
    next.preparing.unshift(updated);
  } else if (nextStatus !== 'out_for_delivery') {
    next.new.unshift(updated);
  }
  return next;
}

export function useKitchenKds(
  restaurantId?: string,
  options?: { enabled?: boolean }
) {
  const isActive = useAppIsActive();
  const queryClient = useQueryClient();
  const [backingOff, setBackingOff] = useState(false);
  const enabled = (options?.enabled ?? true) && Boolean(restaurantId);

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => {
      setBackingOff(isOrderApiBackingOff() || isGloballyBackingOff());
    }, 2_000);
    return () => clearInterval(timer);
  }, [isActive]);

  const query = useQuery({
    queryKey: restaurantOrderKeys.kds(restaurantId ?? ''),
    queryFn: async () => {
      try {
        return await restaurantOrderApi.getKds(restaurantId!);
      } catch (error) {
        if (isRateLimitedError(error)) noteRateLimited(error);
        throw error;
      }
    },
    enabled,
    staleTime: ORDERS_STALE_MS,
    refetchInterval: (query) => {
      if (!isActive) return false;
      if (backingOff || isGloballyBackingOff()) return BACKOFF_POLL_MS;
      return kdsHasUrgent(query.state.data) ? URGENT_POLL_MS : LIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: false,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!query.data) return;
    const seen = new Set<string>();
    const flat = [
      ...query.data.new,
      ...query.data.preparing,
      ...query.data.ready,
      ...query.data.delayed,
    ].filter((order) => {
      if (!order.id || seen.has(order.id)) return false;
      seen.add(order.id);
      return true;
    });
    syncDashboardFromOrders(queryClient, flat);
  }, [query.data, queryClient]);

  return query;
}

export function useScheduledOrders(
  restaurantId?: string,
  options?: { enabled?: boolean }
) {
  const isActive = useAppIsActive();
  const enabled = (options?.enabled ?? true) && Boolean(restaurantId);

  return useQuery({
    queryKey: restaurantOrderKeys.scheduled(restaurantId ?? ''),
    queryFn: async () => {
      try {
        return await restaurantOrderApi.getScheduled(restaurantId!);
      } catch (error) {
        if (isRateLimitedError(error)) noteRateLimited(error);
        throw error;
      }
    },
    enabled,
    staleTime: 20_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.orders, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

export function useOrderHistory(
  restaurantId: string | undefined,
  range: { from: string; to: string },
  options?: { enabled?: boolean }
) {
  const enabled = (options?.enabled ?? true) && Boolean(restaurantId);

  return useInfiniteQuery({
    queryKey: restaurantOrderKeys.history(
      restaurantId ?? '',
      range.from,
      range.to
    ),
    queryFn: async ({ pageParam }) => {
      try {
        return await restaurantOrderApi.getHistory(restaurantId!, {
          from: range.from,
          to: range.to,
          page: pageParam,
          limit: 20,
        });
      } catch (error) {
        if (isRateLimitedError(error)) noteRateLimited(error);
        throw error;
      }
    },
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

export function useRejectReasons(
  restaurantId?: string,
  options?: { enabled?: boolean }
) {
  const enabled = (options?.enabled ?? true) && Boolean(restaurantId);

  return useQuery({
    queryKey: restaurantOrderKeys.rejectReasons(restaurantId ?? ''),
    queryFn: () => restaurantOrderApi.getRejectReasons(restaurantId!),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

export function useRestaurantOrder(
  restaurantId?: string,
  orderId?: string,
  enabled = true
) {
  const queryClient = useQueryClient();
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: restaurantOrderKeys.detail(
      restaurantId ?? '',
      orderId ?? ''
    ),
    queryFn: () => restaurantOrderApi.getOrder(restaurantId!, orderId!),
    enabled: enabled && Boolean(restaurantId && orderId),
    staleTime: ORDERS_STALE_MS,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.orders, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
    placeholderData: (previous): OwnerOrder | undefined => {
      if (previous) return previous;
      if (!restaurantId || !orderId) return previous;
      const list = queryClient.getQueryData<OwnerOrder[]>(
        restaurantOrderKeys.list(restaurantId)
      );
      const fromList = list?.find((row) => row.id === orderId);
      if (fromList) return fromList;
      const kds = queryClient.getQueryData<KitchenKdsBoard>(
        restaurantOrderKeys.kds(restaurantId)
      );
      return (
        kds
          ? [...kds.new, ...kds.preparing, ...kds.ready, ...kds.delayed].find(
              (row) => row.id === orderId
            )
          : undefined
      ) ?? previous;
    },
  });
}

export function useUpdateRestaurantOrderStatus(restaurantId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      orderId,
      action,
      prepTime,
      reasonCode,
      note,
    }: {
      orderId: string;
      action: RestaurantOrderAction;
      prepTime?: number;
      reasonCode?: string;
      note?: string;
    }) => {
      if (!restaurantId) throw new Error('Restaurant profile is not available');
      return restaurantOrderApi.updateOrderStatus(
        restaurantId,
        orderId,
        action,
        { prepTime, reasonCode, note }
      );
    },
    onMutate: async ({ orderId, action, prepTime }) => {
      if (!restaurantId) return;
      await queryClient.cancelQueries({
        queryKey: restaurantOrderKeys.restaurant(restaurantId),
      });

      const listKey = restaurantOrderKeys.list(restaurantId);
      const kdsKey = restaurantOrderKeys.kds(restaurantId);
      const detailKey = restaurantOrderKeys.detail(restaurantId, orderId);
      const previousList = queryClient.getQueryData(listKey);
      const previousKds = queryClient.getQueryData(kdsKey);
      const previousDetail = queryClient.getQueryData(detailKey);

      const nextStatus =
        action === 'out-for-delivery'
          ? 'out_for_delivery'
          : action === 'accept'
            ? 'accepted'
            : action === 'reject'
              ? 'cancelled'
              : action;

      const patch = (order: { id?: string; status?: string; prepMinutes?: number }) =>
        order.id === orderId
          ? {
              ...order,
              status: nextStatus,
              ...(action === 'accept' && prepTime ? { prepMinutes: prepTime } : {}),
            }
          : order;

      queryClient.setQueryData(listKey, (current: unknown) => {
        if (!Array.isArray(current)) return current;
        return current.map(patch);
      });

      queryClient.setQueryData(detailKey, (current: unknown) => {
        if (!current || typeof current !== 'object') return current;
        return patch(current as { id?: string; status?: string; prepMinutes?: number });
      });

      queryClient.setQueryData(kdsKey, (current: unknown) =>
        patchKdsStatus(current as KitchenKdsBoard | undefined, orderId, nextStatus)
      );

      const nextList = queryClient.getQueryData(listKey);
      if (Array.isArray(nextList)) {
        syncDashboardFromOrders(queryClient, nextList);
      }

      return { previousList, listKey, previousKds, kdsKey, previousDetail, detailKey };
    },
    onError: (_error, _vars, context) => {
      if (context?.previousList && context.listKey) {
        queryClient.setQueryData(context.listKey, context.previousList);
        if (Array.isArray(context.previousList)) {
          syncDashboardFromOrders(queryClient, context.previousList);
        }
      }
      if (context?.kdsKey && context.previousKds !== undefined) {
        queryClient.setQueryData(context.kdsKey, context.previousKds);
      }
      if (context?.detailKey && context.previousDetail !== undefined) {
        queryClient.setQueryData(context.detailKey, context.previousDetail);
      }
    },
    onSuccess: (order) => {
      if (!restaurantId) return;
      queryClient.setQueryData(
        restaurantOrderKeys.detail(restaurantId, order.id),
        order
      );
      // Merge mutation result into the live board immediately.
      queryClient.setQueryData(
        restaurantOrderKeys.list(restaurantId),
        (current: unknown) => {
          if (!Array.isArray(current)) return current;
          return current.map((row: { id?: string }) =>
            row.id === order.id ? { ...row, ...order } : row
          );
        }
      );
      const list = queryClient.getQueryData(restaurantOrderKeys.list(restaurantId));
      if (Array.isArray(list)) {
        syncDashboardFromOrders(queryClient, list);
      }
      // Soft mark only — avoid slamming the heavy dashboard aggregate APIs.
      void queryClient.invalidateQueries({
        queryKey: dashboardKeys.all,
        refetchType: 'none',
      });
      void queryClient.invalidateQueries({
        queryKey: restaurantOrderKeys.restaurant(restaurantId),
        refetchType: 'active',
      });
      void queryClient.invalidateQueries({
        // Matches partnerKeys.orderPartner(order.id) without importing partner hooks
        // (avoids order ↔ partner circular dependency).
        queryKey: ['delivery-partners', 'order', order.id, 'partner'],
      });
    },
  });
}

const SLA_LIVE_STATUSES = new Set([
  'pending',
  'placed',
  'accepted',
  'preparing',
]);

function applyKitchenOrder(
  queryClient: ReturnType<typeof useQueryClient>,
  restaurantId: string,
  order: OwnerOrder
) {
  queryClient.setQueryData(
    restaurantOrderKeys.detail(restaurantId, order.id),
    (current: unknown) =>
      current && typeof current === 'object'
        ? { ...(current as object), ...order }
        : order
  );
  queryClient.setQueryData(
    restaurantOrderKeys.list(restaurantId),
    (current: unknown) => {
      if (!Array.isArray(current)) return current;
      return current.map((row: { id?: string }) =>
        row.id === order.id ? { ...row, ...order } : row
      );
    }
  );
  const list = queryClient.getQueryData(restaurantOrderKeys.list(restaurantId));
  if (Array.isArray(list)) syncDashboardFromOrders(queryClient, list);
  void queryClient.invalidateQueries({
    queryKey: restaurantOrderKeys.restaurant(restaurantId),
    refetchType: 'active',
  });
  void queryClient.invalidateQueries({
    queryKey: restaurantOrderKeys.sla(restaurantId, order.id),
  });
  void queryClient.invalidateQueries({
    queryKey: restaurantOrderKeys.handover(restaurantId, order.id),
  });
  void queryClient.invalidateQueries({
    queryKey: restaurantOrderKeys.rider(restaurantId, order.id),
  });
}

export function useOrderSla(
  restaurantId?: string,
  orderId?: string,
  status?: string
) {
  const isActive = useAppIsActive();
  const live = !status || SLA_LIVE_STATUSES.has(status);

  return useQuery({
    queryKey: restaurantOrderKeys.sla(restaurantId ?? '', orderId ?? ''),
    queryFn: async () => {
      try {
        return await restaurantOrderApi.getSla(restaurantId!, orderId!);
      } catch (error) {
        if (isRateLimitedError(error)) noteRateLimited(error);
        throw error;
      }
    },
    enabled: Boolean(restaurantId && orderId && live),
    staleTime: 4_000,
    refetchInterval: isActive && live ? 5_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

const HANDOVER_LIVE_STATUSES = new Set(['ready', 'out_for_delivery']);

export function useOrderHandover(
  restaurantId?: string,
  orderId?: string,
  order?: Pick<OwnerOrder, 'fulfillmentTone' | 'status'>
) {
  const isActive = useAppIsActive();
  const live =
    order?.fulfillmentTone === 'delivery' &&
    Boolean(order.status && HANDOVER_LIVE_STATUSES.has(order.status));

  return useQuery({
    queryKey: restaurantOrderKeys.handover(restaurantId ?? '', orderId ?? ''),
    queryFn: async () => {
      try {
        return await restaurantOrderApi.getHandover(restaurantId!, orderId!);
      } catch (error) {
        if (isRateLimitedError(error)) noteRateLimited(error);
        throw error;
      }
    },
    enabled: Boolean(restaurantId && orderId && live),
    staleTime: 3_000,
    refetchInterval: (query) => {
      const data = query.state.data as KitchenHandover | undefined;
      if (!isActive || !live || data?.confirmed) return false;
      return 5_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

const RIDER_LIVE_STATUSES = new Set([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
]);

export function useOrderRider(
  restaurantId?: string,
  orderId?: string,
  order?: Pick<OwnerOrder, 'fulfillmentTone' | 'status'>
) {
  const isActive = useAppIsActive();
  const live =
    order?.fulfillmentTone === 'delivery' &&
    Boolean(order.status && RIDER_LIVE_STATUSES.has(order.status));

  return useQuery({
    queryKey: restaurantOrderKeys.rider(restaurantId ?? '', orderId ?? ''),
    queryFn: async () => {
      try {
        return await restaurantOrderApi.getRider(restaurantId!, orderId!);
      } catch (error) {
        if (isRateLimitedError(error)) noteRateLimited(error);
        throw error;
      }
    },
    enabled: Boolean(restaurantId && orderId && live),
    staleTime: 5_000,
    refetchInterval: (query) => {
      const data = query.state.data as { assigned?: boolean } | undefined;
      if (!isActive || !live) return false;
      return data?.assigned ? 12_000 : 6_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    placeholderData: (previous) => previous,
  });
}

export function useKitchenTicketMutations(restaurantId?: string) {
  const queryClient = useQueryClient();
  const requireId = () => {
    if (!restaurantId) throw new Error('Restaurant profile is not available');
    return restaurantId;
  };
  const apply = (order: OwnerOrder) => {
    if (!restaurantId) return;
    applyKitchenOrder(queryClient, restaurantId, order);
  };

  const prepTime = useMutation({
    mutationFn: (input: { orderId: string; prepMinutes: number }) =>
      restaurantOrderApi.updatePrepTime(
        requireId(),
        input.orderId,
        input.prepMinutes
      ),
    onSuccess: apply,
  });

  const delay = useMutation({
    mutationFn: (input: {
      orderId: string;
      extraMinutes: number;
      reason: string;
    }) =>
      restaurantOrderApi.delayOrder(requireId(), input.orderId, {
        extraMinutes: input.extraMinutes,
        reason: input.reason,
      }),
    onSuccess: apply,
  });

  const cancel = useMutation({
    mutationFn: (input: {
      orderId: string;
      reasonCode: string;
      note?: string;
    }) =>
      restaurantOrderApi.cancelOrder(requireId(), input.orderId, {
        reasonCode: input.reasonCode,
        note: input.note,
      }),
    onSuccess: (result) => apply(result.order),
  });

  const itemsUnavailable = useMutation({
    mutationFn: (input: {
      orderId: string;
      itemIds: string[];
      note?: string;
    }) =>
      restaurantOrderApi.markItemsUnavailable(requireId(), input.orderId, {
        itemIds: input.itemIds,
        note: input.note,
      }),
    onSuccess: (result) => apply(result.order),
  });

  const printKot = useMutation({
    mutationFn: (orderId: string) =>
      restaurantOrderApi.printKot(requireId(), orderId),
  });

  const pickupReady = useMutation({
    mutationFn: (orderId: string) =>
      restaurantOrderApi.pickupReady(requireId(), orderId),
    onSuccess: apply,
  });

  const completeTakeaway = useMutation({
    mutationFn: (orderId: string) =>
      restaurantOrderApi.completeTakeaway(requireId(), orderId),
    onSuccess: apply,
  });

  const confirmHandover = useMutation({
    mutationFn: (input: {
      orderId: string;
      method: KitchenHandoverMethod;
      otp?: string;
    }) =>
      restaurantOrderApi.confirmHandover(requireId(), input.orderId, {
        method: input.method,
        otp: input.otp,
      }),
    onSuccess: (handover, input) => {
      if (!restaurantId) return;
      queryClient.setQueryData(
        restaurantOrderKeys.handover(restaurantId, input.orderId),
        handover
      );
      void queryClient.invalidateQueries({
        queryKey: restaurantOrderKeys.detail(restaurantId, input.orderId),
      });
      void queryClient.invalidateQueries({
        queryKey: restaurantOrderKeys.restaurant(restaurantId),
        refetchType: 'active',
      });
    },
  });

  const handToRider = useMutation({
    mutationFn: (orderId: string) =>
      restaurantOrderApi.tryKitchenHandover(requireId(), orderId),
    onSuccess: (result, orderId) => {
      if (!restaurantId) return;
      queryClient.setQueryData(
        restaurantOrderKeys.handover(restaurantId, orderId),
        result.handover
      );
      void queryClient.invalidateQueries({
        queryKey: restaurantOrderKeys.detail(restaurantId, orderId),
      });
      void queryClient.invalidateQueries({
        queryKey: restaurantOrderKeys.restaurant(restaurantId),
        refetchType: 'active',
      });
    },
  });

  const callCustomer = useMutation({
    mutationFn: (orderId: string) =>
      restaurantOrderApi.callCustomer(requireId(), orderId),
  });

  const ratePartner = useMutation({
    mutationFn: (input: {
      orderId: string;
      stars: number;
      comment?: string;
      partnerId?: string;
    }) =>
      restaurantOrderApi.ratePartner(requireId(), input.orderId, {
        stars: input.stars,
        comment: input.comment,
        partnerId: input.partnerId,
      }),
  });

  const manualAssign = useMutation({
    mutationFn: (input: { orderId: string; partnerId: string }) =>
      restaurantOrderApi.manualAssign(
        requireId(),
        input.orderId,
        input.partnerId
      ),
    onSuccess: (rider, input) => {
      if (!restaurantId) return;
      queryClient.setQueryData(
        restaurantOrderKeys.rider(restaurantId, input.orderId),
        rider
      );
      queryClient.setQueryData(
        ['delivery-partners', 'order', input.orderId, 'partner'],
        rider
      );
    },
  });

  return {
    prepTime,
    delay,
    cancel,
    itemsUnavailable,
    printKot,
    pickupReady,
    completeTakeaway,
    confirmHandover,
    handToRider,
    callCustomer,
    ratePartner,
    manualAssign,
    isPending:
      prepTime.isPending ||
      delay.isPending ||
      cancel.isPending ||
      itemsUnavailable.isPending ||
      printKot.isPending ||
      pickupReady.isPending ||
      completeTakeaway.isPending ||
      confirmHandover.isPending ||
      handToRider.isPending,
  };
}

export { isRateLimitedError };
