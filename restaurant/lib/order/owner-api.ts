import axios from 'axios';

import type {
  OwnerOrder,
  OwnerOrderAddress,
  OwnerOrderItem,
} from '@/lib/dashboard/types';
import { api } from '@/lib/api';
import { noteRateLimited } from '@/lib/live-query';

/**
 * Kitchen board — restaurant-service only (do not call order-service aliases):
 *   GET  /restaurants/:id/orders
 *   GET  /restaurants/:id/orders/kds
 *   GET  /restaurants/:id/orders/history
 *   GET  /restaurants/:id/orders/scheduled
 *   GET  /restaurants/:id/reject-reasons
 *   GET  /restaurants/:id/orders/:orderId
 *   PUT  /restaurants/:id/orders/:orderId/accept   { prepTime }
 *   PUT  /restaurants/:id/orders/:orderId/reject   { reasonCode, note? }
 *   PUT  /restaurants/:id/orders/:orderId/preparing
 *   PUT  /restaurants/:id/orders/:orderId/ready
 *   PUT  /restaurants/:id/orders/:orderId/out-for-delivery
 *   PUT  /restaurants/:id/orders/:orderId/prep-time   { prepMinutes }
 *   PUT  /restaurants/:id/orders/:orderId/delay       { extraMinutes, reason }
 *   POST /restaurants/:id/orders/:orderId/cancel      { reasonCode, note? }
 *   POST /restaurants/:id/orders/:orderId/items-unavailable { itemIds, note? }
 *   GET  /restaurants/:id/orders/:orderId/sla
 *   POST /restaurants/:id/orders/:orderId/print-kot
 *   PUT  /restaurants/:id/orders/:orderId/pickup-ready
 *   PUT  /restaurants/:id/orders/:orderId/complete-takeaway
 *   GET  /restaurants/:id/orders/:orderId/handover
 *   PUT  /restaurants/:id/orders/:orderId/handover  { method, otp? }
 *   GET  /restaurants/:id/orders/:orderId/rider
 *   POST /restaurants/:id/orders/:orderId/call-customer
 *   POST /restaurants/:id/orders/:orderId/manual-assign { partnerId }
 *   POST /restaurants/:id/orders/:orderId/rate-partner  { stars, comment? }
 */
const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';
const REQUEST_TIMEOUT_MS = 12_000;

export type RestaurantOrderAction =
  | 'accept'
  | 'reject'
  | 'preparing'
  | 'ready'
  | 'out-for-delivery';

export type KitchenStatusPayload = {
  prepTime?: number;
  reasonCode?: string;
  note?: string;
};

export const DEFAULT_PREP_MINUTES = 20;
export const PREP_TIME_OPTIONS = [10, 15, 20, 25, 30, 40] as const;
export const DELAY_EXTRA_OPTIONS = [5, 10, 15, 20] as const;

export type KitchenHandoverMethod = 'otp' | 'tap';

export type KitchenHandover = {
  available: boolean;
  confirmed: boolean;
  status?: string;
  otp?: string;
  methods: KitchenHandoverMethod[];
  riderName?: string;
  message?: string;
};

export type KitchenHandoverTryResult = {
  outcome: 'confirmed' | 'already' | 'need_otp' | 'waiting';
  handover: KitchenHandover;
};

export type KitchenRider = {
  assigned: boolean;
  orderId: string;
  deliveryId?: string;
  partnerId?: string;
  name?: string;
  phoneMasked?: string;
  phone?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  avgRating?: number;
  isOnline?: boolean;
  dutyStatus?: string;
  isFleetPartner?: boolean;
  status?: string;
  assignedAt?: string;
  message?: string;
};

export type KitchenMaskedCall = {
  callId?: string;
  orderId: string;
  deliveryId?: string | null;
  status?: string;
  toMasked?: string;
  virtualNumberMasked?: string;
  provider?: string;
};

export type KitchenPartnerRating = {
  ratingId?: string;
  orderId: string;
  deliveryId?: string;
  stars: number;
  comment?: string;
  source: 'restaurant';
  alreadySubmitted?: boolean;
};

export type KitchenSla = {
  orderId: string;
  status: string;
  acceptBy?: string;
  prepBy?: string;
  acceptRemainingSec: number | null;
  prepRemainingSec: number | null;
  isAcceptOverdue: boolean;
  isPrepOverdue: boolean;
};

export type KotLine = {
  name: string;
  quantity: number;
  instructions?: string;
  modifiers?: string[];
};

export type KotPrintResult = {
  orderId: string;
  orderNumber: string;
  reprint: boolean;
  printCount: number;
  printedAt?: string;
  ticket: {
    restaurantName?: string;
    items: KotLine[];
    specialInstructions?: string;
    deliveryType?: string;
  };
};

export type KitchenMoneyOutcome = {
  order: OwnerOrder;
  refundAmount: number;
  refundIssued: boolean;
  refundId?: string | null;
  refundError?: string | null;
  customerNotified?: boolean;
  deliveryCancelled?: boolean;
  removedItems?: Array<{
    itemId: string;
    name: string;
    quantity: number;
    itemTotal?: number;
  }>;
  previousTotal?: number;
  newTotal?: number;
  codAmountSynced?: boolean;
};

export type RejectReason = {
  code: string;
  label: string;
};

export type KitchenKdsBoard = {
  new: OwnerOrder[];
  preparing: OwnerOrder[];
  ready: OwnerOrder[];
  delayed: OwnerOrder[];
};

