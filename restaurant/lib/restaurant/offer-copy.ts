import type { OfferDiscountType, RestaurantOffer } from '@/lib/restaurant/types';

/** Short badge: "50% OFF", "₹50 OFF", "FREE DELIVERY". */
export function discountLabel(offer: Pick<RestaurantOffer, 'discountType' | 'discountValue'>) {
  const value = offer.discountValue ?? 0;
  const type = String(offer.discountType ?? 'percentage').toLowerCase();
  if (type === 'flat') return `₹${Math.round(value)} OFF`;
  if (type === 'free_delivery') return 'FREE DELIVERY';
  if (type === 'bogo' || type.includes('buy')) return 'BOGO';
  return `${Math.round(value)}% OFF`;
}

/**
 * Full effect line customers / owners understand.
 * Discount always applies on cart item total (subtotal), not taxes/delivery.
 */
export function offerEffectSummary(input: {
  discountType?: OfferDiscountType | string;
  discountValue?: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
}): string {
  const type = String(input.discountType ?? 'percentage').toLowerCase();
  const value = input.discountValue ?? 0;
  const min = input.minOrderAmount ?? 0;
  const minPart =
    min > 0 ? ` on item total ₹${Math.round(min)}+` : ' on item total';

  if (type === 'flat') return `₹${Math.round(value)} off${minPart}`;
  if (type === 'free_delivery') return `Free delivery${minPart}`;
  if (type === 'bogo' || type.includes('buy')) return `Buy 1 Get 1${minPart}`;

  const cap =
    input.maxDiscountAmount != null && input.maxDiscountAmount > 0
      ? ` (max ₹${Math.round(input.maxDiscountAmount)})`
      : '';
  return `${Math.round(value)}% off${minPart}${cap}`;
}

export function normalizeOfferType(value?: string): OfferDiscountType {
  const lower = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (lower === 'flat' || lower === 'flat_amount' || lower === 'fixed') {
    return 'flat';
  }
  if (lower === 'free_delivery' || lower === 'freedelivery') {
    return 'free_delivery';
  }
  if (lower === 'bogo' || lower.includes('buy')) return 'bogo';
  return 'percentage';
}

export function valueFieldLabel(type: OfferDiscountType) {
  switch (type) {
    case 'flat':
      return 'Amount (₹)';
    case 'free_delivery':
      return 'Value (optional)';
    case 'bogo':
      return 'Value (optional)';
    default:
      return 'Discount %';
  }
}
