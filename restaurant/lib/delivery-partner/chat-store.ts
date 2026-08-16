export type RiderChatMessage = {
  id: string;
  deliveryId: string;
  orderId?: string;
  text: string;
  fromRole?: string;
  to?: string;
  createdAt: string;
};

type ChatListener = (deliveryId: string) => void;

const messagesByDelivery = new Map<string, RiderChatMessage[]>();
const typingByDelivery = new Map<string, { role?: string; until: number }>();
const listeners = new Set<ChatListener>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function notify(deliveryId: string) {
  for (const listener of listeners) listener(deliveryId);
}

export function subscribeRiderChat(listener: ChatListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function mapRiderChatMessage(payload: unknown): RiderChatMessage | null {
  const record = asRecord(payload);
  const nested = asRecord(record.data ?? record);
  const source = Object.keys(nested).length ? nested : record;
  const deliveryId =
    String(source.deliveryId ?? source.delivery_id ?? '').trim();
  const text = String(source.text ?? source.message ?? '').trim();
  if (!deliveryId || !text) return null;
  return {
    id: String(
      source.id ??
        source._id ??
        `${deliveryId}-${source.createdAt ?? Date.now()}`
    ),
    deliveryId,
    orderId: typeof source.orderId === 'string' ? source.orderId : undefined,
    text,
    fromRole:
      typeof source.senderRole === 'string'
        ? source.senderRole
        : typeof source.fromRole === 'string'
          ? source.fromRole
          : undefined,
    to: typeof source.to === 'string' ? source.to : undefined,
    createdAt:
      typeof source.createdAt === 'string'
        ? source.createdAt
        : new Date().toISOString(),
  };
}

export function appendRiderChat(message: RiderChatMessage) {
  const list = messagesByDelivery.get(message.deliveryId) ?? [];
  if (list.some((row) => row.id === message.id)) return;
  messagesByDelivery.set(message.deliveryId, [...list, message]);
  notify(message.deliveryId);
}

export function getRiderChat(deliveryId: string): RiderChatMessage[] {
  return messagesByDelivery.get(deliveryId) ?? [];
}

export function setRiderPeerTyping(
  deliveryId: string,
  isTyping: boolean,
  role?: string
) {
  if (!isTyping) {
    typingByDelivery.delete(deliveryId);
  } else {
    typingByDelivery.set(deliveryId, {
      role,
      until: Date.now() + 2500,
    });
  }
  notify(deliveryId);
}

export function isRiderPeerTyping(deliveryId: string): boolean {
  const row = typingByDelivery.get(deliveryId);
  if (!row) return false;
  if (row.until < Date.now()) {
    typingByDelivery.delete(deliveryId);
    return false;
  }
  return row.role !== 'partner';
}
