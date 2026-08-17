import { Navigation } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatDeliveryAddress,
  normalizeDeliveryStatus,
} from '@/lib/delivery-partner/api';
import { decodeGooglePolyline } from '@/lib/delivery-partner/decode-polyline';
import { partnerLocationTracker } from '@/lib/delivery-partner/location-tracker';
import { useOrderTrackingSocket } from '@/lib/delivery-partner/tracking-socket';
import {
  etaLabel,
  formatDistanceMeters,
  formatEtaSeconds,
  type OrderTracking,
  type PartnerLiveLocation,
  type TrackingEta,
} from '@/lib/delivery-partner/tracking-types';
import type { PartnerDelivery, TripNavRoute } from '@/lib/delivery-partner/types';
import { useAuthStore } from '@/store/auth-store';

type LatLng = { latitude: number; longitude: number };

function isValidPoint(lat?: number | null, lng?: number | null): lat is number {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

function openExternalNav(point: LatLng, label?: string) {
  const destination = `${point.latitude},${point.longitude}`;
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
  );
}

type Props = {
  delivery: PartnerDelivery;
  tracking?: OrderTracking | null;
  eta?: TrackingEta | null;
  liveLocation?: PartnerLiveLocation | null;
  routePolyline?: string | null;
  routePoints?: LatLng[];
  historyPolyline?: string | null;
  historyPoints?: LatLng[];
  navRoute?: TripNavRoute | null;
  onTrackingPatch?: (patch: Partial<OrderTracking>) => void;
};

/**
 * Trip map: Google Map + server polyline/ETA (no Directions from the phone).
 */
