import type { OwnerOrder } from '@/lib/dashboard/types';

/** Fixed platform take on restaurant food + tax (matches payment-service default). */
export const PLATFORM_COMMISSION_PERCENT = 12;

export type RestaurantBill = {
  itemTotal: number;
  packaging: number;
  tax: number;
  discount: number;
  /** What kitchen sold (no delivery / platform fees). */
  restaurantCharges: number;
  commissionPercent: number;
  commissionAmount: number;
  /** Amount that lands in restaurant wallet after delivery. */
  youEarn: number;
};

function money(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

/**
 * Kitchen-facing bill: restaurant charges + taxes only.
 * Delivery fee / tip / platform fees are never shown to the outlet.
 */
export function buildRestaurantBill(
  order: Pick<
    OwnerOrder,
    'subtotal' | 'tax' | 'discount' | 'items' | 'packagingCharge'
  >,
  commissionPercent = PLATFORM_COMMISSION_PERCENT,
): RestaurantBill {
  const fromItems = (order.items ?? []).reduce(
    (sum, item) => sum + (item.price ?? 0) * (item.quantity || 1),
    0,
  );
  const itemTotal = money(
    order.subtotal != null && order.subtotal > 0 ? order.subtotal : fromItems,
  );
  const packaging = money(Number(order.packagingCharge ?? 0));
  const tax = money(Number(order.tax ?? 0));
  const discount = money(Number(order.discount ?? 0));
  const restaurantCharges = money(itemTotal + packaging + tax - discount);
  const pct = Number.isFinite(commissionPercent) ? commissionPercent : PLATFORM_COMMISSION_PERCENT;
  const rate = pct > 1 ? pct / 100 : pct;
  const commissionAmount = money(restaurantCharges * rate);
  const youEarn = money(restaurantCharges - commissionAmount);
  return {
    itemTotal,
    packaging,
    tax,
    discount,
    restaurantCharges,
    commissionPercent: +(rate * 100).toFixed(2),
    commissionAmount,
    youEarn,
  };
}

/** List / card total for kitchen — never customer grand total with delivery. */
export function resolveRestaurantOrderTotal(order: OwnerOrder): number {
  return buildRestaurantBill(order).restaurantCharges;
}
