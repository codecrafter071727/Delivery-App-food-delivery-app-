import { ChevronDown, MessageCircle, Phone } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
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
  deliveryStatusLabel,
  formatDeliveryAddress,
  isAssignableStatus,
  normalizeDeliveryStatus,
} from '@/lib/delivery-partner/api';
import {
  useActiveDeliveries,
  useActiveDelivery,
  useDeliveryOrderMutations,
  useTripNavRoute,
} from '@/lib/delivery-partner/hooks';
import { formatLocationError } from '@/lib/delivery-partner/tracking-api';
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

function phaseCopy(status: string) {
  const s = normalizeDeliveryStatus(status);
  if (s === 'accepted') return { kicker: 'Pickup', title: 'Head to restaurant' };
  if (s === 'arrived') return { kicker: 'Pickup', title: 'Collect the order' };
  if (s === 'picked_up' || s === 'out_for_delivery') {
    return { kicker: 'Drop', title: 'Head to customer' };
  }
  if (s === 'at_customer') return { kicker: 'Drop', title: 'Complete delivery' };
  if (s === 'returning_to_restaurant') {
    return { kicker: 'Return', title: 'Return to restaurant' };
  }
  return { kicker: 'Trip', title: deliveryStatusLabel(s) };
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
  delivery,
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
  const status = normalizeDeliveryStatus(delivery.status);
  const phase = tripPhase(status);
  const copy = phaseCopy(status);
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
  const gate = tripGeofenceState(status, geo);
  const pickupLabel = formatDeliveryAddress(delivery.restaurantAddress);
  const dropLabel = formatDeliveryAddress(delivery.deliveryAddress);
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
  const stopTitle = showRestaurant
    ? delivery.restaurantName || 'Restaurant'
    : delivery.customerName || 'Customer';
  const stopAddr = showRestaurant ? pickupLabel : dropLabel;
  const stopCall: 'restaurant' | 'customer' = showRestaurant
    ? 'restaurant'
    : 'customer';
  const sheetMax = Math.round(Dimensions.get('window').height * 0.5);
  const earn = money(delivery.earning, delivery.currency);
  const amount = money(delivery.amount, delivery.currency);

  return (
    <View style={styles.root}>
      <View style={styles.mapPane}>
        <DeliveryTripMap
          fill
          delivery={delivery}
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
        <Pressable
          onPress={onMinimize}
          style={[styles.minimize, { top: Math.max(insets.top, 8) + 8 }]}
          hitSlop={8}
        >
          <ChevronDown color="#111827" size={20} />
        </Pressable>
      </View>

      <View
        style={[
          styles.sheet,
          { maxHeight: sheetMax, paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <View style={styles.handle} />
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
                  <Text style={[styles.stackChipText, on && styles.stackChipTextOn]}>
                    {index + 1}. {row.restaurantName || row.orderNumber || 'Trip'}
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
              <Text style={styles.phaseTitle}>{copy.title}</Text>
            </View>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>
                {deliveryStatusLabel(status)}
              </Text>
            </View>
          </View>

          <Text style={styles.orderNo}>
            #{delivery.orderNumber || delivery.orderId || delivery.id.slice(-6)}
            {earn ? ` · Est. ${earn}` : ''}
            {amount ? ` · ${amount}` : ''}
          </Text>

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
            <View
              style={[
                styles.stopDot,
                !showRestaurant && styles.stopDotDrop,
              ]}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.stopLabel}>
                {showRestaurant ? 'Restaurant' : 'Customer'}
              </Text>
              <Text style={styles.stopTitle} numberOfLines={1}>
                {stopTitle}
              </Text>
              {stopAddr ? (
                <Text style={styles.stopAddr} numberOfLines={2}>
                  {stopAddr}
                </Text>
              ) : null}
              {delivery.itemsSummary ? (
                <Text style={styles.items} numberOfLines={2}>
                  {delivery.itemCount ? `${delivery.itemCount} items · ` : ''}
                  {delivery.itemsSummary}
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

          <TripLifecycleBar
            delivery={delivery}
            geoBlocked={gate.blocked}
            geoHint={gate.hint}
          />

          <View style={styles.auxRow}>
            <Pressable onPress={() => setChatOpen(true)} style={styles.auxBtn}>
              <MessageCircle color="#EA4B14" size={16} />
              <Text style={styles.auxText}>Chat</Text>
            </Pressable>
            <Pressable onPress={() => setDetailsOpen(true)} style={styles.auxBtn}>
              <Text style={styles.auxText}>Trip details</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      {chatOpen ? (
        <TripChatSheet
          visible
          deliveryId={delivery.id}
          orderId={delivery.orderId}
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
    backgroundColor: '#E5E7EB',
  },
  mapPane: {
    flex: 1,
  },
  minimize: {
    position: 'absolute',
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    marginTop: -18,
    elevation: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#E5E7EB',
    marginBottom: 8,
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
    gap: 12,
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
    letterSpacing: -0.4,
  },
  statusPill: {
    borderRadius: 999,
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: '#C2410C',
  },
  orderNo: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    marginTop: -4,
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
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 14,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EA4B14',
    marginTop: 5,
  },
  stopDotDrop: {
    backgroundColor: '#2563EB',
  },
  stopLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
  },
  stopTitle: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#111827',
  },
  stopAddr: {
    marginTop: 4,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
  },
  items: {
    marginTop: 6,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 13,
    color: '#EA4B14',
  },
});