export function DeliveryTripMap({
  delivery,
  tracking,
  eta,
  liveLocation,
  routePolyline,
  routePoints,
  historyPolyline,
  historyPoints,
  navRoute,
  onTrackingPatch,
}: Props) {
  const mapRef = useRef<MapView | null>(null);
  const userId = useAuthStore((s) => s.user?.id);
  const [rider, setRider] = useState<LatLng | null>(() => {
    const known = partnerLocationTracker.getLastKnown();
    return known
      ? { latitude: known.latitude, longitude: known.longitude }
      : null;
  });
  const [socketEta, setSocketEta] = useState<{
    etaSeconds?: number | null;
    distanceMeters?: number | null;
    polyline?: string;
    provider?: string;
    durationInTraffic?: boolean;
  } | null>(null);

  const status = normalizeDeliveryStatus(tracking?.status || delivery.status);
  const pickupLabel =
    tracking?.drop?.kind === 'restaurant'
      ? tracking.drop.address
      : formatDeliveryAddress(delivery.restaurantAddress) ||
        delivery.restaurantName ||
        'Restaurant';
  const dropLabel =
    tracking?.drop?.address ||
    formatDeliveryAddress(delivery.deliveryAddress) ||
    delivery.customerName ||
    'Customer';

  const pickup = useMemo<LatLng | null>(() => {
    if (isValidPoint(tracking?.pickup?.latitude, tracking?.pickup?.longitude)) {
      return {
        latitude: tracking!.pickup!.latitude,
        longitude: tracking!.pickup!.longitude,
      };
    }
    const rest = delivery.restaurantAddress;
    if (isValidPoint(rest?.lat, rest?.lng)) {
      return { latitude: rest!.lat!, longitude: rest!.lng! };
    }
    return null;
  }, [
    tracking?.pickup?.latitude,
    tracking?.pickup?.longitude,
    delivery.restaurantAddress?.lat,
    delivery.restaurantAddress?.lng,
  ]);

  const drop = useMemo<LatLng | null>(() => {
    if (isValidPoint(tracking?.drop?.latitude, tracking?.drop?.longitude)) {
      return {
        latitude: tracking!.drop!.latitude,
        longitude: tracking!.drop!.longitude,
      };
    }
    const live = delivery.customerLiveLocation;
    if (isValidPoint(live?.lat, live?.lng)) {
      return { latitude: live.lat, longitude: live.lng };
    }
    if (
      isValidPoint(delivery.deliveryAddress?.lat, delivery.deliveryAddress?.lng)
    ) {
      return {
        latitude: delivery.deliveryAddress!.lat!,
        longitude: delivery.deliveryAddress!.lng!,
      };
    }
    return null;
  }, [
    tracking?.drop?.latitude,
    tracking?.drop?.longitude,
    delivery.customerLiveLocation?.lat,
    delivery.customerLiveLocation?.lng,
    delivery.deliveryAddress?.lat,
    delivery.deliveryAddress?.lng,
  ]);

  const encoded =
    navRoute?.polyline ||
    socketEta?.polyline ||
    tracking?.polyline ||
    routePolyline ||
    historyPolyline ||
    '';
  const decoded = useMemo(() => decodeGooglePolyline(encoded), [encoded]);
  const polylineCoords =
    decoded.length >= 2
      ? decoded
      : navRoute?.points && navRoute.points.length >= 2
        ? navRoute.points
        : routePoints && routePoints.length >= 2
          ? routePoints
          : historyPoints && historyPoints.length >= 2
            ? historyPoints
            : [];

  const riderFromApi = liveLocation ?? tracking?.riderLocation;
  const displayRider = useMemo<LatLng | null>(() => {
    if (rider) return rider;
    if (isValidPoint(riderFromApi?.latitude, riderFromApi?.longitude)) {
      return {
        latitude: riderFromApi!.latitude,
        longitude: riderFromApi!.longitude,
      };
    }
    return null;
  }, [rider, riderFromApi?.latitude, riderFromApi?.longitude]);

  const navTarget = useMemo(() => {
    if (navRoute?.destination) {
      const kind = navRoute.leg === 'return' || navRoute.leg === 'pickup'
        ? pickupLabel
        : dropLabel;
      return {
        point: {
          latitude: navRoute.destination.latitude,
          longitude: navRoute.destination.longitude,
        },
        label: kind,
      };
    }
    if (
      status === 'accepted' ||
      status === 'arrived' ||
      status === 'returning_to_restaurant'
    ) {
      return pickup ? { point: pickup, label: pickupLabel } : null;
    }
    if (status === 'picked_up' || status === 'out_for_delivery') {
      return drop ? { point: drop, label: dropLabel } : null;
    }
    return drop
      ? { point: drop, label: dropLabel }
      : pickup
        ? { point: pickup, label: pickupLabel }
        : null;
  }, [status, pickup, drop, pickupLabel, dropLabel, navRoute]);

  const etaSeconds =
    navRoute?.etaSeconds ??
    socketEta?.etaSeconds ??
    eta?.etaSeconds ??
    tracking?.etaSeconds;
  const distanceMeters =
    navRoute?.distanceMeters ??
    socketEta?.distanceMeters ??
    eta?.distanceMeters ??
    tracking?.distanceMeters;
  const provider =
    navRoute?.provider ??
    socketEta?.provider ??
    eta?.provider ??
    tracking?.provider;
  const durationInTraffic =
    navRoute?.durationInTraffic ??
    socketEta?.durationInTraffic ??
    eta?.durationInTraffic ??
    tracking?.durationInTraffic;
  const nextInstruction = navRoute?.nextInstruction;
  const hint = tracking?.dutyHint;
  const geo = tracking?.geofence;
  const historyCoords =
    historyPoints && historyPoints.length >= 2 ? historyPoints : [];

  useOrderTrackingSocket(
    delivery.orderId,
    userId,
    Boolean(delivery.orderId),
    {
      onLocation: (point) => {
        setRider({ latitude: point.latitude, longitude: point.longitude });
        onTrackingPatch?.({
          riderLocation: {
            latitude: point.latitude,
            longitude: point.longitude,
            speed: point.speed,
            heading: point.heading,
          },
        });
      },
      onEta: (eta) => {
        setSocketEta(eta);
        onTrackingPatch?.({
          etaSeconds: eta.etaSeconds,
          distanceMeters: eta.distanceMeters,
          polyline: eta.polyline,
          provider: eta.provider,
          durationInTraffic: eta.durationInTraffic,
        });
      },
      onStatus: (payload) => {
        if (payload.status) onTrackingPatch?.({ status: payload.status });
      },
    }
  );

  useEffect(() => {
    const unsub = partnerLocationTracker.subscribe((coords) => {
      if (!coords) return;
      setRider({ latitude: coords.latitude, longitude: coords.longitude });
    });
    return unsub;
  }, [delivery.id]);

  useEffect(() => {
    if (!mapRef.current) return;
    const points = [
      ...polylineCoords,
      displayRider,
      pickup,
      drop,
    ].filter(Boolean) as LatLng[];
    if (!points.length) return;
    if (points.length === 1) {
      mapRef.current.animateToRegion(
        { ...points[0], latitudeDelta: 0.02, longitudeDelta: 0.02 },
        350
      );
      return;
    }
    mapRef.current.fitToCoordinates(points, {
      edgePadding: { top: 56, right: 40, bottom: 56, left: 40 },
      animated: true,
    });
  }, [
    polylineCoords.length,
    displayRider?.latitude,
    displayRider?.longitude,
    pickup,
    drop,
  ]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>
          Live trip map is available on the mobile app.
        </Text>
        {navTarget ? (
          <Pressable
            onPress={() => openExternalNav(navTarget.point, navTarget.label)}
            style={styles.navBtn}
          >
            <Navigation color="#fff" size={14} />
            <Text style={styles.navBtnText}>Open in Google Maps</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (!pickup && !drop && !displayRider && polylineCoords.length < 2) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackText}>
          Waiting for trip pins and GPS…
        </Text>
      </View>
    );
  }

  const initial = displayRider ?? pickup ?? drop ?? polylineCoords[0];

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={
          initial
            ? { ...initial, latitudeDelta: 0.04, longitudeDelta: 0.04 }
            : undefined
        }
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        loadingEnabled
      >
        {pickup ? (
          <Marker
            coordinate={pickup}
            title="Pickup"
            description={pickupLabel}
            pinColor={authTheme.brand}
          />
        ) : null}
        {pickup && geo ? (
          <Circle
            center={pickup}
            radius={geo.pickupMeters || 150}
            fillColor={geo.atPickup ? '#22C55E22' : '#EA4B1422'}
            strokeColor={geo.atPickup ? '#16A34A' : authTheme.brand}
            strokeWidth={1}
          />
        ) : null}
        {drop ? (
          <Marker
            coordinate={drop}
            title="Customer"
            description={dropLabel}
            pinColor="#EA580C"
          />
        ) : null}
        {drop && geo ? (
          <Circle
            center={drop}
            radius={geo.dropMeters || 100}
            fillColor={geo.atDrop ? '#22C55E22' : '#0EA5E922'}
            strokeColor={geo.atDrop ? '#16A34A' : '#0284C7'}
            strokeWidth={1}
          />
        ) : null}
        {displayRider ? (
          <Marker
            coordinate={displayRider}
            title="You"
            description="Live location"
            pinColor="#2563EB"
          />
        ) : null}
        {historyCoords.length >= 2 ? (
          <Polyline
            coordinates={historyCoords}
            strokeColor="#94A3B8"
            strokeWidth={3}
            lineDashPattern={[8, 6]}
          />
        ) : null}
        {polylineCoords.length >= 2 ? (
          <Polyline
            coordinates={polylineCoords}
            strokeColor={authTheme.brand}
            strokeWidth={4}
          />
        ) : null}
      </MapView>

      <View style={styles.etaChip}>
        {nextInstruction ? (
          <Text style={styles.turnText} numberOfLines={2}>
            {nextInstruction}
          </Text>
        ) : null}
        <Text style={styles.etaHint} numberOfLines={1}>
          {hint ||
            (navRoute?.leg === 'return'
              ? 'Return to restaurant'
              : navRoute?.leg === 'drop' ||
                  status === 'picked_up' ||
                  status === 'out_for_delivery'
                ? 'Navigate to customer'
                : 'Navigate to restaurant')}
        </Text>
        <Text style={styles.etaValue}>
          {formatEtaSeconds(etaSeconds)}
          {distanceMeters != null
            ? ` · ${formatDistanceMeters(distanceMeters)}`
            : ''}
        </Text>
        <Text style={styles.etaProvider}>
          {etaLabel({ provider, durationInTraffic })}
        </Text>
      </View>

      {navTarget ? (
        <Pressable
          onPress={() => openExternalNav(navTarget.point, navTarget.label)}
          style={styles.navBtn}
        >
          <Navigation color="#fff" size={14} />
          <Text style={styles.navBtnText}>
            Navigate to{' '}
            {navRoute?.leg === 'return' || status === 'returning_to_restaurant'
              ? 'restaurant'
              : status === 'picked_up' ||
                  status === 'out_for_delivery' ||
                  status === 'at_customer'
                ? 'customer'
                : status === 'accepted' || status === 'arrived'
                  ? 'restaurant'
                  : 'destination'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#F1F5F9',
  },
  map: {
    width: '100%',
    height: 300,
  },
  etaChip: {
    marginHorizontal: 10,
    marginTop: -36,
    marginBottom: 6,
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  etaHint: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#9CA3AF',
  },
  turnText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
    marginBottom: 4,
  },
  etaValue: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#FFFFFF',
  },
  etaProvider: {
    marginTop: 2,
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#FDBA74',
  },
  navBtn: {
    margin: 10,
    marginTop: 4,
    minHeight: 44,
    borderRadius: 11,
    backgroundColor: authTheme.brand,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  navBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  fallback: {
    minHeight: 120,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    backgroundColor: authTheme.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 10,
  },
  fallbackText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    textAlign: 'center',
  },
});
