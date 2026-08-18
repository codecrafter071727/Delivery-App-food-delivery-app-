import {
  ChevronDown,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  Store,
  User,
  Wallet,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeliveryTripMap } from '@/components/delivery/orders/DeliveryTripMap';
import { TripChatSheet } from '@/components/delivery/orders/TripChatSheet';
import { TripDetailSheet } from '@/components/delivery/orders/TripDetailSheet';
import {
  TripLifecycleBar,
  tripGeofenceState,
} from '@/components/delivery/orders/TripLifecycleBar';
import { fonts } from '@/constants/typography';
import {
  deliveryPartnerApi,
  isAssignableStatus,
  normalizeDeliveryStatus,
  resolveTripStep,
  tripOrderCode,
} from '@/lib/delivery-partner/api';
import { isCodPayment } from '@/lib/delivery-partner/finance-types';
import { useResolvedTripStops } from '@/lib/delivery-partner/trip-stops';
import {
  useActiveDeliveries,
  useActiveDelivery,
  useDeliveryDetail,
  useDeliveryOrderMutations,
  useTripNavRoute,
} from '@/lib/delivery-partner/hooks';
import { formatLocationError } from '@/lib/delivery-partner/tracking-api';
import { announceOrderReturned } from '@/lib/delivery-partner/rider-ack';
import {
  useLiveLocation,
  useLocationHistory,
  useOrderTracking,
  useTrackingEta,
  useTrackingRoute,
  useTrackingStatus,
} from '@/lib/delivery-partner/tracking-hooks';
import type { OrderTracking } from '@/lib/delivery-partner/tracking-types';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import type { PartnerDelivery } from '@/lib/delivery-partner/types';

const LIVE = new Set([
  'accepted',
  'arrived',
  'picked_up',
  'out_for_delivery',
  'at_customer',
  'returning_to_restaurant',
]);