export type OrderHistoryPage = {
  orders: OwnerOrder[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
};

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

let emptyStreak = 0;

/** Share recent list results across dashboard + Orders. */
let listCache: {
  restaurantId: string;
  fetchedAt: number;
  orders: OwnerOrder[];
} | null = null;
const LIST_CACHE_TTL_MS = 8_000;

/** Soft backoff when gateway returns 429 — keep UI alive on cache. */
let rateLimitUntil = 0;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const nested =
    record.orders ??
    record.items ??
    record.results ??
    record.docs ??
    record.pendingOrders ??
    record.activeOrders ??
    record.list ??
    record.content ??
    record.rows ??
    record.data;
  if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  return nested && typeof nested === 'object' ? extractList(nested) : [];
}

function extractOrder(data: unknown): Record<string, unknown> {
  const record = asRecord(data);
  const nested = record.order ?? record.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return extractOrder(nested);
  }
  return record;
}

function mapItems(raw: unknown): OwnerOrderItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((row) => {
    const item = asRecord(row);
    const price = Number(item.price ?? item.unitPrice ?? item.basePrice);
    return {
      id: String(item._id ?? item.id ?? item.menuItemId ?? '') || undefined,
      name: String(item.name ?? item.itemName ?? item.title ?? 'Item'),
      quantity: Number(item.quantity ?? item.qty ?? 1),
      price: Number.isFinite(price) ? price : undefined,
      specialInstructions:
        String(item.specialInstructions ?? item.notes ?? '').trim() || undefined,
    };
  });
}

function mapAddress(raw: unknown): OwnerOrderAddress | undefined {
  if (!raw) return undefined;
  if (typeof raw === 'string') return { formattedAddress: raw };
  const address = asRecord(raw);
  return {
    formattedAddress:
      String(
        address.formattedAddress ?? address.fullAddress ?? address.address ?? ''
      ).trim() || undefined,
    street: String(address.street ?? '').trim() || undefined,
    area: String(address.area ?? address.locality ?? '').trim() || undefined,
    city: String(address.city ?? '').trim() || undefined,
    state: String(address.state ?? '').trim() || undefined,
    pincode:
      String(address.pincode ?? address.pinCode ?? address.zip ?? '').trim() ||
      undefined,
    contactName:
      String(address.contactName ?? address.name ?? '').trim() || undefined,
    contactPhone:
      String(address.contactPhone ?? address.phone ?? '').trim() || undefined,
  };
}

function fulfillmentMeta(order: Record<string, unknown>): {
  label: string;
  tone: OwnerOrder['fulfillmentTone'];
} {
  const type = String(
    order.orderType ??
      order.fulfillmentType ??
      order.serviceType ??
      order.type ??
      order.deliveryType ??
      ''
  ).toLowerCase();

  if (type.includes('dine') || type.includes('table')) {
    const table = String(order.tableNumber ?? order.tableNo ?? order.table ?? '').trim();
    return {
      label: table ? `TABLE ${table.padStart(2, '0')}` : 'DINE IN',
      tone: 'table',
    };
  }
  if (type.includes('pickup') || type.includes('takeaway')) {
    return { label: 'PICKUP', tone: 'pickup' };
  }
  if (
    type.includes('delivery') ||
    String(order.channel ?? order.source ?? '').toLowerCase().includes('app') ||
    order.deliveryAddress
  ) {
    return { label: 'DELIVERY APP', tone: 'delivery' };
  }
  return { label: 'IN STORE', tone: 'table' };
}

function optionalNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

export function normalizeOwnerOrderStatus(status?: string): string {
  const normalized = String(status ?? 'pending')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'accepted' || normalized === 'confirmed') return 'accepted';
  if (normalized === 'rejected' || normalized === 'canceled') return 'cancelled';
  return normalized;
}

