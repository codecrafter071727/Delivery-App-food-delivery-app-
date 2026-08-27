import type { QueryClient } from '@tanstack/react-query';

import {
  appendRiderChat,
  mapRiderChatMessage,
  setRiderPeerTyping,
} from '@/lib/delivery-partner/chat-store';
import { partnerAnalyticsKeys } from '@/lib/delivery-partner/analytics-hooks';
import { partnerAvailabilityKeys } from '@/lib/delivery-partner/availability-hooks';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { pushLiveToast } from '@/lib/delivery-partner/live-toast-store';
import {
  alertNewOffer,
  alertOfferExpiring,
  clearIncomingOffer,
  isOfferDeclined,
  parseIncomingOffer,
  patchIncomingOffer,
  setIncomingOffer,
} from '@/lib/delivery-partner/offer-store';
import { resolveOfferEarnings, formatInr } from '@/lib/delivery-partner/offer-earnings';
import type { RiderGatewayEvent } from '@/lib/delivery-partner/rider-gateway-types';
import { partnerTrackingKeys } from '@/lib/delivery-partner/tracking-hooks';
import { presentDeviceNotification, RIDER_OFFER_CHANNEL_ID } from '@/lib/notification/device-alerts';
import { notificationKeys } from '@/lib/notification/hooks';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function invalidate(queryClient: QueryClient, queryKey: readonly unknown[]) {
  void queryClient.invalidateQueries({ queryKey, refetchType: 'active' });
}

function cancelCopy(reason?: string) {
  const code = (reason ?? '').toUpperCase();
  if (code === 'OFFER_TIMEOUT') return 'Order timed out';
  if (code === 'OFFER_TAKEN') return 'Another rider accepted this order';
  return reason?.trim() || 'Assignment cancelled';
}

function offerNotificationBody(
  offer: NonNullable<ReturnType<typeof parseIncomingOffer>>,
  earnings: ReturnType<typeof resolveOfferEarnings>
) {
  const parts: string[] = [];
  if (earnings) {
    if (earnings.showIncentive && earnings.incentive > 0) {
      parts.push(
        `${formatInr(earnings.basePay)} + ${formatInr(earnings.incentive)} incentive = ${formatInr(earnings.netTotal)}`
      );
    } else {
      parts.push(`Earn ${formatInr(earnings.netTotal)}`);
    }
  }
  const pickup =
    offer.pickupDistanceKm != null && Number.isFinite(offer.pickupDistanceKm)
      ? `${offer.pickupDistanceKm.toFixed(1)} km to store`
      : null;
  const drop =
    offer.dropDistanceKm != null && Number.isFinite(offer.dropDistanceKm)
      ? `${offer.dropDistanceKm.toFixed(1)} km drop`
      : offer.estimatedKm != null && Number.isFinite(offer.estimatedKm)
        ? `${offer.estimatedKm.toFixed(1)} km`
        : null;
  if (pickup) parts.push(pickup);
  else if (drop) parts.push(drop);
  if (offer.restaurantName) parts.push(offer.restaurantName);
  return parts.join(' · ') || 'A nearby order is waiting — open to accept.';
}

/**
 * Apply rider Socket.IO events to UI stores + TanStack Query.
 * REST poll remains the fallback if the socket drops.
 */
