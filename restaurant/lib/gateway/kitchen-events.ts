import type { QueryClient } from '@tanstack/react-query';

import type { OwnerOrder } from '@/lib/dashboard/types';
import { notificationKeys } from '@/lib/notification/hooks';
import { restaurantOrderKeys, syncDashboardFromOrders } from '@/lib/order/hooks';

export type KitchenInboundEvent =
  | 'kitchen:order-new'
  | 'kitchen:order-status'
  | 'kitchen:order-cancelled'
  | 'kitchen:rider-assigned'
  | 'kitchen:rider-arrived'
  | 'kitchen:scheduled-due'
  | 'order:status'
  | 'order:items-removed'
  | 'delivery:status'
  | 'payment:cod-paid'
  | 'notification:new'
  | 'chat:new-message'
  | 'typing';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function fulfillmentFromDeliveryType(value?: string): OwnerOrder['fulfillmentTone'] {
  const raw = (value ?? '').toLowerCase();
  if (raw.includes('pickup') || raw.includes('takeaway')) return 'pickup';
  if (raw.includes('dine') || raw.includes('table')) return 'table';
  return 'delivery';
}

function fulfillmentLabel(tone: OwnerOrder['fulfillmentTone']): string {
  if (tone === 'pickup') return 'Pickup';
  if (tone === 'table') return 'Dine-in';
  return 'Delivery';
}

function mapIncomingOrder(
  record: Record<string, unknown>,
  fallbackStatus?: string
): Partial<OwnerOrder> & { id?: string } {
  const id = pickString(record, ['orderId', 'id', '_id']);
  const status =
    pickString(record, ['status', 'orderStatus']) ?? fallbackStatus;
  const deliveryType = pickString(record, ['deliveryType', 'fulfillment']);
  const totalRaw = record.grandTotal ?? record.total;
  const total = typeof totalRaw === 'number' ? totalRaw : Number(totalRaw);
  const patch: Partial<OwnerOrder> & { id?: string } = {
    ...(id ? { id } : {}),
    ...(pickString(record, ['orderNumber'])
      ? { orderNumber: pickString(record, ['orderNumber']) }
      : {}),
    ...(status ? { status } : {}),
    ...(pickString(record, ['paymentMethod'])
      ? { paymentMethod: pickString(record, ['paymentMethod']) }
      : {}),
    ...(Number.isFinite(total) ? { total } : {}),
  };
  if (deliveryType) {
    const tone = fulfillmentFromDeliveryType(deliveryType);
    patch.fulfillmentTone = tone;
    patch.fulfillmentLabel = fulfillmentLabel(tone);
  }
  return patch;
}

function patchList(
  queryClient: QueryClient,
  restaurantId: string,
  orderId: string,
  patch: Partial<OwnerOrder>
) {
  const listKey = restaurantOrderKeys.list(restaurantId);
  queryClient.setQueryData(listKey, (current: unknown) => {
    if (!Array.isArray(current)) {
      if (patch.id && patch.status) return [patch as OwnerOrder];
      return current;
    }
    const rows = current as OwnerOrder[];
    const index = rows.findIndex((row) => row.id === orderId);
    if (index < 0) {
      if (!patch.status) return rows;
      const next: OwnerOrder = {
        id: orderId,
        orderNumber: patch.orderNumber ?? orderId.slice(-6).toUpperCase(),
        status: patch.status,
        items: [],
        fulfillmentLabel: patch.fulfillmentLabel ?? 'Delivery',
        fulfillmentTone: patch.fulfillmentTone ?? 'delivery',
        ...patch,
      };
      return [next, ...rows];
    }
    const merged = { ...rows[index], ...patch, id: orderId };
    const copy = [...rows];
    copy[index] = merged;
    return copy;
  });

  const list = queryClient.getQueryData(listKey);
  if (Array.isArray(list)) {
    syncDashboardFromOrders(queryClient, list);
  }

  queryClient.setQueryData(
    restaurantOrderKeys.detail(restaurantId, orderId),
    (current: unknown) => {
      if (!current || typeof current !== 'object') return current;
      return { ...(current as OwnerOrder), ...patch, id: orderId };
    }
  );
}

/** Apply a kitchen socket payload to the live board + ticket cache. */
export function applyKitchenSocketEvent(
  queryClient: QueryClient,
  restaurantId: string,
  event: KitchenInboundEvent,
  payload: unknown
) {
  if (event === 'notification:new') {
    void queryClient.invalidateQueries({
      queryKey: notificationKeys.all,
      refetchType: 'active',
    });
    return;
  }

  if (event === 'chat:new-message' || event === 'typing') return;

  const record = asRecord(payload);
  const orderId = pickString(record, ['orderId', 'id', '_id']);

  if (
    event === 'kitchen:order-new' ||
    event === 'kitchen:scheduled-due' ||
    event === 'kitchen:order-status' ||
    event === 'order:status' ||
    event === 'kitchen:order-cancelled'
  ) {
    if (!orderId) return;
    const fallback =
      event === 'kitchen:order-cancelled'
        ? 'cancelled'
        : event === 'kitchen:order-new' || event === 'kitchen:scheduled-due'
          ? 'placed'
          : undefined;
    const mapped = mapIncomingOrder(record, fallback);
    if (event === 'kitchen:order-cancelled') {
      mapped.status = pickString(record, ['status']) ?? 'cancelled';
      mapped.rejectionReason =
        pickString(record, ['reason', 'cancellationReason']) ??
        mapped.rejectionReason;
    }
    patchList(queryClient, restaurantId, orderId, mapped);
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.restaurant(restaurantId),
      refetchType: 'active',
    });
    return;
  }

  if (event === 'delivery:status') {
    if (!orderId) return;
    void queryClient.invalidateQueries({
      queryKey: ['delivery-partners', 'order', orderId, 'partner'],
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.detail(restaurantId, orderId),
      refetchType: 'active',
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.handover(restaurantId, orderId),
      refetchType: 'active',
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.rider(restaurantId, orderId),
      refetchType: 'active',
    });
    return;
  }

  if (event === 'kitchen:rider-assigned' || event === 'kitchen:rider-arrived') {
    if (!orderId) return;
    const status = pickString(record, ['status']);
    patchList(queryClient, restaurantId, orderId, {
      ...(status && !status.includes('_') ? { status } : {}),
    });
    void queryClient.invalidateQueries({
      queryKey: ['delivery-partners', 'order', orderId, 'partner'],
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.detail(restaurantId, orderId),
      refetchType: 'active',
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.handover(restaurantId, orderId),
      refetchType: 'active',
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.rider(restaurantId, orderId),
      refetchType: 'active',
    });
    return;
  }

  if (event === 'order:items-removed') {
    if (!orderId) return;
    const totalRaw = record.newTotal ?? record.grandTotal ?? record.total;
    const total = typeof totalRaw === 'number' ? totalRaw : Number(totalRaw);
    patchList(queryClient, restaurantId, orderId, {
      ...(Number.isFinite(total) ? { total } : {}),
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.detail(restaurantId, orderId),
      refetchType: 'active',
    });
    return;
  }

  if (event === 'payment:cod-paid') {
    if (!orderId) return;
    patchList(queryClient, restaurantId, orderId, {
      paymentStatus: 'paid',
      paymentMethod: pickString(record, ['method', 'paymentMethod']) ?? 'cod',
    });
    void queryClient.invalidateQueries({
      queryKey: restaurantOrderKeys.detail(restaurantId, orderId),
      refetchType: 'active',
    });
    return;
  }
}