export function mapOwnerOrder(data: Record<string, unknown>): OwnerOrder {
  const customer = asRecord(data.customer ?? data.user);
  const address = mapAddress(
    data.deliveryAddress ?? data.address ?? data.shippingAddress
  );
  const fulfillment = fulfillmentMeta(data);
  const items = mapItems(data.items ?? data.orderItems ?? data.cartItems);
  const subtotal = optionalNumber(data.subtotal, data.itemTotal);
  const deliveryFee = optionalNumber(data.deliveryFee, data.deliveryCharge);
  const tax = optionalNumber(
    data.tax,
    data.taxes,
    data.taxAmount,
    data.gst,
    data.gstAmount,
    data.gstTotal
  );
  const discount = optionalNumber(data.discount, data.discountAmount);

  const explicitTotal = optionalNumber(
    data.grandTotal,
    data.totalAmount,
    data.payableAmount,
    data.total
  );
  // Some APIs return total: 0 while subtotal/tax are set — prefer derived amount.
  const partsTotal =
    (subtotal ?? 0) + (tax ?? 0) + (deliveryFee ?? 0) - (discount ?? 0);
  const itemsTotal = items.reduce(
    (sum, item) => sum + (item.price ?? 0) * (item.quantity || 1),
    0
  );
  const total =
    explicitTotal != null && explicitTotal > 0
      ? explicitTotal
      : partsTotal > 0
        ? partsTotal
        : itemsTotal > 0
          ? itemsTotal
          : explicitTotal;

  return {
    id: String(data._id ?? data.id ?? data.orderId ?? ''),
    orderNumber: String(
      data.orderNumber ??
        data.orderNo ??
        data.number ??
        data.code ??
        data._id ??
        data.orderId ??
        ''
    ),
    status: normalizeOwnerOrderStatus(
      String(data.status ?? data.orderStatus ?? 'pending')
    ),
    items,
    total,
    fulfillmentLabel: fulfillment.label,
    fulfillmentTone: fulfillment.tone,
    createdAt:
      String(data.createdAt ?? data.placedAt ?? '').trim() || undefined,
    updatedAt: String(data.updatedAt ?? '').trim() || undefined,
    customerName:
      String(
        data.customerName ??
          customer.name ??
          customer.fullName ??
          address?.contactName ??
          ''
      ).trim() || undefined,
    customerPhone:
      String(
        data.customerPhone ??
          customer.phone ??
          customer.mobile ??
          address?.contactPhone ??
          ''
      ).trim() || undefined,
    paymentMethod:
      String(data.paymentMethod ?? data.paymentMode ?? '').trim() || undefined,
    paymentStatus: String(data.paymentStatus ?? '').trim() || undefined,
    subtotal,
    deliveryFee,
    tax,
    discount,
    specialInstructions:
      String(
        data.specialInstructions ?? data.instructions ?? data.notes ?? ''
      ).trim() || undefined,
    deliveryAddress: address,
    rejectionReason:
      String(
        data.rejectionReason ?? data.rejectReason ?? data.cancelReason ?? ''
      ).trim() || undefined,
    scheduledFor:
      String(data.scheduledFor ?? data.scheduledAt ?? data.slotTime ?? '').trim() ||
      undefined,
    isDelayed:
      data.isDelayed === true ||
      String(data.lane ?? data.column ?? data.bucket ?? '').toLowerCase() ===
        'delayed',
    prepMinutes: optionalNumber(
      data.prepMinutes,
      data.prepTime,
      data.prepEta,
      data.estimatedPrepTime
    ),
    itemCount: optionalNumber(data.itemCount),
    delayMinutes: optionalNumber(data.delayMinutes),
    acceptBy: String(data.acceptBy ?? '').trim() || undefined,
    promisedReadyAt:
      String(data.promisedReadyAt ?? data.promisedAt ?? '').trim() || undefined,
  };
}

const ACTIVE_STATUSES = new Set([
  'pending',
  'pending_payment',
  'placed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
]);

function isRateLimited(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status === 429) return true;
  const body = error.response?.data as
    | { message?: string; error?: string }
    | undefined;
  const message = String(
    body?.message ?? body?.error ?? error.message ?? ''
  ).toLowerCase();
  return (
    message.includes('too many request') ||
    message.includes('rate limit') ||
    message.includes('slow down')
  );
}

function markRateLimited(seconds = 45) {
  rateLimitUntil = Date.now() + seconds * 1000;
  // Pause all restaurant live polls (dashboard/menu/etc.), not just orders.
  noteRateLimited();
}

export function isOrderApiBackingOff() {
  return Date.now() < rateLimitUntil;
}

/** Fresh kitchen-board rows if live sync / Orders already fetched them. */
export function getCachedRestaurantOrders(
  restaurantId: string,
  maxAgeMs = 30_000
): OwnerOrder[] | null {
  if (
    listCache &&
    listCache.restaurantId === restaurantId &&
    Date.now() - listCache.fetchedAt < maxAgeMs
  ) {
    return listCache.orders;
  }
  return null;
}

function shouldTryFallback(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  if (isRateLimited(error)) return false;
  if (!error.response) return true;
  const status = error.response.status;
  return status === 404 || status === 405 || status === 501;
}

function errorMessage(error: unknown, fallback: string): Error {
  if (axios.isAxiosError(error)) {
    if (isRateLimited(error)) {
      markRateLimited(25);
      return new Error('Too many requests. Showing last known orders — retrying shortly.');
    }
    if (!error.response) {
      return new Error('Unable to reach the order service. Check your connection.');
    }
    const body = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const detail = body?.message || body?.error || fallback;
    const suffix = body?.code
      ? ` (${body.code})`
      : ` (${error.response.status})`;
    return new Error(`${detail}${suffix}`);
  }
  return error instanceof Error ? error : new Error(fallback);
}

function actionToStatus(action: RestaurantOrderAction): string {
  if (action === 'out-for-delivery') return 'out_for_delivery';
  if (action === 'accept') return 'accepted';
  if (action === 'reject') return 'rejected';
  // preparing / ready — same labels the kitchen board uses
  return action;
}

function predictedStatus(action: RestaurantOrderAction): string {
  return normalizeOwnerOrderStatus(actionToStatus(action));
}

function sortOrders(orders: OwnerOrder[]): OwnerOrder[] {
  return [...orders].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

function kitchenPath(restaurantId: string, suffix: string) {
  return `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}${suffix}`;
}

async function fetchList(restaurantId: string): Promise<OwnerOrder[]> {
  const response = await api.get<Envelope<unknown>>(
    kitchenPath(restaurantId, '/orders'),
    { timeout: REQUEST_TIMEOUT_MS }
  );
  return mapOrderRows(response.data?.data ?? response.data);
}

async function fetchDetail(
  restaurantId: string,
  orderId: string
): Promise<OwnerOrder> {
  const response = await api.get<Envelope<unknown>>(
    kitchenPath(restaurantId, `/orders/${encodeURIComponent(orderId)}`),
    { timeout: REQUEST_TIMEOUT_MS }
  );
  const order = mapOwnerOrder(extractOrder(response.data?.data ?? response.data));
  if (!order.id) {
    return { ...order, id: orderId, orderNumber: order.orderNumber || orderId };
  }
  return order;
}

function mapOrderRows(raw: unknown): OwnerOrder[] {
  return sortOrders(
    extractList(raw)
      .map(mapOwnerOrder)
      .filter((order) => Boolean(order.id))
  );
}

function pickBucket(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] != null) return source[key];
  }
  return [];
}

