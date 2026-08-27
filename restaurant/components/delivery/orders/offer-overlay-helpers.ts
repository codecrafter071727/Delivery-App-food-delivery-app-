import type { IncomingOffer } from '@/lib/delivery-partner/offer-store';
import {
  estimateLegEtaMinutes,
  haversineKm,
} from '@/lib/delivery-partner/offer-geo';
import type { RouteEstimateLeg } from '@/lib/delivery-partner/route-estimate-api';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import { getApiErrorCode } from '@/lib/errors';

const OFFER_GONE_CODES = new Set([
  'OFFER_EXPIRED',
  'OFFER_TAKEN',
  'BATCH_EXPIRED',
  'BATCH_NOT_FOUND',
  'BATCH_INCOMPLETE',
]);

export function remainingSeconds(offer: IncomingOffer) {
  if (offer.secondsLeft != null && Number.isFinite(offer.secondsLeft)) {
    return Math.max(0, Math.ceil(offer.secondsLeft));
  }
  if (offer.expiresAt) {
    const ms = Date.parse(offer.expiresAt) - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, Math.ceil(ms / 1000));
  }
  const elapsed = (Date.now() - offer.receivedAt) / 1000;
  return Math.max(0, Math.ceil(offer.timeoutSeconds - elapsed));
}

export function shouldClearOffer(error: unknown) {
  const code = getApiErrorCode(error);
  if (code && OFFER_GONE_CODES.has(code)) return true;
  const message = formatTripError(error, '').toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('another rider') ||
    message.includes('no longer')
  );
}

function validPair(
  lat?: number | null,
  lng?: number | null
): lat is number {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

/** Prefer live rider GPS → restaurant; fall back to server pickupDistanceKm. */
export function resolvePickupKm(
  offer: IncomingOffer,
  riderLat?: number | null,
  riderLng?: number | null
) {
  if (
    validPair(riderLat, riderLng) &&
    validPair(offer.restaurantLat, offer.restaurantLng)
  ) {
    return haversineKm(
      riderLat,
      riderLng,
      offer.restaurantLat,
      offer.restaurantLng
    );
  }
  if (offer.pickupDistanceKm != null && offer.pickupDistanceKm > 0) {
    return offer.pickupDistanceKm;
  }
  return null;
}

/** Prefer restaurant → customer coords; fall back to server drop / estimated km. */
export function resolveDropKm(offer: IncomingOffer) {
  if (
    validPair(offer.restaurantLat, offer.restaurantLng) &&
    validPair(offer.dropLat, offer.dropLng)
  ) {
    return haversineKm(
      offer.restaurantLat,
      offer.restaurantLng,
      offer.dropLat,
      offer.dropLng
    );
  }
  if (offer.dropDistanceKm != null && offer.dropDistanceKm > 0) {
    return offer.dropDistanceKm;
  }
  return offer.estimatedKm ?? null;
}

export type OfferTripMetrics = {
  pickupKm: number | null;
  dropKm: number | null;
  pickupEtaMin: number | null;
  dropEtaMin: number | null;
  totalEtaMin: number | null;
  roadSource: 'google' | 'haversine' | 'mixed' | null;
};

export function resolveOfferTripMetrics(
  offer: IncomingOffer,
  riderLat?: number | null,
  riderLng?: number | null,
  roadLegs?: RouteEstimateLeg[] | null
): OfferTripMetrics {
  const aerialPickup = resolvePickupKm(offer, riderLat, riderLng);
  const aerialDrop = resolveDropKm(offer);

  const pickupRoad = roadLegs?.find((l) => l.id === 'pickup');
  const dropRoad = roadLegs?.find((l) => l.id === 'drop');

  const pickupKm =
    pickupRoad && pickupRoad.distanceKm > 0
      ? pickupRoad.distanceKm
      : aerialPickup;
  const dropKm =
    dropRoad && dropRoad.distanceKm > 0 ? dropRoad.distanceKm : aerialDrop;

  const pickupEtaMin =
    pickupRoad && pickupRoad.provider === 'google'
      ? pickupRoad.etaMinutes
      : estimateLegEtaMinutes(aerialPickup);
  const dropEtaMin =
    dropRoad && dropRoad.provider === 'google'
      ? dropRoad.etaMinutes
      : estimateLegEtaMinutes(aerialDrop);

  const totalEtaMin =
    pickupEtaMin != null || dropEtaMin != null
      ? (pickupEtaMin ?? 0) + (dropEtaMin ?? 0)
      : null;

  const providers = [pickupRoad?.provider, dropRoad?.provider].filter(
    Boolean
  ) as Array<'google' | 'haversine'>;
  let roadSource: OfferTripMetrics['roadSource'] = null;
  if (providers.length) {
    if (providers.every((p) => p === 'google')) roadSource = 'google';
    else if (providers.every((p) => p === 'haversine')) roadSource = 'haversine';
    else roadSource = 'mixed';
  }

  return {
    pickupKm,
    dropKm,
    pickupEtaMin,
    dropEtaMin,
    totalEtaMin,
    roadSource,
  };
}
