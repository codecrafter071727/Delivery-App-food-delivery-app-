import type { OwnerOrder } from '@/lib/dashboard/types';
import type { RestaurantOrderAction } from '@/lib/order/owner-api';
import {
  Check,
  ChefHat,
  ClipboardList,
  Home,
  PackageCheck,
  ShoppingBag,
  Truck,
  type LucideIcon,
} from 'lucide-react-native';

export type TimelineStepKey =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered';

export type TimelineStep = {
  key: TimelineStepKey;
  label: string;
  Icon: LucideIcon;
};

export const ORDER_TIMELINE: TimelineStep[] = [
  { key: 'placed', label: 'Order Placed', Icon: ClipboardList },
  { key: 'accepted', label: 'Accepted', Icon: Check },
  { key: 'preparing', label: 'Preparing', Icon: ChefHat },
  { key: 'ready', label: 'Ready', Icon: PackageCheck },
  { key: 'out_for_delivery', label: 'Out for Delivery', Icon: Truck },
  { key: 'delivered', label: 'Delivered', Icon: Home },
];

const STATUS_RANK: Record<string, number> = {
  pending_payment: 0,
  pending: 0,
  placed: 0,
  accepted: 1,
  preparing: 2,
  ready: 3,
  out_for_delivery: 4,
  delivered: 5,
  completed: 5,
  cancelled: -1,
  rejected: -1,
};

export function statusRank(status?: string | null) {
  return STATUS_RANK[status ?? ''] ?? 0;
}