function mapKdsBoard(raw: unknown): KitchenKdsBoard {
  const record = asRecord(Array.isArray(raw) ? { orders: raw } : extractOrder(raw));
  const grouped = record.board ?? record.columns ?? record.lanes;
  const nested =
    grouped && typeof grouped === 'object' && !Array.isArray(grouped)
      ? asRecord(grouped)
      : record;
  const fromKeys: KitchenKdsBoard = {
    new: mapOrderRows(
      pickBucket(nested, ['new', 'incoming', 'pending', 'placed'])
    ),
    preparing: mapOrderRows(pickBucket(nested, ['preparing', 'cooking'])),
    ready: mapOrderRows(pickBucket(nested, ['ready'])),
    delayed: mapOrderRows(pickBucket(nested, ['delayed', 'late'])),
  };
  const filled =
    fromKeys.new.length +
    fromKeys.preparing.length +
    fromKeys.ready.length +
    fromKeys.delayed.length;
  if (filled > 0) return fromKeys;

  const flat = mapOrderRows(record.orders ?? record.items ?? raw);
  const board: KitchenKdsBoard = {
    new: [],
    preparing: [],
    ready: [],
    delayed: [],
  };
  for (const order of flat) {
    if (order.isDelayed) board.delayed.push(order);
    else if (order.status === 'ready') board.ready.push(order);
    else if (order.status === 'preparing') board.preparing.push(order);
    else board.new.push(order);
  }
  return board;
}

function mapRejectReasons(raw: unknown): RejectReason[] {
  return extractList(raw)
    .map((row) => {
      const rec = asRecord(row);
      const code = String(rec.code ?? rec.reasonCode ?? rec.id ?? '').trim();
      const label = String(rec.label ?? rec.name ?? rec.reason ?? code).trim();
      if (!code) return null;
      return { code, label: label || code };
    })
    .filter((row): row is RejectReason => Boolean(row));
}

/** Prefer list-cache board row when detail endpoint is down. */
function findCachedOrder(orderId: string): OwnerOrder | null {
  if (!listCache) return null;
  return listCache.orders.find((row) => row.id === orderId) ?? null;
}

function kitchenActionBody(
  action: RestaurantOrderAction,
  payload?: KitchenStatusPayload
): Record<string, unknown> {
  if (action === 'accept') {
    const prepTime = payload?.prepTime ?? DEFAULT_PREP_MINUTES;
    return { prepTime };
  }
  if (action === 'reject') {
    const reasonCode = String(payload?.reasonCode ?? '').trim();
    const note = String(payload?.note ?? '').trim();
    return {
      reasonCode,
      ...(note ? { note } : {}),
    };
  }
  return {};
}

async function mutateKitchenAction(
  restaurantId: string,
  orderId: string,
  action: RestaurantOrderAction,
  payload?: KitchenStatusPayload
): Promise<OwnerOrder> {
  const path = kitchenPath(
    restaurantId,
    `/orders/${encodeURIComponent(orderId)}/${action}`
  );
  const response = await api.put<Envelope<unknown>>(
    path,
    kitchenActionBody(action, payload),
    { timeout: REQUEST_TIMEOUT_MS }
  );
  const record = extractOrder(response.data?.data ?? response.data);
  if (record._id || record.id || record.orderId) return mapOwnerOrder(record);
  return {
    id: orderId,
    orderNumber: orderId,
    status: predictedStatus(action),
    items: [],
    fulfillmentLabel: 'DELIVERY APP',
    fulfillmentTone: 'delivery',
    prepMinutes:
      action === 'accept'
        ? payload?.prepTime ?? DEFAULT_PREP_MINUTES
        : undefined,
    rejectionReason: payload?.note ?? payload?.reasonCode,
  };
}

