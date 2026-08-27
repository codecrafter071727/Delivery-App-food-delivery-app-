import {
  resolvePartnerTripPay,
  type PartnerTripPay,
} from '@/lib/delivery-partner/partner-earnings';
import type { IncomingOffer } from '@/lib/delivery-partner/offer-store';

export type OfferEarnings = PartnerTripPay;

export function resolveOfferEarnings(offer: IncomingOffer): OfferEarnings | null {
  const fromParts = resolvePartnerTripPay({
    deliveryFee: offer.deliveryFee,
    partnerEarnings: offer.partnerEarnings,
    incentiveBonus: offer.incentiveBonus,
  });
  if (!fromParts) return null;
  if (offer.netEarnings != null && Number.isFinite(offer.netEarnings)) {
    return {
      ...fromParts,
      netTotal: Math.max(fromParts.basePay + fromParts.incentive, offer.netEarnings),
    };
  }
  return fromParts;
}

export function formatInr(amount: number) {
  return `₹${Math.round(amount)}`;
}
