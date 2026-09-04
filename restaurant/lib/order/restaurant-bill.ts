/**
 * Kitchen bill helpers — prefer server `order.bill.restaurant` when it has real amounts.
 * Kitchen earn = food items − discount − admin commission. Never packaging, GST, or delivery.
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
  total?: number;
  grandTotal?: number;
  items?: Array<{ price?: number; quantity?: number; itemTotal?: number }>;
  bill?: CentralBillPayload | null;
};

function money(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

function fromServer(bill: NonNullable<CentralBillPayload['restaurant']>): RestaurantBill {
  return {
    itemTotal: money(Number(bill.itemTotal) || 0),
    packaging: 0,
    tax: 0,
    discount: money(Number(bill.discount) || 0),
    restaurantCharges: money(Number(bill.restaurantCharges) || 0),
    commissionPercent: Number(bill.commissionPercent) || PLATFORM_COMMISSION_PERCENT,
    commissionAmount: money(Number(bill.commissionAmount) || 0),
    youEarn: money(Number(bill.youEarn) || 0),
  };
}

function serverBillUsable(
  bill: NonNullable<CentralBillPayload['restaurant']> | undefined,
): bill is NonNullable<CentralBillPayload['restaurant']> {
  if (!bill || typeof bill !== 'object') return false;
  const charges = Number(bill.restaurantCharges);
  const items = Number(bill.itemTotal);
  const earn = Number(bill.youEarn);
  return (
    (Number.isFinite(charges) && charges > 0)
    || (Number.isFinite(items) && items > 0)
    || (Number.isFinite(earn) && earn > 0)
  );
}

/**
 * Kitchen-facing bill: food − discount, then admin commission % → you earn.
 */
export function buildRestaurantBill(
  order: OrderLike,
  commissionPercent = PLATFORM_COMMISSION_PERCENT,
): RestaurantBill {
  if (serverBillUsable(order.bill?.restaurant)) {
    return fromServer(order.bill!.restaurant!);
  }

  const fromItems = (order.items ?? []).reduce((sum, item) => {
    if (item.itemTotal != null && Number.isFinite(item.itemTotal)) {
      return sum + Number(item.itemTotal);
    }
    return sum + (item.price ?? 0) * (item.quantity || 1);
  }, 0);
  const itemTotal = money(
    order.subtotal != null && order.subtotal > 0 ? order.subtotal : fromItems,
  );
  const discount = money(Number(order.discount ?? 0));
  let restaurantCharges = money(itemTotal - discount);

  // Kitchen `grandTotal` is item total after toKitchenOrderView — not customer payable.
  if (restaurantCharges <= 0) {
    const fallback = Number(order.total ?? order.grandTotal ?? 0);
    if (Number.isFinite(fallback) && fallback > 0) {
      restaurantCharges = money(fallback);
    }
  }

  const pct = Number.isFinite(commissionPercent) ? commissionPercent : PLATFORM_COMMISSION_PERCENT;
  const rate = pct > 1 ? pct / 100 : pct;
  const commissionAmount = money(restaurantCharges * rate);
  const youEarn = money(restaurantCharges - commissionAmount);
  return {
    itemTotal: itemTotal > 0 ? itemTotal : restaurantCharges,
    packaging: 0,
    tax: 0,
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