export function applyRiderSocketEvent(
  queryClient: QueryClient,
  event: RiderGatewayEvent,
  payload: unknown
) {
  const record = asRecord(payload);

  switch (event) {
    case 'delivery:new': {
      const offer = parseIncomingOffer(payload);
      if (offer && !isOfferDeclined(offer.deliveryId, offer.orderId)) {
        setIncomingOffer(offer);
        alertNewOffer();
        const earnings = resolveOfferEarnings(offer);
        void presentDeviceNotification(
          {
            id: `offer-${offer.deliveryId}`,
            title: earnings?.showIncentive
              ? `New order · ${formatInr(earnings.netTotal)} (incl. incentive)`
              : 'New delivery request',
            body: offerNotificationBody(offer, earnings),
            type: 'delivery',
            isRead: false,
            data: {
              deliveryId: offer.deliveryId,
              orderId: offer.orderId,
              kind: 'rider_new_offer',
              screen: 'delivery',
            },
          },
          { channelId: RIDER_OFFER_CHANNEL_ID }
        );
      }
      invalidate(queryClient, deliveryPartnerKeys.active());
      invalidate(queryClient, deliveryPartnerKeys.all);
      break;
    }
    case 'delivery:assignment-expiring': {
      const deliveryId = pickString(record, ['deliveryId', 'id']);
      if (deliveryId) {
        patchIncomingOffer(deliveryId, {
          secondsLeft: pickNumber(record, ['secondsLeft']),
          expiresAt: pickString(record, ['expiresAt']),
          expiring: true,
        });
        alertOfferExpiring();
      }
      break;
    }
    case 'delivery:cancelled': {
      const deliveryId = pickString(record, ['deliveryId', 'id']);
      const reason = pickString(record, ['reason', 'code']);
      const message = pickString(record, ['message']);
      clearIncomingOffer(deliveryId);
      const taken = (reason ?? '').toUpperCase() === 'OFFER_TAKEN';
      pushLiveToast({
        title: taken ? 'Accepted by another rider' : 'Order released',
        body: message || cancelCopy(reason),
        tone: 'warn',
      });
      invalidate(queryClient, deliveryPartnerKeys.active());
      invalidate(queryClient, deliveryPartnerKeys.all);
      invalidate(queryClient, partnerAvailabilityKeys.status());
      break;
    }
    case 'delivery:assigned': {
      const deliveryId = pickString(record, ['deliveryId', 'id']);
      clearIncomingOffer(deliveryId);
      invalidate(queryClient, deliveryPartnerKeys.active());
      invalidate(queryClient, deliveryPartnerKeys.all);
      invalidate(queryClient, partnerAvailabilityKeys.status());
      invalidate(queryClient, partnerTrackingKeys.all);
      break;
    }
    case 'delivery:updated':
    case 'delivery:status':
      invalidate(queryClient, deliveryPartnerKeys.active());
      invalidate(queryClient, deliveryPartnerKeys.all);
      invalidate(queryClient, partnerAvailabilityKeys.status());
      invalidate(queryClient, partnerTrackingKeys.all);
      break;
    case 'notification:new': {
      const title = pickString(record, ['title']) ?? 'TOKAJO';
      const body =
        pickString(record, ['message', 'body']) ?? 'You have a new update';
      const data = asRecord(record.data);
      const kind = (pickString(data, ['kind']) ?? '').toLowerCase();
      const isKyc = kind.includes('kyc');
      pushLiveToast({
        title,
        body,
        tone: kind.includes('reject') ? 'warn' : 'info',
      });
      const notificationId = pickString(record, ['notificationId', 'id']);
      void presentDeviceNotification({
        id: notificationId ?? `live-${Date.now()}`,
        title,
        body,
        type: pickString(record, ['type']) ?? 'system',
        isRead: false,
        data,
      });
      queryClient.setQueryData(
        notificationKeys.unreadCount(),
        (current: { count?: number } | undefined) => ({
          count: Math.max(0, (current?.count ?? 0) + 1),
        })
      );
      invalidate(queryClient, notificationKeys.all);
      if (isKyc) {
        invalidate(queryClient, deliveryPartnerKeys.me());
        invalidate(queryClient, deliveryPartnerKeys.all);
      }
      break;
    }
    case 'earnings:updated':
    case 'wallet:credited': {
      const amount = pickNumber(record, ['delta', 'amount']);
      const source = (pickString(record, ['source']) ?? '').toLowerCase();
      const rto = source === 'rto';
      pushLiveToast({
        title: rto
          ? 'RTO fee credited'
          : event === 'wallet:credited'
            ? 'Wallet credited'
            : 'Earnings updated',
        body:
          amount != null
            ? rto
              ? `₹${Math.round(amount)} return fee added to your wallet`
              : `₹${Math.round(amount)} added to today's earnings`
            : 'Your IST ledger just updated',
        tone: 'success',
      });
      invalidate(queryClient, partnerAnalyticsKeys.all);
      invalidate(queryClient, [...deliveryPartnerKeys.all, 'finance']);
      break;
    }
    case 'chat:new-message': {
      const mapped = mapRiderChatMessage(payload);
      if (mapped) appendRiderChat(mapped);
      break;
    }
    case 'typing': {
      const deliveryId = pickString(record, ['deliveryId', 'id']);
      if (deliveryId) {
        setRiderPeerTyping(
          deliveryId,
          record.isTyping === true,
          pickString(record, ['senderRole', 'fromRole'])
        );
      }
      break;
    }
    default:
      break;
  }
}
