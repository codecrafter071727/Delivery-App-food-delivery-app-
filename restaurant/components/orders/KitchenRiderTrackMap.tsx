import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { decodeGooglePolyline } from '@/lib/delivery-partner/decode-polyline';
import type { OrderTracking } from '@/lib/delivery-partner/tracking-types';
import { formatEtaSeconds, formatDistanceMeters } from '@/lib/delivery-partner/tracking-types';

type LatLng = { latitude: number; longitude: number };

type Props = {
  tracking: OrderTracking | null;
  loading?: boolean;
  error?: unknown;
};

function isValidPoint(lat?: number | null, lng?: number | null): lat is number {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Kitchen live map: rider → restaurant → customer until delivered.
 */
export function KitchenRiderTrackMap({ tracking, loading, error }: Props) {
  const mapRef = useRef<MapView | null>(null);
  const [rider, setRider] = useState<LatLng | null>(null);

  const pickup = useMemo<LatLng | null>(() => {
    if (isValidPoint(tracking?.pickup?.latitude, tracking?.pickup?.longitude)) {
      return {
        latitude: tracking!.pickup!.latitude,
        longitude: tracking!.pickup!.longitude,
      };
    }
    return null;
  }, [tracking?.pickup?.latitude, tracking?.pickup?.longitude]);

  const drop = useMemo<LatLng | null>(() => {
    if (isValidPoint(tracking?.drop?.latitude, tracking?.drop?.longitude)) {
      return {
        latitude: tracking!.drop!.latitude,
        longitude: tracking!.drop!.longitude,
      };
    }
    return null;
  }, [tracking?.drop?.latitude, tracking?.drop?.longitude]);

  useEffect(() => {
    const loc = tracking?.riderLocation;
    if (isValidPoint(loc?.latitude, loc?.longitude)) {
      setRider({ latitude: loc.latitude, longitude: loc.longitude });
    }
  }, [tracking?.riderLocation?.latitude, tracking?.riderLocation?.longitude]);

  const polylineCoords = useMemo(() => {
    if (!tracking?.polyline) return [] as LatLng[];
    try {
      return decodeGooglePolyline(tracking.polyline);
    } catch {
      return [] as LatLng[];
    }
  }, [tracking?.polyline]);

  useEffect(() => {
    if (!mapRef.current) return;
    const points = [...polylineCoords, rider, pickup, drop].filter(
      Boolean
    ) as LatLng[];
    if (points.length < 1) return;
    if (points.length === 1) {
      mapRef.current.animateToRegion(
        { ...points[0], latitudeDelta: 0.02, longitudeDelta: 0.02 },
        350
      );
      return;
    }
    mapRef.current.fitToCoordinates(points, {
      edgePadding: { top: 40, right: 36, bottom: 40, left: 36 },
      animated: true,
    });
  }, [
    polylineCoords.length,
    rider?.latitude,
    rider?.longitude,
    pickup?.latitude,
    drop?.latitude,
  ]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Live rider map</Text>
        <Text style={styles.hint}>Open the mobile app to see the live map.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Live rider map</Text>
      {tracking?.dutyHint ? (
        <Text style={styles.meta}>{tracking.dutyHint}</Text>
      ) : null}
      {tracking?.etaSeconds != null || tracking?.distanceMeters != null ? (
        <Text style={styles.meta}>
          {[
            tracking.etaSeconds != null
              ? `ETA ${formatEtaSeconds(tracking.etaSeconds)}`
              : null,
            tracking.distanceMeters != null
              ? formatDistanceMeters(tracking.distanceMeters)
              : null,
            tracking.riderLocation?.stale ? 'GPS stale' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}

      {loading && !tracking ? (
        <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 24 }} />
      ) : error && !tracking ? (
        <Text style={styles.error}>{getApiErrorMessage(error)}</Text>
      ) : (
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_GOOGLE}
          showsUserLocation={false}
          showsMyLocationButton={false}
          toolbarEnabled={false}
        >
          {pickup ? (
            <Marker coordinate={pickup} title="Restaurant" pinColor="#0F766E" />
          ) : null}
          {drop ? (
            <Marker coordinate={drop} title="Customer" pinColor="#B45309" />
          ) : null}
          {rider ? (
            <Marker coordinate={rider} title="Rider" pinColor="#C2410C" />
          ) : null}
          {polylineCoords.length >= 2 ? (
            <Polyline
              coordinates={polylineCoords}
              strokeColor={authTheme.brand}
              strokeWidth={4}
            />
          ) : null}
        </MapView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    backgroundColor: '#FFFFFF',
    padding: 12,
    gap: 6,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#0F172A',
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#64748B',
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#64748B',
    marginVertical: 8,
  },
  error: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: authTheme.error,
    marginVertical: 8,
  },
  map: {
    height: 220,
    borderRadius: 12,
    marginTop: 4,
    overflow: 'hidden',
  },
});