function money(amount?: number, currency = 'INR') {
  if (amount == null || !Number.isFinite(amount)) return null;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${Math.round(amount)}`;
}

function tripPhase(status: string) {
  const s = normalizeDeliveryStatus(status);
  if (s === 'returning_to_restaurant') return 'return' as const;
  if (s === 'picked_up' || s === 'out_for_delivery' || s === 'at_customer') {
    return 'customer' as const;
  }
  return 'restaurant' as const;
}

function phaseCopy(delivery: PartnerDelivery) {
  const s = normalizeDeliveryStatus(delivery.status);
  const step = resolveTripStep(delivery);
  if (s === 'accepted') return { kicker: 'Pickup', title: 'Head to restaurant' };
  if (s === 'arrived') return { kicker: 'Pickup', title: 'Collect the order' };
  if (s === 'picked_up' || s === 'out_for_delivery') {
    return { kicker: 'Drop', title: 'Head to customer' };
  }
  if (s === 'at_customer') return { kicker: 'Drop', title: 'Complete delivery' };
  if (s === 'returning_to_restaurant') {
    if (step === 'complete_return') {
      return {
        kicker: 'Return',
        title: 'Ask kitchen for the return OTP, or wait if they tap Receive.',
      };
    }
    return {
      kicker: 'Return',
      title: 'Take the food back to the restaurant. Do not collect cash.',
    };
  }
  return { kicker: 'Trip', title: s.replace(/_/g, ' ') };
}

function mergeDelivery(
  base: PartnerDelivery,
  extra?: PartnerDelivery | null
): PartnerDelivery {
  if (!extra) return base;
  return {
    ...base,
    ...extra,
    restaurantName: extra.restaurantName || base.restaurantName,
    restaurantPhone: extra.restaurantPhone || base.restaurantPhone,
    restaurantAddress: extra.restaurantAddress ?? base.restaurantAddress,
    customerName: extra.customerName || base.customerName,
    customerPhone: extra.customerPhone || base.customerPhone,
    deliveryAddress: extra.deliveryAddress ?? base.deliveryAddress,
    itemsSummary: extra.itemsSummary || base.itemsSummary,
    itemCount: extra.itemCount ?? base.itemCount,
    amount: extra.amount ?? base.amount,
    earning: extra.earning ?? base.earning,
    rtoFee: extra.rtoFee ?? base.rtoFee,
    nextAction: extra.nextAction ?? base.nextAction,
    returnArrivedAt: extra.returnArrivedAt ?? base.returnArrivedAt,
    paymentMethod: extra.paymentMethod || base.paymentMethod,
    notes: extra.notes || base.notes,
  };
}

/**
 * Full-screen live trip after accept — map on top, current stop + actions below.
 * Mounted from DeliveryLiveSync so Home chrome is not restyled.
 */
export function ActiveTripSession() {
  const actives = useActiveDeliveries(true, { fast: true });
  const current = useActiveDelivery(true, { fast: true });
  const trips = useMemo(() => {
    const map = new Map<string, PartnerDelivery>();
    for (const row of actives.data ?? []) {
      const status = normalizeDeliveryStatus(row.status);
      if (row.id && LIVE.has(status) && !isAssignableStatus(status)) {
        map.set(row.id, row);
      }
    }
    const one = current.data;
    if (one?.id) {
      const status = normalizeDeliveryStatus(one.status);
      if (LIVE.has(status) && !isAssignableStatus(status)) {
        map.set(one.id, { ...map.get(one.id), ...one });
      }
    }
    return Array.from(map.values());
  }, [actives.data, current.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const prevTripsRef = useRef<PartnerDelivery[]>([]);

  useEffect(() => {
    const prev = prevTripsRef.current;
    prevTripsRef.current = trips;
    const prevReturn = prev.find(
      (row) =>
        normalizeDeliveryStatus(row.status) === 'returning_to_restaurant'
    );
    if (!prevReturn || trips.some((row) => row.id === prevReturn.id)) return;
    void deliveryPartnerApi
      .getDelivery(prevReturn.id)
      .then((detail) => {
        if (normalizeDeliveryStatus(detail.status) === 'returned') {
          announceOrderReturned(detail.id, detail.rtoFee);
        }
      })
      .catch(() => undefined);
  }, [trips]);

  useEffect(() => {
    if (!trips.length) {
      setSelectedId(null);
      setMinimized(false);
      return;
    }
    if (!selectedId || !trips.some((row) => row.id === selectedId)) {
      setSelectedId(trips[0].id);
    }
  }, [trips, selectedId]);

  useEffect(() => {
    if (trips[0]?.id) setMinimized(false);
  }, [trips[0]?.id]);

  const delivery = trips.find((row) => row.id === selectedId) ?? trips[0] ?? null;
  if (!delivery) return null;

  return (
    <Modal
      visible={!minimized}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={() => setMinimized(true)}
    >
      <ActiveTripBody
        delivery={delivery}
        stack={trips}
        onSelect={setSelectedId}
        onMinimize={() => setMinimized(true)}
      />
    </Modal>
  );
}

function ActiveTripBody({
  delivery: seed,
  stack,
  onSelect,
  onMinimize,
}: {
  delivery: PartnerDelivery;
  stack: PartnerDelivery[];
  onSelect: (id: string) => void;
  onMinimize: () => void;
}) {
  const insets = useSafeAreaInsets();
  const detail = useDeliveryDetail(seed.id, true, {
    live: true,
    intervalMs: 3_000,
  });
  const delivery = mergeDelivery(seed, detail.data);
  const status = normalizeDeliveryStatus(delivery.status);
  const phase = tripPhase(status);
  const copy = phaseCopy(delivery);
  const live = true;
  const trackingQuery = useOrderTracking({
    orderId: delivery.orderId,
    deliveryId: delivery.id,
    enabled: live,
  });
  const statusQuery = useTrackingStatus(delivery.id, live);
  const routeQuery = useTrackingRoute(
    delivery.orderId,
    live && Boolean(delivery.orderId)
  );
  const tripRouteQuery = useTripNavRoute(delivery.id, live);
  const etaQuery = useTrackingEta(
    delivery.orderId,
    live && Boolean(delivery.orderId)
  );
  const liveLocationQuery = useLiveLocation(
    delivery.orderId,
    live && Boolean(delivery.orderId)
  );
  const historyQuery = useLocationHistory(delivery.id, live);
  const orderMutations = useDeliveryOrderMutations();
  const [trackingPatch, setTrackingPatch] = useState<Partial<OrderTracking> | null>(
    null
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (normalizeDeliveryStatus(delivery.status) === 'returned') {
      announceOrderReturned(delivery.id, delivery.rtoFee);
    }
  }, [delivery.id, delivery.status, delivery.rtoFee]);

  const tracking: OrderTracking | null = (() => {
    const base = trackingQuery.data ?? statusQuery.data;
    if (!base && !trackingPatch) return null;
    return {
      orderId: delivery.orderId ?? '',
      deliveryId: delivery.id,
      status: delivery.status,
      ...statusQuery.data,
      ...base,
      ...trackingPatch,
      etaSeconds:
        trackingPatch?.etaSeconds ??
        etaQuery.data?.etaSeconds ??
        base?.etaSeconds,
      distanceMeters:
        trackingPatch?.distanceMeters ??
        etaQuery.data?.distanceMeters ??
        base?.distanceMeters,
      riderLocation:
        trackingPatch?.riderLocation ??
        liveLocationQuery.data ??
        base?.riderLocation,
      provider:
        trackingPatch?.provider ?? etaQuery.data?.provider ?? base?.provider,
      durationInTraffic:
        trackingPatch?.durationInTraffic ??
        etaQuery.data?.durationInTraffic ??
        base?.durationInTraffic,
    } as OrderTracking;
  })();

  const geo = tracking?.geofence;
  const gate = tripGeofenceState(status, geo, resolveTripStep(delivery));
  const stops = useResolvedTripStops({
    ...delivery,
    restaurantAddress: {
      ...delivery.restaurantAddress,
      line1:
        delivery.restaurantAddress?.line1 ||
        tracking?.pickup?.address ||
        delivery.restaurantAddress?.line1,
      lat:
        delivery.restaurantAddress?.lat ??
        tracking?.pickup?.latitude,
      lng:
        delivery.restaurantAddress?.lng ??
        tracking?.pickup?.longitude,
    },
    deliveryAddress: {
      ...delivery.deliveryAddress,
      line1:
        delivery.deliveryAddress?.line1 ||
        tracking?.drop?.address ||
        delivery.deliveryAddress?.line1,
      lat: delivery.deliveryAddress?.lat ?? tracking?.drop?.latitude,
      lng: delivery.deliveryAddress?.lng ?? tracking?.drop?.longitude,
    },
  });
  const restaurantName = stops.restaurantName;
  const customerName = stops.customerName;
  const pickupLabel = stops.pickupAddress;
  const dropLabel = stops.dropAddress;
  const routePoints = (
    tripRouteQuery.data?.points ??
    routeQuery.data?.points ??
    []
  ).map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
  const historyPoints = (historyQuery.data?.points ?? []).map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  }));
  const trackingBusy =
    (trackingQuery.isLoading && !trackingQuery.data) ||
    (tripRouteQuery.isLoading && !tripRouteQuery.data && !routeQuery.data);
  const trackingError =
    trackingQuery.error ??
    statusQuery.error ??
    tripRouteQuery.error ??
    routeQuery.error ??
    etaQuery.error;

  const onRetryTracking = () => {
    void trackingQuery.refetch();
    void statusQuery.refetch();
    void tripRouteQuery.refetch();
    void routeQuery.refetch();
    void etaQuery.refetch();
    void liveLocationQuery.refetch();
    void historyQuery.refetch();
    void detail.refetch();
  };

  const placeCall = async (target: 'customer' | 'restaurant') => {
    try {
      const result =
        target === 'customer'
          ? await orderMutations.callCustomer.mutateAsync(delivery.id)
          : await orderMutations.callRestaurant.mutateAsync(delivery.id);
      const dest = result.toMasked ? ` ${result.toMasked}` : '';
      const via = result.virtualNumberMasked
        ? ` via ${result.virtualNumberMasked}`
        : '';
      Alert.alert(
        `Calling ${target}`,
        `Masked number${dest}${via}. Your phone should ring — numbers stay hidden.`
      );
    } catch (error) {
      Alert.alert(
        'Could not call',
        formatTripError(error, 'Use in-trip chat instead.')
      );
    }
  };

  const showRestaurant = phase === 'restaurant' || phase === 'return';
  const stopTitle = showRestaurant ? restaurantName : customerName;
  const stopAddr = showRestaurant ? pickupLabel : dropLabel;
  const nextTitle = showRestaurant ? customerName : restaurantName;
  const nextAddr = showRestaurant ? dropLabel : pickupLabel;
  const stopCall: 'restaurant' | 'customer' = showRestaurant
    ? 'restaurant'
    : 'customer';
  const sheetMax = Math.round(Dimensions.get('window').height * 0.56);
  const earnAmount =
    phase === 'return' && delivery.rtoFee && delivery.rtoFee > 0
      ? delivery.rtoFee
      : delivery.earning;
  const earn = money(earnAmount, delivery.currency);
  const amount = money(delivery.amount, delivery.currency);
  const payLabel =
    phase === 'return'
      ? 'No COD'
      : isCodPayment(delivery.paymentMethod)
        ? 'COD'
        : delivery.paymentMethod
          ? 'Prepaid'
          : null;
  const orderCode = tripOrderCode(delivery);
  const itemLine = delivery.itemsSummary
    ? `${delivery.itemCount ? `${delivery.itemCount} item${delivery.itemCount === 1 ? '' : 's'} · ` : ''}${delivery.itemsSummary}`
    : delivery.itemCount
      ? `${delivery.itemCount} item${delivery.itemCount === 1 ? '' : 's'}`
      : null;

  return (
    <View style={styles.root}>
      <View style={styles.mapPane}>
        <DeliveryTripMap
          fill
          delivery={{
            ...delivery,
            restaurantName,
            customerName,
            restaurantAddress: delivery.restaurantAddress ?? {
              line1: pickupLabel || undefined,
            },
            deliveryAddress: delivery.deliveryAddress ?? {
              line1: dropLabel || undefined,
            },
          }}
          tracking={tracking}
          eta={etaQuery.data}
          liveLocation={liveLocationQuery.data}
          routePolyline={
            tripRouteQuery.data?.polyline ?? routeQuery.data?.polyline
          }
          routePoints={routePoints}
          historyPolyline={historyQuery.data?.polyline}
          historyPoints={historyPoints}
          navRoute={tripRouteQuery.data}
          onTrackingPatch={(patch) =>
            setTrackingPatch((prev) => ({ ...prev, ...patch }))
          }
        />
      </View>

      <View
        style={[
          styles.sheet,
          { maxHeight: sheetMax, paddingBottom: Math.max(insets.bottom, 14) },
        ]}
      >
        <Pressable onPress={onMinimize} hitSlop={10} style={styles.handleHit}>
          <View style={styles.handle} />
          <ChevronDown color="#9CA3AF" size={16} />
        </Pressable>

        {stack.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.stackRow}
          >
            {stack.map((row, index) => {
              const on = row.id === delivery.id;
              return (
                <Pressable
                  key={row.id}
                  onPress={() => onSelect(row.id)}
                  style={[styles.stackChip, on && styles.stackChipOn]}
                >
                  <Text
                    style={[styles.stackChipText, on && styles.stackChipTextOn]}
                  >
                    {index + 1}. {row.restaurantName || tripOrderCode(row)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.sheetBody}
        >
          <View style={styles.phaseRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.kicker}>{copy.kicker}</Text>
              <Text style={styles.phaseTitle} numberOfLines={1}>
                {stopTitle}
              </Text>
              <Text style={styles.phaseHint}>{copy.title}</Text>
            </View>
            {earn ? (
              <View style={styles.earnPill}>
                <Text style={styles.earnKicker}>
                  {phase === 'return' ? 'RTO fee' : 'Est. earn'}
                </Text>
                <Text style={styles.earnValue}>{earn}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaChip}>#{orderCode}</Text>
            {payLabel ? <Text style={styles.metaChip}>{payLabel}</Text> : null}
            {amount ? <Text style={styles.metaChip}>{amount}</Text> : null}
          </View>

          {trackingBusy ? (
            <View style={styles.banner}>
              <ActivityIndicator color="#EA4B14" size="small" />
              <Text style={styles.bannerText}>Getting live route & ETA…</Text>
            </View>
          ) : trackingError && !tracking ? (
            <Pressable onPress={onRetryTracking} style={styles.banner}>
              <Text style={styles.bannerText}>
                {formatLocationError(
                  trackingError,
                  'Could not load live tracking. Retry'
                )}
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.stopCard} key={phase}>
            <View style={styles.stopIconWrap}>
              {showRestaurant ? (
                <Store color="#EA4B14" size={18} />
              ) : (
                <User color="#2563EB" size={18} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.stopLabel}>
                {phase === 'return'
                  ? 'Return restaurant'
                  : showRestaurant
                    ? 'Pickup restaurant'
                    : 'Drop customer'}
              </Text>
              <Text style={styles.stopTitle} numberOfLines={2}>
                {stopTitle}
              </Text>
              {stopAddr ? (
                <View style={styles.addrRow}>
                  <MapPin color="#9CA3AF" size={13} />
                  <Text style={styles.stopAddr}>{stopAddr}</Text>
                </View>
              ) : (
                <Text style={styles.stopAddr}>
                  {showRestaurant
                    ? 'Looking up restaurant address…'
                    : 'Looking up drop address…'}
                </Text>
              )}
              {!showRestaurant && stops.dropKmLabel ? (
                <Text style={styles.stopKm}>{stops.dropKmLabel}</Text>
              ) : null}
              {itemLine ? (
                <View style={styles.addrRow}>
                  <Package color="#9CA3AF" size={13} />
                  <Text style={styles.items} numberOfLines={2}>
                    {itemLine}
                  </Text>
                </View>
              ) : null}
              {delivery.notes ? (
                <Text style={styles.notes} numberOfLines={2}>
                  Note: {delivery.notes}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => void placeCall(stopCall)}
              style={styles.callBtn}
            >
              <Phone color="#111827" size={16} />
            </Pressable>
          </View>

          {phase !== 'return' &&
          (nextAddr || nextTitle || (showRestaurant && stops.dropKmLabel)) ? (
            <View style={styles.nextCard}>
              <Text style={styles.nextKicker}>
                {showRestaurant ? 'Then drop' : 'Picked up from'}
              </Text>
              <Text style={styles.nextTitle} numberOfLines={1}>
                {nextTitle}
              </Text>
              {showRestaurant && stops.dropKmLabel ? (
                <Text style={styles.nextKm}>{stops.dropKmLabel}</Text>
              ) : null}
              {nextAddr ? (
                <Text style={styles.nextAddr} numberOfLines={2}>
                  {nextAddr}
                </Text>
              ) : null}
            </View>
          ) : null}

          <TripLifecycleBar
            delivery={delivery}
            geoBlocked={gate.blocked}
            geoHint={gate.hint}
            hideCallActions
          />

          <View style={styles.auxRow}>
            <Pressable onPress={() => setChatOpen(true)} style={styles.auxBtn}>
              <MessageCircle color="#EA4B14" size={16} />
              <Text style={styles.auxText}>Chat</Text>
            </Pressable>
            <Pressable
              onPress={() => void placeCall(showRestaurant ? 'customer' : 'restaurant')}
              style={styles.auxBtn}
            >
              <Phone color="#EA4B14" size={16} />
              <Text style={styles.auxText}>
                {showRestaurant ? 'Call customer' : 'Call store'}
              </Text>
            </Pressable>
            <Pressable onPress={() => setDetailsOpen(true)} style={styles.auxBtn}>
              <Wallet color="#EA4B14" size={16} />
              <Text style={styles.auxText}>Details</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      {chatOpen ? (
        <TripChatSheet
          visible
          deliveryId={delivery.id}
          orderId={delivery.orderId}
          returning={phase === 'return'}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
      <TripDetailSheet
        visible={detailsOpen}
        deliveryId={delivery.id}
        fallback={delivery}
        live
        onClose={() => setDetailsOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#E8EAED',
  },
  mapPane: {
    flex: 1,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 4,
    marginTop: -22,
    elevation: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
  },
  handleHit: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#E5E7EB',
    marginBottom: 2,
  },
  stackRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  stackChip: {
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  stackChipOn: {
    backgroundColor: '#111827',
  },
  stackChipText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#4B5563',
  },
  stackChipTextOn: {
    color: '#FFFFFF',
  },
  sheetBody: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  kicker: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#EA4B14',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  phaseTitle: {
    marginTop: 2,
    fontFamily: fonts.extraBold,
    fontSize: 22,
    color: '#111827',
    letterSpacing: -0.5,
  },
  phaseHint: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  earnPill: {
    backgroundColor: '#ECFDF5',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  earnKicker: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#047857',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  earnValue: {
    marginTop: 1,
    fontFamily: fonts.extraBold,
    fontSize: 18,
    color: '#047857',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 10,
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#9A3412',
  },
  stopCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  stopIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  stopLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stopTitle: {
    marginTop: 2,
    fontFamily: fonts.extraBold,
    fontSize: 17,
    color: '#111827',
    letterSpacing: -0.3,
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 6,
  },
  stopAddr: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
  },
  stopAddrMuted: {
    marginTop: 6,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#9CA3AF',
    lineHeight: 17,
  },
  items: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
  },
  notes: {
    marginTop: 6,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#B45309',
  },
  callBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  nextKicker: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#C2410C',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nextTitle: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#111827',
  },
  nextAddr: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  nextKm: {
    marginTop: 2,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#C2410C',
  },
  stopKm: {
    marginTop: 4,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#C2410C',
  },
  auxRow: {
    flexDirection: 'row',
    gap: 8,
  },
  auxBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  auxText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#EA4B14',
  },
});
