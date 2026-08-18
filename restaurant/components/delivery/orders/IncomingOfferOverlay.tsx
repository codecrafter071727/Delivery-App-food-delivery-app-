import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts } from '@/constants/typography';
import {
  useDeliveryBatch,
  useDeliveryOrderMutations,
} from '@/lib/delivery-partner/hooks';
import {
  clearIncomingOffer,
  getIncomingOffer,
  subscribeIncomingOffer,
  type IncomingOffer,
} from '@/lib/delivery-partner/offer-store';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import {
  REJECT_REASON_CODES,
  toRejectReasonCode,
} from '@/lib/delivery-partner/rider-gateway-types';
import { useResolvedTripStops } from '@/lib/delivery-partner/trip-stops';
import type { PartnerDelivery } from '@/lib/delivery-partner/types';
import { getApiErrorCode } from '@/lib/errors';

const OFFER_GONE_CODES = new Set([
  'OFFER_EXPIRED',
  'OFFER_TAKEN',
  'BATCH_EXPIRED',
  'BATCH_NOT_FOUND',
  'BATCH_INCOMPLETE',
]);

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

function shouldClearOffer(error: unknown) {
  const code = getApiErrorCode(error);
  if (code && OFFER_GONE_CODES.has(code)) return true;
  const message = formatTripError(error, '').toLowerCase();
  return (
    message.includes('timed out') ||
    message.includes('another rider') ||
    message.includes('no longer')
  );
}