function optionalString(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function mapSla(raw: unknown): KitchenSla {
  const rec = extractOrder(raw);
  const num = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  return {
    orderId: String(rec.orderId ?? rec._id ?? rec.id ?? ''),
    status: String(rec.status ?? ''),
    acceptBy: optionalString(rec.acceptBy),
    prepBy: optionalString(rec.prepBy ?? rec.promisedReadyAt),
    acceptRemainingSec: num(rec.acceptRemainingSec),
    prepRemainingSec: num(rec.prepRemainingSec),
    isAcceptOverdue: rec.isAcceptOverdue === true,
    isPrepOverdue: rec.isPrepOverdue === true,
  };
}

function mapKot(raw: unknown): KotPrintResult {
  const rec = extractOrder(raw);
  const ticket = asRecord(rec.ticket);
  const items = (Array.isArray(ticket.items) ? ticket.items : []).map((row) => {
    const item = asRecord(row);
    const modifiers = Array.isArray(item.modifiers)
      ? item.modifiers.map((mod) => String(mod))
      : undefined;
    return {
      name: String(item.name ?? 'Item'),
      quantity: Number(item.quantity ?? 1) || 1,
      instructions: optionalString(item.instructions ?? item.specialInstructions),
      modifiers,
    };
  });
  return {
    orderId: String(rec.orderId ?? rec._id ?? rec.id ?? ''),
    orderNumber: String(rec.orderNumber ?? ''),
    reprint: rec.reprint === true,
    printCount: Number(rec.printCount ?? 1) || 1,
    printedAt: optionalString(rec.printedAt),
    ticket: {
      restaurantName: optionalString(ticket.restaurantName),
      items,
      specialInstructions: optionalString(ticket.specialInstructions),
      deliveryType: optionalString(ticket.deliveryType),
    },
  };
}

function mapMoneyOutcome(raw: unknown, fallbackId: string): KitchenMoneyOutcome {
  const rec = extractOrder(raw);
  const orderRaw = rec.order ?? rec;
  const order = mapOwnerOrder(extractOrder(orderRaw));
  const removed = extractList(rec.removedItems).map((row) => ({
    itemId: String(row.itemId ?? row._id ?? row.id ?? ''),
    name: String(row.name ?? 'Item'),
    quantity: Number(row.quantity ?? 1) || 1,
    itemTotal: optionalNumber(row.itemTotal, row.total),
  }));
  return {
    order: order.id ? order : { ...order, id: fallbackId },
    refundAmount: Number(rec.refundAmount ?? 0) || 0,
    refundIssued: rec.refundIssued === true,
    refundId: optionalString(rec.refundId) ?? null,
    refundError: optionalString(rec.refundError) ?? null,
    customerNotified: rec.customerNotified === true,
    deliveryCancelled: rec.deliveryCancelled === true,
    removedItems: removed.length ? removed : undefined,
    previousTotal: optionalNumber(rec.previousTotal),
    newTotal: optionalNumber(rec.newTotal, rec.grandTotal),
    codAmountSynced: rec.codAmountSynced === true,
  };
}

function mapHandover(raw: unknown): KitchenHandover {
  const rec = extractOrder(raw);
  const otp = optionalString(
    rec.otp ?? rec.pickupOtp ?? rec.handoverOtp ?? rec.pin ?? rec.code
  );
  const status = optionalString(
    rec.status ?? rec.riderStatus ?? rec.deliveryStatus ?? rec.handoverStatus
  );
  const confirmed =
    rec.confirmed === true ||
    rec.handedOver === true ||
    rec.completed === true ||
    rec.pickupVerified === true;
  const arrived =
    rec.available === true ||
    rec.arrived === true ||
    Boolean(otp) ||
    (status ?? '').toLowerCase().includes('arrived');
  const methods: KitchenHandoverMethod[] = [];
  const rawMethods = rec.methods ?? rec.allowedMethods ?? rec.handoverMethods;
  if (Array.isArray(rawMethods)) {
    for (const row of rawMethods) {
      const value = String(row).toLowerCase();
      if (value === 'otp' || value === 'tap') methods.push(value);
    }
  }
  if (otp && !methods.includes('otp')) methods.push('otp');
  if (arrived && !confirmed && !methods.length) {
    methods.push('otp', 'tap');
  }
  return {
    available: arrived && !confirmed,
    confirmed,
    status,
    otp,
    methods: [...new Set(methods)],
    riderName: optionalString(
      rec.partnerNameMasked ??
        rec.riderName ??
        rec.partnerName ??
        rec.name ??
        rec.fullName
    ),
    message: optionalString(rec.message),
  };
}

function mapRider(raw: unknown, fallbackOrderId: string): KitchenRider {
  const rec = extractOrder(raw);
  const partnerId = optionalString(
    rec.partnerId ?? rec.deliveryPartnerId
  );
  const name = optionalString(
    rec.partnerName ?? rec.name ?? rec.fullName ?? rec.partnerNameMasked
  );
  const assigned = Boolean(
    partnerId || name || rec.assigned === true || rec.deliveryId
  );
  return {
    assigned,
    orderId: optionalString(rec.orderId) ?? fallbackOrderId,
    deliveryId: optionalString(rec.deliveryId),
    partnerId,
    name,
    phoneMasked: optionalString(rec.phoneMasked ?? rec.maskedPhone),
    phone: optionalString(rec.phone ?? rec.mobile ?? rec.phoneNumber),
    vehicleType: optionalString(rec.vehicleType ?? rec.vehicle),
    vehicleNumber: optionalString(rec.vehicleNumber ?? rec.vehicleNo),
    avgRating: optionalNumber(rec.avgRating, rec.rating, rec.averageRating),
    isOnline: rec.isOnline === true,
    dutyStatus: optionalString(rec.dutyStatus ?? rec.status),
    isFleetPartner: rec.isFleetPartner === true,
    status: optionalString(rec.status ?? rec.deliveryStatus),
    assignedAt: optionalString(rec.assignedAt),
    message: optionalString(rec.message),
  };
}

function mapMaskedCall(raw: unknown, fallbackOrderId: string): KitchenMaskedCall {
  const rec = extractOrder(raw);
  return {
    callId: optionalString(rec.callId ?? rec.id ?? rec._id),
    orderId: optionalString(rec.orderId) ?? fallbackOrderId,
    deliveryId: optionalString(rec.deliveryId) ?? null,
    status: optionalString(rec.status),
    toMasked: optionalString(rec.toMasked ?? rec.customerMasked ?? rec.phoneMasked),
    virtualNumberMasked: optionalString(
      rec.virtualNumberMasked ?? rec.fromMasked
    ),
    provider: optionalString(rec.provider),
  };
}

function mapPartnerRating(
  raw: unknown,
  fallbackOrderId: string,
  stars: number
): KitchenPartnerRating {
  const rec = extractOrder(raw);
  return {
    ratingId: optionalString(rec.ratingId ?? rec.id ?? rec._id),
    orderId: optionalString(rec.orderId) ?? fallbackOrderId,
    deliveryId: optionalString(rec.deliveryId),
    stars: Number(rec.stars ?? stars) || stars,
    comment: optionalString(rec.comment),
    source: 'restaurant',
    alreadySubmitted: rec.alreadySubmitted === true,
  };
}

function rememberList(restaurantId: string, orders: OwnerOrder[]) {
  listCache = {
    restaurantId,
    fetchedAt: Date.now(),
    orders,
  };
}

/** Force next fetch to rediscover endpoints (used by pull-to-refresh). */
export function resetOrderApiDiscovery() {
  emptyStreak = 0;
  listCache = null;
  rateLimitUntil = 0;
}

export const restaurantOrderApi = {
  /**
   * Incoming kitchen list — restaurant-service only
   * GET /restaurants/:id/orders
   */
  getRestaurantOrders: async (
    restaurantId: string,
    options?: { bypassCache?: boolean }
  ): Promise<OwnerOrder[]> => {
    if (
      !options?.bypassCache &&
      listCache &&
      listCache.restaurantId === restaurantId &&
      Date.now() - listCache.fetchedAt < LIST_CACHE_TTL_MS
    ) {
      return listCache.orders;
    }

    if (isOrderApiBackingOff() && listCache?.restaurantId === restaurantId) {
      return listCache.orders;
    }

    try {
      const orders = await fetchList(restaurantId);
      emptyStreak = 0;
      rememberList(restaurantId, orders);
      return orders;
    } catch (error) {
      if (isRateLimited(error)) {
        markRateLimited(25);
        if (listCache?.restaurantId === restaurantId) return listCache.orders;
      }
      if (listCache?.restaurantId === restaurantId) return listCache.orders;
      throw errorMessage(error, 'Unable to load restaurant orders');
    }
  },

  /** GET /restaurants/:id/orders/kds */
  getKds: async (restaurantId: string): Promise<KitchenKdsBoard> => {
    try {
      const response = await api.get<Envelope<unknown>>(
        kitchenPath(restaurantId, '/orders/kds'),
        { timeout: REQUEST_TIMEOUT_MS }
      );
      return mapKdsBoard(response.data?.data ?? response.data);
    } catch (error) {
      throw errorMessage(error, 'Unable to load kitchen board');
    }
  },

  /** GET /restaurants/:id/orders/history?from=&to=&page=&limit= */
  getHistory: async (
    restaurantId: string,
    query: { from?: string; to?: string; page?: number; limit?: number }
  ): Promise<OrderHistoryPage> => {
    try {
      const response = await api.get<Envelope<unknown>>(
        kitchenPath(restaurantId, '/orders/history'),
        {
          timeout: REQUEST_TIMEOUT_MS,
          params: {
            from: query.from,
            to: query.to,
            page: query.page ?? 1,
            limit: query.limit ?? 20,
          },
        }
      );
      const body = asRecord(response.data);
      const data = response.data?.data ?? body.data;
      const meta = asRecord(body.meta);
      const orders = mapOrderRows(data);
      const page = Number(meta.page ?? query.page ?? 1) || 1;
      const limit = Number(meta.limit ?? query.limit ?? 20) || 20;
      const total = Number(meta.total ?? orders.length) || orders.length;
      const totalPages =
        Number(meta.totalPages ?? Math.max(1, Math.ceil(total / limit))) || 1;
      return {
        orders,
        total,
        page,
        limit,
        totalPages,
        hasNext:
          meta.hasNext === true ||
          (typeof meta.hasNext !== 'boolean' && page < totalPages),
      };
    } catch (error) {
      throw errorMessage(error, 'Unable to load order history');
    }
  },

  /** GET /restaurants/:id/orders/scheduled */
  getScheduled: async (restaurantId: string): Promise<OwnerOrder[]> => {
    try {
      const response = await api.get<Envelope<unknown>>(
        kitchenPath(restaurantId, '/orders/scheduled'),
        { timeout: REQUEST_TIMEOUT_MS }
      );
      return mapOrderRows(response.data?.data ?? response.data);
    } catch (error) {
      throw errorMessage(error, 'Unable to load scheduled orders');
    }
  },

  /** GET /restaurants/:id/reject-reasons */
  getRejectReasons: async (restaurantId: string): Promise<RejectReason[]> => {
    try {
      const response = await api.get<Envelope<unknown>>(
        kitchenPath(restaurantId, '/reject-reasons'),
        { timeout: REQUEST_TIMEOUT_MS }
      );
      const reasons = mapRejectReasons(response.data?.data ?? response.data);
      if (reasons.length) return reasons;
      return [
        { code: 'item_unavailable', label: 'Item unavailable' },
        { code: 'store_busy', label: 'Store too busy' },
        { code: 'closing', label: 'Closing soon' },
        { code: 'address_far', label: 'Delivery address too far' },
        { code: 'kitchen_closed', label: 'Kitchen closed' },
        { code: 'out_of_stock', label: 'Out of stock' },
        { code: 'other', label: 'Other' },
      ];
    } catch (error) {
      throw errorMessage(error, 'Unable to load reject reasons');
    }
  },

  /** GET /restaurants/:id/orders/:orderId */
  getOrder: async (
    restaurantId: string,
    orderId: string
  ): Promise<OwnerOrder> => {
    try {
      const order = await fetchDetail(restaurantId, orderId);
      return order;
    } catch (error) {
      if (isRateLimited(error)) markRateLimited(20);
      const cached = findCachedOrder(orderId);
      if (cached) return cached;
      throw errorMessage(error, 'Unable to load order details');
    }
  },

  /**
   * Kitchen status — restaurant-service only:
   * PUT .../accept | reject | preparing | ready | out-for-delivery
   */
  updateOrderStatus: async (
    restaurantId: string,
    orderId: string,
    action: RestaurantOrderAction,
    payload?: KitchenStatusPayload
  ): Promise<OwnerOrder> => {
    try {
      const updated = await mutateKitchenAction(
        restaurantId,
        orderId,
        action,
        payload
      );
      listCache = null;
      return updated;
    } catch (error) {
      if (isRateLimited(error)) markRateLimited(20);
      throw errorMessage(error, 'Unable to update order');
    }
  },

  /** PUT /restaurants/:id/orders/:orderId/prep-time { prepMinutes } */
  updatePrepTime: async (
    restaurantId: string,
    orderId: string,
    prepMinutes: number
  ): Promise<OwnerOrder> => {
    try {
      const response = await api.put<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/prep-time`
        ),
        { prepMinutes },
        { timeout: REQUEST_TIMEOUT_MS }
      );
      const order = mapOwnerOrder(
        extractOrder(response.data?.data ?? response.data)
      );
      listCache = null;
      return order.id ? order : { ...order, id: orderId, prepMinutes };
    } catch (error) {
      throw errorMessage(error, 'Unable to update prep time');
    }
  },

  /** PUT /restaurants/:id/orders/:orderId/delay { extraMinutes, reason } */
  delayOrder: async (
    restaurantId: string,
    orderId: string,
    input: { extraMinutes: number; reason: string }
  ): Promise<OwnerOrder> => {
    try {
      const response = await api.put<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/delay`
        ),
        input,
        { timeout: REQUEST_TIMEOUT_MS }
      );
      const rec = extractOrder(response.data?.data ?? response.data);
      const order = mapOwnerOrder(extractOrder(rec.order ?? rec));
      listCache = null;
      return order.id
        ? { ...order, isDelayed: true, delayMinutes: input.extraMinutes }
        : {
            ...order,
            id: orderId,
            isDelayed: true,
            delayMinutes: input.extraMinutes,
          };
    } catch (error) {
      throw errorMessage(error, 'Unable to mark order delayed');
    }
  },

  /** POST /restaurants/:id/orders/:orderId/cancel { reasonCode, note? } */
  cancelOrder: async (
    restaurantId: string,
    orderId: string,
    input: { reasonCode: string; note?: string }
  ): Promise<KitchenMoneyOutcome> => {
    try {
      const response = await api.post<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/cancel`
        ),
        input,
        { timeout: 20_000 }
      );
      listCache = null;
      return mapMoneyOutcome(response.data?.data ?? response.data, orderId);
    } catch (error) {
      throw errorMessage(error, 'Unable to cancel order');
    }
  },

  /** POST /restaurants/:id/orders/:orderId/items-unavailable { itemIds, note? } */
  markItemsUnavailable: async (
    restaurantId: string,
    orderId: string,
    input: { itemIds: string[]; note?: string }
  ): Promise<KitchenMoneyOutcome> => {
    try {
      const response = await api.post<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/items-unavailable`
        ),
        input,
        { timeout: 20_000 }
      );
      listCache = null;
      return mapMoneyOutcome(response.data?.data ?? response.data, orderId);
    } catch (error) {
      throw errorMessage(error, 'Unable to remove items');
    }
  },

  /** GET /restaurants/:id/orders/:orderId/sla */
  getSla: async (restaurantId: string, orderId: string): Promise<KitchenSla> => {
    try {
      const response = await api.get<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/sla`
        ),
        { timeout: REQUEST_TIMEOUT_MS }
      );
      return mapSla(response.data?.data ?? response.data);
    } catch (error) {
      throw errorMessage(error, 'Unable to load order timers');
    }
  },

  /** POST /restaurants/:id/orders/:orderId/print-kot */
  printKot: async (
    restaurantId: string,
    orderId: string
  ): Promise<KotPrintResult> => {
    try {
      const response = await api.post<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/print-kot`
        ),
        {},
        { timeout: REQUEST_TIMEOUT_MS }
      );
      return mapKot(response.data?.data ?? response.data);
    } catch (error) {
      throw errorMessage(error, 'Unable to print KOT');
    }
  },

  /** PUT /restaurants/:id/orders/:orderId/pickup-ready */
  pickupReady: async (
    restaurantId: string,
    orderId: string
  ): Promise<OwnerOrder> => {
    try {
      const response = await api.put<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/pickup-ready`
        ),
        {},
        { timeout: REQUEST_TIMEOUT_MS }
      );
      listCache = null;
      const order = mapOwnerOrder(
        extractOrder(response.data?.data ?? response.data)
      );
      return order.id ? order : { ...order, id: orderId, status: 'ready' };
    } catch (error) {
      throw errorMessage(error, 'Unable to mark pickup ready');
    }
  },

  /** PUT /restaurants/:id/orders/:orderId/complete-takeaway */
  completeTakeaway: async (
    restaurantId: string,
    orderId: string
  ): Promise<OwnerOrder> => {
    try {
      const response = await api.put<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/complete-takeaway`
        ),
        {},
        { timeout: REQUEST_TIMEOUT_MS }
      );
      listCache = null;
      const order = mapOwnerOrder(
        extractOrder(response.data?.data ?? response.data)
      );
      return order.id ? order : { ...order, id: orderId, status: 'delivered' };
    } catch (error) {
      throw errorMessage(error, 'Unable to complete takeaway');
    }
  },

  /** GET /restaurants/:id/orders/:orderId/handover — never invents OTP */
  getHandover: async (
    restaurantId: string,
    orderId: string
  ): Promise<KitchenHandover> => {
    try {
      const response = await api.get<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/handover`
        ),
        { timeout: REQUEST_TIMEOUT_MS }
      );
      return mapHandover(response.data?.data ?? response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 400 || status === 404 || status === 409) {
          const body = error.response?.data as
            | { message?: string; code?: string }
            | undefined;
          return {
            available: false,
            confirmed: false,
            methods: [],
            message:
              body?.message ||
              'Rider has not arrived yet. OTP appears when they reach the store.',
          };
        }
      }
      throw errorMessage(error, 'Unable to load handover details');
    }
  },

  /** PUT /restaurants/:id/orders/:orderId/handover { method, otp? } */
  confirmHandover: async (
    restaurantId: string,
    orderId: string,
    input: { method: KitchenHandoverMethod; otp?: string }
  ): Promise<KitchenHandover> => {
    try {
      const response = await api.put<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/handover`
        ),
        input.method === 'otp'
          ? { method: 'otp', otp: String(input.otp ?? '').replace(/\D/g, '').slice(0, 4) }
          : { method: 'tap' },
        { timeout: REQUEST_TIMEOUT_MS }
      );
      const mapped = mapHandover(response.data?.data ?? response.data);
      return { ...mapped, confirmed: true, available: false };
    } catch (error) {
      throw errorMessage(error, 'Unable to confirm handover');
    }
  },

  /**
   * Kitchen bag handoff — PUT /handover (tap/OTP). Never PUT /out-for-delivery
   * for platform delivery; rider pickup sets OFD.
   */
  tryKitchenHandover: async (
    restaurantId: string,
    orderId: string
  ): Promise<KitchenHandoverTryResult> => {
    const handover = await restaurantOrderApi.getHandover(restaurantId, orderId);
    if (handover.confirmed) {
      return { outcome: 'already', handover };
    }
    if (handover.available && handover.methods.includes('tap')) {
      const next = await restaurantOrderApi.confirmHandover(restaurantId, orderId, {
        method: 'tap',
      });
      return { outcome: 'confirmed', handover: next };
    }
    if (handover.available && (handover.methods.includes('otp') || handover.otp)) {
      return { outcome: 'need_otp', handover };
    }
    return { outcome: 'waiting', handover };
  },

  /** GET /restaurants/:id/orders/:orderId/rider — never invents a rider */
  getRider: async (
    restaurantId: string,
    orderId: string
  ): Promise<KitchenRider> => {
    try {
      const response = await api.get<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/rider`
        ),
        { timeout: REQUEST_TIMEOUT_MS }
      );
      return mapRider(response.data?.data ?? response.data, orderId);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 404) {
          return {
            assigned: false,
            orderId,
            message: 'No rider assigned yet.',
          };
        }
      }
      throw errorMessage(error, 'Unable to load assigned rider');
    }
  },

  /** POST /restaurants/:id/orders/:orderId/call-customer */
  callCustomer: async (
    restaurantId: string,
    orderId: string
  ): Promise<KitchenMaskedCall> => {
    try {
      const response = await api.post<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/call-customer`
        ),
        {},
        { timeout: 20_000 }
      );
      return mapMaskedCall(response.data?.data ?? response.data, orderId);
    } catch (error) {
      throw errorMessage(error, 'Unable to start masked call');
    }
  },

  /** POST /restaurants/:id/orders/:orderId/manual-assign { partnerId } */
  manualAssign: async (
    restaurantId: string,
    orderId: string,
    partnerId: string
  ): Promise<KitchenRider> => {
    try {
      const response = await api.post<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/manual-assign`
        ),
        { partnerId },
        { timeout: 20_000 }
      );
      const mapped = mapRider(response.data?.data ?? response.data, orderId);
      return {
        ...mapped,
        assigned: true,
        partnerId: mapped.partnerId ?? partnerId,
        isFleetPartner: mapped.isFleetPartner ?? true,
      };
    } catch (error) {
      throw errorMessage(error, 'Unable to assign rider');
    }
  },

  /** POST /restaurants/:id/orders/:orderId/rate-partner { stars, comment?, partnerId? } */
  ratePartner: async (
    restaurantId: string,
    orderId: string,
    input: { stars: number; comment?: string; partnerId?: string }
  ): Promise<KitchenPartnerRating> => {
    const stars = Math.min(5, Math.max(1, Math.round(input.stars)));
    try {
      const response = await api.post<Envelope<unknown>>(
        kitchenPath(
          restaurantId,
          `/orders/${encodeURIComponent(orderId)}/rate-partner`
        ),
        {
          stars,
          ...(input.comment ? { comment: input.comment } : {}),
          ...(input.partnerId ? { partnerId: input.partnerId } : {}),
        },
        { timeout: REQUEST_TIMEOUT_MS }
      );
      return mapPartnerRating(
        response.data?.data ?? response.data,
        orderId,
        stars
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const code = String(
          (error.response?.data as { code?: string } | undefined)?.code ?? ''
        ).toUpperCase();
        if (
          error.response?.status === 409 &&
          code.includes('RATING_ALREADY')
        ) {
          return {
            orderId,
            stars,
            source: 'restaurant',
            alreadySubmitted: true,
          };
        }
      }
      throw errorMessage(error, 'Unable to rate rider');
    }
  },

  getPendingOrders: async (restaurantId: string): Promise<OwnerOrder[]> => {
    const orders = await restaurantOrderApi.getRestaurantOrders(restaurantId);
    return orders.filter((order) => ACTIVE_STATUSES.has(order.status));
  },

  countActiveOrders: async (restaurantId: string): Promise<number> => {
    const orders = await restaurantOrderApi.getRestaurantOrders(restaurantId);
    return orders.filter((order) => ACTIVE_STATUSES.has(order.status)).length;
  },
};
