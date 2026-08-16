import { Vibration } from 'react-native';

export type IncomingOffer = {
  deliveryId: string;
  orderId?: string;
  restaurantId?: string;
  restaurantName?: string;
  restaurantLat?: number;
  restaurantLng?: number;
  dropLat?: number;
  dropLng?: number;
  deliveryFee?: number;
  estimatedKm?: number;
  timeoutSeconds: number;
  expiresAt?: string;
  broadcast?: boolean;
  secondsLeft?: number;
  pickupLabel?: string;
  dropLabel?: string;
  receivedAt: number;
};

type OfferListener = (offer: IncomingOffer | null) => void;

let current: IncomingOffer | null = null;
const listeners = new Set<OfferListener>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickBool(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof record[key] === 'boolean') return record[key] as boolean;
  }
  return undefined;
}

export function parseIncomingOffer(payload: unknown): IncomingOffer | null {
  const record = asRecord(payload);
  const nested = asRecord(record.delivery ?? record.offer ?? record);
  const source = Object.keys(nested).length ? nested : record;
  const deliveryId =
    pickString(source, ['deliveryId', 'id', '_id', 'assignmentId']) ?? '';
  if (!deliveryId) return null;

  const timeoutSeconds =
    pickNumber(source, ['timeoutSeconds', 'timeout', 'offerTimeoutSeconds']) ??
    30;
  const expiresAt = pickString(source, ['expiresAt', 'expiry', 'expires']);

  return {
    deliveryId,
    orderId: pickString(source, ['orderId', 'order_id']),
    restaurantId: pickString(source, ['restaurantId']),
    restaurantName: pickString(source, [
      'restaurantName',
      'outletName',
      'storeName',
    ]),
    restaurantLat: pickNumber(source, [
      'restaurantLat',
      'pickupLat',
      'pickupLatitude',
    ]),
    restaurantLng: pickNumber(source, [
      'restaurantLng',
      'pickupLng',
      'pickupLongitude',
    ]),
    dropLat: pickNumber(source, ['dropLat', 'customerLat', 'deliveryLat']),
    dropLng: pickNumber(source, ['dropLng', 'customerLng', 'deliveryLng']),
    deliveryFee: pickNumber(source, [
      'deliveryFee',
      'earning',
      'fee',
      'payout',
    ]),
    estimatedKm: pickNumber(source, ['estimatedKm', 'distanceKm', 'distance']),
    timeoutSeconds,
    expiresAt,
    broadcast: pickBool(source, ['broadcast']),
    secondsLeft: pickNumber(source, ['secondsLeft']),
    pickupLabel: pickString(source, ['pickupAddress', 'restaurantAddress']),
    dropLabel: pickString(source, ['dropAddress', 'deliveryAddress']),
    receivedAt: Date.now(),
  };
}

function emit() {
  for (const listener of listeners) listener(current);
}

export function getIncomingOffer() {
  return current;
}

export function subscribeIncomingOffer(listener: OfferListener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function setIncomingOffer(offer: IncomingOffer | null) {
  current = offer;
  emit();
}

export function clearIncomingOffer(deliveryId?: string) {
  if (deliveryId && current && current.deliveryId !== deliveryId) return;
  current = null;
  emit();
}

export function patchIncomingOffer(deliveryId: string, patch: Partial<IncomingOffer>) {
  if (!current || current.deliveryId !== deliveryId) return;
  current = { ...current, ...patch };
  emit();
}

export function alertNewOffer() {
  try {
    Vibration.vibrate([0, 400, 160, 400, 160, 520]);
  } catch {
    // web / denied
  }
}
