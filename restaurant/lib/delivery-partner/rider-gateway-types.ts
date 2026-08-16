export type RiderGatewayEvent =
  | 'delivery:new'
  | 'delivery:assigned'
  | 'delivery:assignment-expiring'
  | 'delivery:cancelled'
  | 'delivery:updated'
  | 'delivery:status'
  | 'notification:new'
  | 'earnings:updated'
  | 'wallet:credited'
  | 'chat:new-message'
  | 'typing'
  | 'partner:location'
  | 'tracking:location'
  | 'tracking:eta';

export type RiderOutboundEvent =
  | 'partner:online'
  | 'partner:offline'
  | 'partner:heartbeat'
  | 'partner:location'
  | 'delivery:accept'
  | 'delivery:reject'
  | 'delivery:arrived'
  | 'delivery:picked-up'
  | 'delivery:reached-customer'
  | 'delivery:completed'
  | 'chat:new-message'
  | 'typing';

export type RiderGatewayStatus = 'idle' | 'connecting' | 'connected' | 'offline';

export type RiderLocationEmit = {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  isMock?: boolean;
  timestamp?: string;
};

export const REJECT_REASON_CODES = [
  { code: 'too_far', label: 'Too far' },
  { code: 'restaurant_closed', label: 'Restaurant closed' },
  { code: 'vehicle_issue', label: 'Vehicle issue' },
  { code: 'personal_emergency', label: 'Personal emergency' },
  { code: 'order_too_large', label: 'Order too large' },
  { code: 'already_on_delivery', label: 'Already on a delivery' },
  { code: 'other', label: 'Other' },
] as const;

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number]['code'];

export function toRejectReasonCode(reason: string): RejectReasonCode {
  const raw = reason.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const match = REJECT_REASON_CODES.find(
    (row) => row.code === raw || row.label.toLowerCase() === reason.trim().toLowerCase()
  );
  return match?.code ?? 'other';
}