/**
 * Full-screen incoming offer — Swiggy/Zomato rider style.
 * Accept / reject go through socket-first mutations (REST fallback).
 * Stacked offers use PUT /deliveries/batch/:batchId/accept.
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

  const batchQuery = useDeliveryBatch(offer?.batchId, {
    enabled: Boolean(offer?.batchId),
    live: true,
  });
  const batch = batchQuery.data;
  const stacked =
    Boolean(offer?.batchId) &&
    ((batch?.deliveries.length ?? 0) > 1 ||
      offer?.nextAction === 'accept_batch');
  const stackCount = Math.max(
    batch?.deliveries.length ?? 0,
    batch?.deliveryIds.length ?? 0,
    stacked ? 2 : 1
  );
  const stackFee =
    batch?.deliveries.reduce(
      (sum, row) => sum + (row.partnerEarnings ?? row.deliveryFee ?? 0),
      0
    ) || offer?.deliveryFee;

  const progress = useMemo(() => {
    if (!offer) return 0;
    const total = Math.max(1, offer.timeoutSeconds);
    return Math.min(1, seconds / total);
  }, [offer, seconds]);

  const offerAsDelivery = useMemo<PartnerDelivery>(
    () =>
      offer
        ? {
            id: offer.deliveryId,
            orderId: offer.orderId,
            restaurantId: offer.restaurantId,
            status: 'assigned',
            restaurantName: offer.restaurantName,
            restaurantAddress: {
              lat: offer.restaurantLat,
              lng: offer.restaurantLng,
              line1: offer.pickupLabel,
            },
            deliveryAddress: {
              lat: offer.dropLat,
              lng: offer.dropLng,
              line1: offer.dropLabel,
            },
            distanceKm: offer.estimatedKm,
            earning: offer.deliveryFee,
          }
        : { id: '', status: 'assigned' },
    [offer]
  );
  const stops = useResolvedTripStops(offerAsDelivery);

  if (!offer) return null;

  const fee = money(stackFee ?? offer.deliveryFee);
  const urgent = seconds <= 10;
  const pickup =
    offer.restaurantLat != null &&
    offer.restaurantLng != null &&
    Number.isFinite(offer.restaurantLat) &&
    Number.isFinite(offer.restaurantLng)
      ? { latitude: offer.restaurantLat, longitude: offer.restaurantLng }
      : null;
  const drop =
    offer.dropLat != null &&
    offer.dropLng != null &&
    Number.isFinite(offer.dropLat) &&
    Number.isFinite(offer.dropLng)
      ? { latitude: offer.dropLat, longitude: offer.dropLng }
      : null;
  const mapCenter = pickup ?? drop;
  const showMap = Platform.OS !== 'web' && Boolean(mapCenter);

  const accept = async () => {
    setBusy('accept');
    try {
      if (offer.batchId && (batch?.canAccept || stacked)) {
        await mutations.acceptBatch.mutateAsync(offer.batchId);
      } else {
        await mutations.accept.mutateAsync(offer.deliveryId);
      }
      clearIncomingOffer(offer.deliveryId);
    } catch (error) {
      Alert.alert(
        'Could not accept',
        formatTripError(error, 'This order is no longer available.')
      );
      if (shouldClearOffer(error)) clearIncomingOffer(offer.deliveryId);
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
        formatTripError(error, 'Please try again.')
      );
      if (shouldClearOffer(error)) clearIncomingOffer(offer.deliveryId);
    } finally {
      setBusy(null);
      setDeclining(false);
    }
  };

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent>
      <View style={styles.screen}>
        {showMap && mapCenter ? (
          <MapView
            style={StyleSheet.absoluteFill}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={{
              ...mapCenter,
              latitudeDelta: 0.04,
              longitudeDelta: 0.04,
            }}
            pointerEvents="none"
            toolbarEnabled={false}
          >
            {pickup ? (
              <Marker
                coordinate={pickup}
                title="Pickup"
                description={offer.restaurantName || offer.pickupLabel}
                pinColor="#EA4B14"
              />
            ) : null}
            {drop ? (
              <Marker
                coordinate={drop}
                title="Drop"
                description={offer.dropLabel}
                pinColor="#2563EB"
              />
            ) : null}
          </MapView>
        ) : (
          <View style={styles.fallbackBg} />
        )}
        <View style={styles.scrim} />
        <View style={[styles.card, { marginBottom: Math.max(insets.bottom, 12) }]}>
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

          <Text style={styles.kicker}>
            {stacked ? 'Stacked delivery request' : 'New delivery request'}
          </Text>
          <Text style={styles.payout}>{fee ?? 'New order'}</Text>
          <Text style={styles.meta}>
            {[
              stacked ? `${stackCount} orders` : null,
              offer.estimatedKm != null
                ? `${offer.estimatedKm.toFixed(1)} km`
                : batch?.estimatedDistanceKm != null
                  ? `${batch.estimatedDistanceKm.toFixed(1)} km`
                  : null,
              offer.broadcast ? 'Broadcast' : 'Assigned to you',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          {offer.batchId && batchQuery.isLoading && !batch ? (
            <View style={styles.batchLoading}>
              <ActivityIndicator color="#EA4B14" />
              <Text style={styles.batchLoadingText}>Loading stacked stops…</Text>
            </View>
          ) : null}

          {offer.batchId && batchQuery.isError && !batch ? (
            <Pressable
              onPress={() => void batchQuery.refetch()}
              style={styles.batchError}
            >
              <Text style={styles.batchErrorText}>
                {formatTripError(
                  batchQuery.error,
                  'Could not load stacked orders. Retry'
                )}
              </Text>
            </Pressable>
          ) : null}

          <ScrollView
            style={styles.stops}
            showsVerticalScrollIndicator={false}
          >
            {batch?.sequence.length ? (
              batch.sequence.map((stop) => (
                <View
                  key={`${stop.seq}-${stop.deliveryId}-${stop.leg}`}
                  style={styles.pinBlock}
                >
                  <View
                    style={
                      stop.leg === 'drop'
                        ? styles.pinDotDrop
                        : styles.pinDotPickup
                    }
                  />
                  <View style={styles.pinCopy}>
                    <Text style={styles.pinLabel}>
                      {stop.seq}. {stop.label || (stop.leg === 'drop' ? 'Drop' : 'Pickup')}
                    </Text>
                    <Text style={styles.pinValue} numberOfLines={2}>
                      {stop.address ||
                        (stop.leg === 'drop'
                          ? 'Customer location'
                          : 'Restaurant')}
                    </Text>
                  </View>
                </View>
              ))
            ) : batch?.deliveries.length ? (
              batch.deliveries.map((row, index) => (
                <View key={row.deliveryId} style={styles.pinBlock}>
                  <View style={styles.pinDotPickup} />
                  <View style={styles.pinCopy}>
                    <Text style={styles.pinLabel}>Order {index + 1}</Text>
                    <Text style={styles.pinValue} numberOfLines={2}>
                      {row.restaurantName ||
                        row.deliveryAddress ||
                        `#${row.orderId?.slice(-6) || row.deliveryId.slice(-6)}`}
                    </Text>
                  </View>
                </View>
              ))
            ) : (
              <>
                <View style={styles.pinBlock}>
                  <View style={styles.pinDotPickup} />
                  <View style={styles.pinCopy}>
                    <Text style={styles.pinLabel}>Pickup</Text>
                    <Text style={styles.pinValue} numberOfLines={2}>
                      {stops.restaurantName}
                    </Text>
                    {stops.pickupAddress ? (
                      <Text style={styles.pinAddr} numberOfLines={2}>
                        {stops.pickupAddress}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.pinBlock}>
                  <View style={styles.pinDotDrop} />
                  <View style={styles.pinCopy}>
                    <Text style={styles.pinLabel}>Drop</Text>
                    {stops.dropKmLabel ? (
                      <Text style={styles.pinKm}>{stops.dropKmLabel}</Text>
                    ) : null}
                    <Text style={styles.pinValue} numberOfLines={2}>
                      {stops.dropAddress ||
                        offer.dropLabel ||
                        'Customer location'}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </ScrollView>

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
                  <Text style={styles.acceptText}>
                    {stacked ? `Accept all (${stackCount})` : 'Accept'}
                  </Text>
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
  screen: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
  },
  fallbackBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F172A',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.28)',
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
  pinAddr: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  pinKm: {
    marginTop: 2,
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#C2410C',
  },
  stops: {
    maxHeight: 220,
  },
  batchLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  batchLoadingText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  batchError: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  batchErrorText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#B91C1C',
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
