/**
 * Kitchen bill helpers — prefer server `order.bill.restaurant` (centralized).
 * Local math is fallback for older payloads without `bill`.
 */

export const PLATFORM_COMMISSION_PERCENT = 12;

export type RestaurantBill = {
  itemTotal: number;
  packaging: number;
  tax: number;
  discount: number;
  restaurantCharges: number;
  commissionPercent: number;
  commissionAmount: number;
  youEarn: number;
};

export type CentralBillPayload = {
  restaurant?: {
    itemTotal?: number;
    packagingCharge?: number;
    taxAmount?: number;
    discount?: number;
    restaurantCharges?: number;
    commissionPercent?: number;
    commissionAmount?: number;
    youEarn?: number;
  };
  customer?: Record<string, unknown>;
  partner?: Record<string, unknown>;
};

type OrderLike = {
  subtotal?: number;
  tax?: number;
  discount?: number;
  packagingCharge?: number;
  items?: Array<{ price?: number; quantity?: number }>;
  bill?: CentralBillPayload | null;
};

function money(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

function fromServer(bill: NonNullable<CentralBillPayload['restaurant']>): RestaurantBill {
  return {
    itemTotal: money(Number(bill.itemTotal) || 0),
    packaging: money(Number(bill.packagingCharge) || 0),
    tax: money(Number(bill.taxAmount) || 0),
    discount: money(Number(bill.discount) || 0),
    restaurantCharges: money(Number(bill.restaurantCharges) || 0),
    commissionPercent: Number(bill.commissionPercent) || PLATFORM_COMMISSION_PERCENT,
    commissionAmount: money(Number(bill.commissionAmount) || 0),
    youEarn: money(Number(bill.youEarn) || 0),
  };
}

/**
 * Kitchen-facing bill: item total + packaging (+ tax) then 12% platform fee → you earn.
 */
export function buildRestaurantBill(
  order: OrderLike,
  commissionPercent = PLATFORM_COMMISSION_PERCENT,
): RestaurantBill {
  if (order.bill?.restaurant) {
    return fromServer(order.bill.restaurant);
  }

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

/** List / card total for kitchen — restaurant charges before commission. */
export function resolveRestaurantOrderTotal(order: OrderLike): number {
  return buildRestaurantBill(order).restaurantCharges;
}

/** Net earning after 12% — business snapshot / delivered earnings. */
export function resolveRestaurantYouEarn(order: OrderLike): number {
  return buildRestaurantBill(order).youEarn;
}
