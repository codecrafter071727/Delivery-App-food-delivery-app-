import { useEffect, useRef, useState } from 'react';

import {
  applyKitchenSocketEvent,
  type KitchenInboundEvent,
} from '@/lib/gateway/kitchen-events';
import {
  getKitchenChat,
  isKitchenPeerTyping,
  sendKitchenChat,
  sendKitchenTyping,
  startKitchenGateway,
  subscribeKitchenEvents,
  trackKitchenOrder,
  untrackKitchenOrder,
  type KitchenChatMessage,
} from '@/lib/gateway/kitchen-client';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Owns the kitchen Socket.IO connection for an outlet:
 * emit `join:restaurant`, apply live events to the KDS cache.
 */
export function useKitchenGatewaySocket(
  restaurantId: string | undefined,
  enabled: boolean
) {
  const queryClient = useQueryClient();
  const restaurantRef = useRef(restaurantId);
  restaurantRef.current = restaurantId;

  useEffect(() => {
    startKitchenGateway(restaurantId, enabled);
    return () => {
      if (!enabled) startKitchenGateway(undefined, false);
    };
  }, [enabled, restaurantId]);

  useEffect(() => {
    if (!enabled || !restaurantId) return;
    return subscribeKitchenEvents((event, payload) => {
      const outletId = restaurantRef.current;
      if (!outletId) return;
      applyKitchenSocketEvent(queryClient, outletId, event, payload);
    });
  }, [enabled, restaurantId, queryClient]);
}

/**
 * Optional `track:order` for a ticket (order room: items-removed, COD, chat).
 */
export function useKitchenOrderRoom(orderId: string | undefined, enabled: boolean) {
  useEffect(() => {
    const id = orderId?.trim();
    if (!enabled || !id) return;
    trackKitchenOrder(id);
    return () => untrackKitchenOrder(id);
  }, [enabled, orderId]);
}

export function useKitchenOrderChat(orderId: string | undefined, enabled: boolean) {
  const [messages, setMessages] = useState<KitchenChatMessage[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);

  useKitchenOrderRoom(orderId, enabled);

  useEffect(() => {
    const id = orderId?.trim();
    if (!enabled || !id) return;

    const sync = () => {
      setMessages(getKitchenChat(id));
      setPeerTyping(isKitchenPeerTyping(id));
    };
    sync();

    return subscribeKitchenEvents((event: KitchenInboundEvent, payload) => {
      if (event !== 'chat:new-message' && event !== 'typing') return;
      const record =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {};
      if (String(record.orderId ?? '') !== id) return;
      sync();
    });
  }, [enabled, orderId]);

  return {
    messages,
    peerTyping,
    send: (text: string, to: 'customer' | 'partner' = 'customer') =>
      sendKitchenChat(orderId!.trim(), text, to),
    setTyping: (isTyping: boolean) => {
      const id = orderId?.trim();
      if (!id) return;
      sendKitchenTyping(id, isTyping);
    },
  };
}
