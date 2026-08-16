import { AppState } from 'react-native';
import type { Socket } from 'socket.io-client';

import { connectGatewaySocket } from '@/lib/gateway/connect';
import type { KitchenInboundEvent } from '@/lib/gateway/kitchen-events';

const INBOUND: KitchenInboundEvent[] = [
  'kitchen:order-new',
  'kitchen:order-status',
  'kitchen:order-cancelled',
  'kitchen:rider-assigned',
  'kitchen:rider-arrived',
  'kitchen:scheduled-due',
  'order:status',
  'order:items-removed',
  'delivery:status',
  'payment:cod-paid',
  'notification:new',
  'chat:new-message',
  'typing',
];

export type KitchenChatMessage = {
  id: string;
  orderId: string;
  text: string;
  fromRole?: string;
  to?: string;
  createdAt: string;
};

type KitchenListener = (event: KitchenInboundEvent, payload: unknown) => void;

let socket: Socket | null = null;
let joinedRestaurantId: string | null = null;
let wantedRestaurantId: string | null = null;
let startGeneration = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const trackedOrders = new Set<string>();
const listeners = new Set<KitchenListener>();
const chatByOrder = new Map<string, KitchenChatMessage[]>();
const typingByOrder = new Map<string, boolean>();
let appSub: { remove: () => void } | null = null;

function clearTimers() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function emitLocal(event: KitchenInboundEvent, payload: unknown) {
  for (const listener of listeners) {
    listener(event, payload);
  }
}

function mapChat(payload: unknown): KitchenChatMessage | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const orderId = String(record.orderId ?? record.order_id ?? '').trim();
  const text = String(record.text ?? record.message ?? '').trim();
  if (!orderId || !text) return null;
  const id = String(record.id ?? record._id ?? `${orderId}-${record.createdAt ?? Date.now()}`);
  return {
    id,
    orderId,
    text,
    fromRole: typeof record.senderRole === 'string' ? record.senderRole : undefined,
    to: typeof record.to === 'string' ? record.to : undefined,
    createdAt:
      typeof record.createdAt === 'string'
        ? record.createdAt
        : new Date().toISOString(),
  };
}

function rejoinRooms() {
  if (!socket?.connected) return;
  if (joinedRestaurantId) {
    socket.emit('join:restaurant', joinedRestaurantId);
  }
  for (const orderId of trackedOrders) {
    socket.emit('track:order', orderId);
  }
}

function bindSocket(next: Socket) {
  next.on('connect', () => {
    joinedRestaurantId = wantedRestaurantId;
    rejoinRooms();
  });

  for (const event of INBOUND) {
    next.on(event, (payload: unknown) => {
      if (event === 'chat:new-message') {
        const mapped = mapChat(payload);
        if (mapped) {
          const list = chatByOrder.get(mapped.orderId) ?? [];
          if (!list.some((row) => row.id === mapped.id)) {
            chatByOrder.set(mapped.orderId, [...list, mapped]);
          }
        }
      }
      if (event === 'typing') {
        const record =
          payload && typeof payload === 'object'
            ? (payload as Record<string, unknown>)
            : {};
        const orderId = String(record.orderId ?? '').trim();
        if (orderId) {
          const fromKitchen = record.senderRole === 'restaurant';
          typingByOrder.set(orderId, !fromKitchen && record.isTyping === true);
        }
      }
      emitLocal(event, payload);
    });
  }

  next.on('connect_error', (err: { message?: string }) => {
    const unauthorized = String(err?.message ?? '')
      .toUpperCase()
      .includes('UNAUTHORIZED');
    if (!unauthorized || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void restart();
    }, 2500);
  });
}

