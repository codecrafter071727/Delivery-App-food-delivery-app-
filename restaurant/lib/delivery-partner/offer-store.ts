import { Vibration } from 'react-native';

import {
  playOfferAlertSound,
  stopOfferAlertSound,
} from '@/lib/delivery-partner/offer-sound';

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
  /** Partner share after platform commission (INR). */
  partnerEarnings?: number;
  /** Rain / distance incentive on top of base pay (INR). */
  incentiveBonus?: number;
  /** Base pay + incentive (server-computed for this rider). */
  netEarnings?: number;
  estimatedKm?: number;
  /** Rider GPS → restaurant (km). */
  pickupDistanceKm?: number;
  /** Restaurant → customer drop (km). */
  dropDistanceKm?: number;
  /** Expanding search radius when this offer was created (km). */
  searchRadiusKm?: number;
  timeoutSeconds: number;
  expiresAt?: string;
  broadcast?: boolean;
  secondsLeft?: number;
  pickupLabel?: string;
  dropLabel?: string;
  batchId?: string;
  nextAction?: string;
  receivedAt: number;
  /** Set when `delivery:assignment-expiring` fires (~10s left). */
  expiring?: boolean;
};

type OfferListener = (offer: IncomingOffer | null) => void;

let current: IncomingOffer | null = null;
const listeners = new Set<OfferListener>();
const remembered = new Map<string, IncomingOffer>();
/** Declined offers — backend skip-list is authoritative; this blocks duplicate socket popups. */
const declinedKeys = new Set<string>();

function rememberOffer(offer: IncomingOffer) {
  remembered.set(offer.deliveryId, offer);
  if (offer.orderId) remembered.set(offer.orderId, offer);
}

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
  const expiresAt = pickString(source, [
    'offerExpiresAt',
    'expiresAt',
    'expiry',
    'expires',
  ]);
  const restaurantLoc = asRecord(
    source.restaurantLocation ?? source.pickupLocation
  );
  const dropLoc = asRecord(source.deliveryLocation ?? source.dropLocation);

  return {
    deliveryId,
    orderId: pickString(source, ['orderId', 'order_id']),
    restaurantId: pickString(source, ['restaurantId']),
    restaurantName: pickString(source, [
      'restaurantName',
      'outletName',
      'storeName',
    ]),
    restaurantLat:
      pickNumber(source, [
        'restaurantLat',
        'pickupLat',
        'pickupLatitude',
      ]) ?? pickNumber(restaurantLoc, ['latitude', 'lat']),
    restaurantLng:
      pickNumber(source, [
        'restaurantLng',
        'pickupLng',
        'pickupLongitude',
      ]) ?? pickNumber(restaurantLoc, ['longitude', 'lng', 'lon']),
    dropLat:
      pickNumber(source, ['dropLat', 'customerLat', 'deliveryLat']) ??
      pickNumber(dropLoc, ['latitude', 'lat']),
    dropLng:
      pickNumber(source, ['dropLng', 'customerLng', 'deliveryLng']) ??
      pickNumber(dropLoc, ['longitude', 'lng', 'lon']),
    deliveryFee: pickNumber(source, [
      'deliveryFee',
      'earning',
      'fee',
      'payout',
    ]),
    partnerEarnings: pickNumber(source, [
      'partnerEarnings',
      'baseEarnings',
      'partnerShare',
      'netEarnings',
    ]),
    incentiveBonus: pickNumber(source, [
      'incentiveBonus',
      'incentive',
      'bonus',
    ]),
    netEarnings: pickNumber(source, ['netEarnings', 'netPay', 'totalEarnings']),
    estimatedKm: pickNumber(source, ['estimatedKm', 'distanceKm', 'distance']),
    pickupDistanceKm: pickNumber(source, [
      'pickupDistanceKm',
      'riderToRestaurantKm',
      'distanceToPickupKm',
    ]),
    dropDistanceKm: pickNumber(source, [
      'dropDistanceKm',
      'restaurantToCustomerKm',
      'tripDistanceKm',
    ]),
    searchRadiusKm: pickNumber(source, [
      'searchRadiusKm',
      'radiusKm',
      'offerRadiusKm',
    ]),
    timeoutSeconds,
    expiresAt,
    broadcast: pickBool(source, ['broadcast']),
    secondsLeft: pickNumber(source, ['secondsLeft']),
    pickupLabel: pickString(source, ['pickupAddress', 'restaurantAddress']),
    dropLabel: pickString(source, [
      'dropAddress',
      'deliveryAddress',
      'customerAddress',
    ]),
    batchId:
      pickString(source, ['batchId']) || pickString(record, ['batchId']),
    nextAction: pickString(source, ['nextAction']),
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


export function isOfferDeclined(deliveryId?: string, orderId?: string) {
  if (deliveryId && declinedKeys.has(deliveryId)) return true;
  if (orderId && declinedKeys.has(orderId)) return true;
  return false;
}

export function markOfferDeclined(deliveryId: string, orderId?: string) {
  declinedKeys.add(deliveryId);
  if (orderId) declinedKeys.add(orderId);
  if (declinedKeys.size > 120) {
    const keep = [...declinedKeys].slice(-60);
    declinedKeys.clear();
    keep.forEach((key) => declinedKeys.add(key));
  }
}

export function setIncomingOffer(offer: IncomingOffer | null) {
  if (offer && isOfferDeclined(offer.deliveryId, offer.orderId)) return;
  if (offer) rememberOffer(offer);
  current = offer;
  emit();
  if (!offer) void stopOfferAlertSound();
}

export function getRememberedOffer(deliveryId?: string | null) {
  if (!deliveryId) return null;
  return remembered.get(deliveryId) ?? null;
}

export function clearIncomingOffer(deliveryId?: string) {
  if (deliveryId && current && current.deliveryId !== deliveryId) return;
  current = null;
  emit();
  void stopOfferAlertSound();
}

export function patchIncomingOffer(deliveryId: string, patch: Partial<IncomingOffer>) {
  if (!current || current.deliveryId !== deliveryId) return;
  current = { ...current, ...patch };
  rememberOffer(current);
  emit();
}

function vibrateOfferAlert(expiring = false) {
  try {
    Vibration.vibrate(
      expiring ? [0, 280, 120, 280] : [0, 400, 160, 400, 160, 520]
    );
  } catch {
    // web / denied
  }
}

export function alertNewOffer() {
  vibrateOfferAlert(false);
  void playOfferAlertSound();
}

/** Second alert when ~10s remain on the 30s offer window. */
export function alertOfferExpiring() {
  vibrateOfferAlert(true);
  void playOfferAlertSound();
}
