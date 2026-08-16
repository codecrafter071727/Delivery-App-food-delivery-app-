import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts } from '@/constants/typography';
import { useDeliveryOrderMutations } from '@/lib/delivery-partner/hooks';
import {
  clearIncomingOffer,
  getIncomingOffer,
  subscribeIncomingOffer,
  type IncomingOffer,
} from '@/lib/delivery-partner/offer-store';
import {
  REJECT_REASON_CODES,
  toRejectReasonCode,
} from '@/lib/delivery-partner/rider-gateway-types';
import { getApiErrorMessage } from '@/lib/errors';

function money(amount?: number) {
  if (amount == null || !Number.isFinite(amount)) return null;
  return `₹${Math.round(amount)}`;
}

function remainingSeconds(offer: IncomingOffer) {
  if (offer.secondsLeft != null && Number.isFinite(offer.secondsLeft)) {
    return Math.max(0, Math.ceil(offer.secondsLeft));
  }
  if (offer.expiresAt) {
    const ms = Date.parse(offer.expiresAt) - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, Math.ceil(ms / 1000));
  }
  const elapsed = (Date.now() - offer.receivedAt) / 1000;
  return Math.max(0, Math.ceil(offer.timeoutSeconds - elapsed));
}

/**
 * Full-screen incoming offer — Swiggy/Zomato rider style.
 * Accept / reject go through socket-first mutations (REST fallback).
 */
export function IncomingOfferOverlay() {
  const insets = useSafeAreaInsets();
  const mutations = useDeliveryOrderMutations();
  const [offer, setOffer] = useState<IncomingOffer | null>(getIncomingOffer);
  const [seconds, setSeconds] = useState(0);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  useEffect(() => subscribeIncomingOffer(setOffer), []);

  useEffect(() => {
    if (!offer) {
      setDeclining(false);
      setBusy(null);
      return;
    }
    const tick = () => {
      const left = remainingSeconds(offer);
      setSeconds(left);
      if (left <= 0) clearIncomingOffer(offer.deliveryId);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [offer]);

  const progress = useMemo(() => {
    if (!offer) return 0;
    const total = Math.max(1, offer.timeoutSeconds);
    return Math.min(1, seconds / total);
  }, [offer, seconds]);

  if (!offer) return null;

  const fee = money(offer.deliveryFee);
  const urgent = seconds <= 10;

  const accept = async () => {
    setBusy('accept');
    try {
      await mutations.accept.mutateAsync(offer.deliveryId);
      clearIncomingOffer(offer.deliveryId);
    } catch (error) {
      Alert.alert(
        'Could not accept',
        getApiErrorMessage(error, 'This order is no longer available.')
      );
      const message = getApiErrorMessage(error, '').toLowerCase();
      if (
        message.includes('timed out') ||
        message.includes('another rider') ||
        message.includes('no longer')
      ) {
        clearIncomingOffer(offer.deliveryId);
      }
    } finally {
      setBusy(null);
    }
  };

  const reject = async (label: string) => {
    setBusy('reject');
    try {
      await mutations.reject.mutateAsync({
        deliveryId: offer.deliveryId,
        reason: label,
        reasonCode: toRejectReasonCode(label),
      });
      clearIncomingOffer(offer.deliveryId);
    } catch (error) {
      Alert.alert(
        'Could not decline',
        getApiErrorMessage(error, 'Please try again.')
      );
    } finally {
      setBusy(null);
      setDeclining(false);
    }
  };

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 12 }]}>
        <View style={styles.card}>
          <View style={styles.timerRow}>
            <View style={styles.timerTrack}>
              <View
                style={[
                  styles.timerFill,
                  {
                    width: `${Math.round(progress * 100)}%`,
                    backgroundColor: urgent ? '#EF4444' : '#22C55E',
                  },
                ]}
              />
            </View>
            <Text style={[styles.timerText, urgent && styles.timerUrgent]}>
              {seconds}s
            </Text>
          </View>

          <Text style={styles.kicker}>New delivery request</Text>
          <Text style={styles.payout}>{fee ?? 'New order'}</Text>
          <Text style={styles.meta}>
            {[
              offer.estimatedKm != null
                ? `${offer.estimatedKm.toFixed(1)} km`
                : null,
              offer.broadcast ? 'Broadcast' : 'Assigned to you',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          <View style={styles.pinBlock}>
            <View style={styles.pinDotPickup} />
            <View style={styles.pinCopy}>
              <Text style={styles.pinLabel}>Pickup</Text>
              <Text style={styles.pinValue} numberOfLines={2}>
                {offer.restaurantName ||
                  offer.pickupLabel ||
                  'Restaurant'}
              </Text>
            </View>
          </View>
          <View style={styles.pinBlock}>
            <View style={styles.pinDotDrop} />
            <View style={styles.pinCopy}>
              <Text style={styles.pinLabel}>Drop</Text>
              <Text style={styles.pinValue} numberOfLines={2}>
                {offer.dropLabel || 'Customer location'}
              </Text>
            </View>
          </View>

          {declining ? (
            <View style={styles.reasons}>
              <Text style={styles.reasonTitle}>Why are you declining?</Text>
              {REJECT_REASON_CODES.map((row) => (
                <Pressable
                  key={row.code}
                  onPress={() => void reject(row.label)}
                  disabled={busy != null}
                  style={styles.reasonChip}
                >
                  <Text style={styles.reasonChipText}>{row.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={() => setDeclining(false)} style={styles.backBtn}>
                <Text style={styles.backText}>Back</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable
                onPress={() => setDeclining(true)}
                disabled={busy != null}
                style={styles.declineBtn}
              >
                <Text style={styles.declineText}>Decline</Text>
              </Pressable>
              <Pressable
                onPress={() => void accept()}
                disabled={busy != null}
                style={styles.acceptBtn}
              >
                {busy === 'accept' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.acceptText}>Accept</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 22,
    marginBottom: 12,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 18,
  },
  timerTrack: {
    flex: 1,
    height: 6,
    borderRadius: 99,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  timerFill: {
    height: 6,
    borderRadius: 99,
  },
  timerText: {
    fontFamily: fonts.extraBold,
    fontSize: 14,
    color: '#111827',
    width: 36,
    textAlign: 'right',
  },
  timerUrgent: {
    color: '#EF4444',
  },
  kicker: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  payout: {
    marginTop: 6,
    fontFamily: fonts.extraBold,
    fontSize: 34,
    color: '#111827',
    letterSpacing: -0.8,
  },
  meta: {
    marginTop: 4,
    marginBottom: 18,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#4B5563',
  },
  pinBlock: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  pinDotPickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EA4B14',
    marginTop: 5,
  },
  pinDotDrop: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563EB',
    marginTop: 5,
  },
  pinCopy: {
    flex: 1,
  },
  pinLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
  },
  pinValue: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  declineBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#111827',
  },
  acceptBtn: {
    flex: 1.4,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: {
    fontFamily: fonts.extraBold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  reasons: {
    marginTop: 14,
    gap: 8,
  },
  reasonTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#111827',
    marginBottom: 4,
  },
  reasonChip: {
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  reasonChipText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#111827',
  },
  backBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#6B7280',
  },
});