async function start(generation: number) {
  if (!wantedRestaurantId) return;
  try {
    const connected = await connectGatewaySocket();
    if (generation !== startGeneration || !wantedRestaurantId) {
      connected.socket.disconnect();
      return;
    }
    socket = connected.socket;
    bindSocket(socket);
    joinedRestaurantId = wantedRestaurantId;
    rejoinRooms();

    const refreshMs = Math.max(30_000, (connected.expiresIn - 120) * 1000);
    refreshTimer = setTimeout(() => {
      void restart();
    }, refreshMs);
  } catch {
    if (generation !== startGeneration || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void start(startGeneration);
    }, 5000);
  }
}

function stopSocket() {
  clearTimers();
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  joinedRestaurantId = null;
}

async function restart() {
  stopSocket();
  const generation = ++startGeneration;
  await start(generation);
}

function ensureAppFocus() {
  if (appSub) return;
  appSub = AppState.addEventListener('change', (state) => {
    if (state !== 'active' || !wantedRestaurantId) return;
    if (socket?.connected) {
      rejoinRooms();
      return;
    }
    void restart();
  });
}

export function subscribeKitchenEvents(listener: KitchenListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startKitchenGateway(restaurantId: string | undefined, enabled: boolean) {
  ensureAppFocus();
  const next = enabled ? restaurantId?.trim() || null : null;
  if (wantedRestaurantId === next && (socket || !next)) return;
  wantedRestaurantId = next;
  if (!next) {
    stopSocket();
    return;
  }
  void restart();
}

export function trackKitchenOrder(orderId: string | undefined) {
  const id = orderId?.trim();
  if (!id) return;
  trackedOrders.add(id);
  if (socket?.connected) socket.emit('track:order', id);
}

export function untrackKitchenOrder(orderId: string | undefined) {
  const id = orderId?.trim();
  if (!id) return;
  trackedOrders.delete(id);
}

export function getKitchenChat(orderId: string): KitchenChatMessage[] {
  return chatByOrder.get(orderId) ?? [];
}

export function isKitchenPeerTyping(orderId: string): boolean {
  return typingByOrder.get(orderId) === true;
}

export function sendKitchenChat(
  orderId: string,
  text: string,
  to: 'customer' | 'partner' = 'customer'
) {
  const trimmed = text.trim();
  if (!trimmed || !socket?.connected) {
    return Promise.reject(
      new Error('Chat is not connected. Try again in a moment.')
    );
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Chat timed out. Check your connection.'));
    }, 8000);

    socket?.emit(
      'chat:new-message',
      { orderId, text: trimmed, to },
      (ack?: {
        ok?: boolean;
        message?: string;
        code?: string;
        data?: Record<string, unknown>;
      }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ack && ack.ok === false) {
          reject(new Error(kitchenChatError(ack.code, ack.message)));
          return;
        }
        const mapped = mapChat({
          ...(ack?.data ?? {}),
          orderId,
          text: trimmed,
          to,
          senderRole: 'restaurant',
        });
        if (mapped) {
          const list = chatByOrder.get(mapped.orderId) ?? [];
          if (!list.some((row) => row.id === mapped.id)) {
            chatByOrder.set(mapped.orderId, [...list, mapped]);
          }
          emitLocal('chat:new-message', mapped);
        }
        resolve();
      }
    );
  });
}

function kitchenChatError(code?: string, message?: string) {
  if (code === 'CHAT_RATE_LIMITED') {
    return 'Too many messages. Wait a moment and try again.';
  }
  if (code === 'CHAT_CLOSED') {
    return 'Chat is closed for this trip.';
  }
  if (code === 'DELIVERY_NOT_FOUND') {
    return 'Chat opens after a rider is assigned.';
  }
  if (code === 'FORBIDDEN') {
    return 'You cannot chat on this order.';
  }
  return message || code || 'Chat failed';
}

export function sendKitchenTyping(orderId: string, isTyping: boolean) {
  if (!socket?.connected) return;
  socket.emit('typing', { orderId, isTyping, to: 'customer' });
}

export function isKitchenSocketConnected() {
  return Boolean(socket?.connected);
}