export function displayStatus(status?: string | null) {
  const raw = String(status ?? '').trim();
  if (!raw) return 'Unknown';
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function statusTone(status?: string | null) {
  if (status === 'cancelled' || status === 'rejected') {
    return { backgroundColor: '#FEF2F2', color: '#DC2626', border: '#FECACA' };
  }
  if (status === 'pending_payment') {
    return { backgroundColor: '#FFFBEB', color: '#B45309', border: '#FDE68A' };
  }
  if (status === 'ready' || status === 'out_for_delivery' || status === 'delivered') {
    return { backgroundColor: '#ECFDF5', color: '#059669', border: '#A7F3D0' };
  }
  if (status === 'preparing') {
    return { backgroundColor: '#FFF7ED', color: '#EA580C', border: '#FED7AA' };
  }
  return {
    backgroundColor: 'rgba(122, 14, 34, 0.08)',
    color: '#7A0E22',
    border: 'rgba(122, 14, 34, 0.18)',
  };
}

export function statusCaption(
  status: string,
  fulfillmentTone?: OwnerOrder['fulfillmentTone']
) {
  if (status === 'pending_payment') return 'Awaiting Payment Confirmation';
  if (status === 'pending' || status === 'placed') return 'Waiting for restaurant acceptance';
  if (status === 'accepted') return 'Order accepted — start preparing';
  if (status === 'preparing') return 'Kitchen is preparing this order';
  if (status === 'ready' && fulfillmentTone === 'pickup') {
    return 'Packed — hand the bag to the customer';
  }
  if (status === 'ready') return 'Packed — wait for the rider, then confirm PIN';
  if (status === 'out_for_delivery') return 'Rider is on the way';
  if (status === 'delivered' && fulfillmentTone === 'pickup') {
    return 'Customer collected the order';
  }
  if (status === 'delivered') return 'Order delivered';
  if (status === 'cancelled' || status === 'rejected') return 'Order cancelled';
  return displayStatus(status);
}

export function kitchenTimeline(order: OwnerOrder): TimelineStep[] {
  if (order.fulfillmentTone === 'pickup') {
    return ORDER_TIMELINE.filter((step) => step.key !== 'out_for_delivery').map(
      (step) => {
        if (step.key === 'ready') {
          return { ...step, label: 'Ready for pickup', Icon: ShoppingBag };
        }
        if (step.key === 'delivered') {
          return { ...step, label: 'Collected', Icon: ShoppingBag };
        }
        return step;
      }
    );
  }
  return ORDER_TIMELINE;
}

export function money(value?: number | null) {
  const amount = Number.isFinite(value as number) ? (value as number) : 0;
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function orderPlacedLabel(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `Placed on ${day} at ${time}`;
}

export function shortOrderId(order: OwnerOrder) {
  const raw = (order.orderNumber || order.id || '').trim();
  if (!raw) return '—';
  const parts = raw.split('-').filter(Boolean);
  const tail = parts[parts.length - 1] || raw;
  return tail.length > 10 ? tail.slice(-8).toUpperCase() : tail.toUpperCase();
}

export function addressText(order: OwnerOrder) {
  const address = order.deliveryAddress;
  if (!address) return '';
  return (
    address.formattedAddress ||
    [address.street, address.area, address.city, address.state, address.pincode]
      .filter(Boolean)
      .join(', ')
  );
}

/** Prefer API total; if missing/0, derive from parts or line items. */
export function resolveOrderTotal(order: OwnerOrder) {
  if (order.total != null && Number.isFinite(order.total) && order.total > 0) {
    return order.total;
  }
  const parts =
    (order.subtotal ?? 0) +
    (order.tax ?? 0) +
    (order.deliveryFee ?? 0) -
    (order.discount ?? 0);
  if (parts > 0) return parts;
  const fromItems = order.items.reduce(
    (sum, item) => sum + (item.price ?? 0) * (item.quantity || 1),
    0
  );
  return fromItems > 0 ? fromItems : order.total ?? 0;
}

export type KitchenTicketAction =
  | {
      kind: 'status';
      action: RestaurantOrderAction;
      label: string;
      Icon: LucideIcon;
    }
  | {
      kind: 'pickup-ready';
      label: string;
      Icon: LucideIcon;
    }
  | {
      kind: 'complete-takeaway';
      label: string;
      Icon: LucideIcon;
    }
  | {
      kind: 'handover';
      label: string;
      Icon: LucideIcon;
    };

export function nextKitchenAction(order: OwnerOrder): KitchenTicketAction | null {
  // Don't allow kitchen actions until payment clears (when pending_payment).
  if (order.status === 'pending_payment') return null;

  if (order.status === 'pending' || order.status === 'placed') {
    return { kind: 'status', action: 'accept', label: 'Accept', Icon: Check };
  }
  if (order.status === 'accepted') {
    return {
      kind: 'status',
      action: 'preparing',
      label: 'Start cooking',
      Icon: ChefHat,
    };
  }
  if (order.status === 'preparing' && order.fulfillmentTone === 'pickup') {
    return {
      kind: 'pickup-ready',
      label: 'Ready for pickup',
      Icon: ShoppingBag,
    };
  }
  if (order.status === 'preparing') {
    return {
      kind: 'status',
      action: 'ready',
      label: 'Food is ready',
      Icon: PackageCheck,
    };
  }
  if (order.status === 'ready' && order.fulfillmentTone === 'pickup') {
    return {
      kind: 'complete-takeaway',
      label: 'Handed to customer',
      Icon: ShoppingBag,
    };
  }
  if (order.status === 'ready' && order.fulfillmentTone === 'delivery') {
    return {
      kind: 'handover',
      label: 'Hand to rider',
      Icon: Truck,
    };
  }
  return null;
}

export function kitchenHandoverCopy(
  outcome: 'confirmed' | 'already' | 'need_otp' | 'waiting',
  message?: string
): { title: string; body: string } {
  if (outcome === 'confirmed') {
    return {
      title: 'Handed to rider',
      body: 'The bag is with the rider. They mark Out for delivery in the rider app after pickup.',
    };
  }
  if (outcome === 'already') {
    return {
      title: 'Already handed over',
      body: 'This order is already with the rider. Out for delivery is set in the rider app, not kitchen.',
    };
  }
  if (outcome === 'need_otp') {
    return {
      title: 'Enter pickup OTP',
      body: 'The rider is at the counter. Open the ticket and enter the 4-digit OTP to confirm handover.',
    };
  }
  return {
    title: 'Wait for the rider',
    body:
      message ||
      'The rider must tap Arrived at restaurant first. Then you can hand over the bag.',
  };
}

export function canReject(order: OwnerOrder) {
  // Backend only allows reject from kitchen-pending states.
  // pending_payment → rejected is invalid ("Invalid status transition").
  return order.status === 'pending' || order.status === 'placed';
}

export function rejectBlockedReason(order: OwnerOrder): string | null {
  if (order.status === 'pending_payment') {
    return 'This order is still awaiting payment. You can reject it after payment is confirmed.';
  }
  if (canReject(order)) return null;
  return 'This order can no longer be rejected.';
}
