import { Navigation } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  etaLabel,
  formatDistanceMeters,
  formatEtaSeconds,
  type OrderTracking,
  type PartnerLiveLocation,
  type TrackingEta,
} from '@/lib/delivery-partner/tracking-types';
import type { PartnerDelivery, TripNavRoute } from '@/lib/delivery-partner/types';

type LatLng = { latitude: number; longitude: number };

function openExternalNav(point: LatLng) {
  const destination = `${point.latitude},${point.longitude}`;
  void Linking.openURL(
    `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`
  );
}

export function DeliveryTripMap({
  tracking,
  eta,
  liveLocation,
  navRoute,
}: {
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
}) {
  const etaSeconds = navRoute?.etaSeconds ?? eta?.etaSeconds ?? tracking?.etaSeconds;
  const distanceMeters =
    navRoute?.distanceMeters ?? eta?.distanceMeters ?? tracking?.distanceMeters;
  const geo = tracking?.geofence;
  const drop = tracking?.drop;
  const pickup = tracking?.pickup;
  const rider = liveLocation ?? tracking?.riderLocation;
  const nav =
    drop?.latitude != null && drop?.longitude != null
      ? { latitude: drop.latitude, longitude: drop.longitude }
      : pickup?.latitude != null && pickup?.longitude != null
        ? { latitude: pickup.latitude, longitude: pickup.longitude }
        : null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {navRoute?.nextInstruction || tracking?.dutyHint || 'Live trip tracking'}
      </Text>
      <Text style={styles.eta}>
        {formatEtaSeconds(etaSeconds)}
        {distanceMeters != null ? ` · ${formatDistanceMeters(distanceMeters)}` : ''}
      </Text>
      <Text style={styles.meta}>
        {etaLabel({
          provider: navRoute?.provider ?? eta?.provider ?? tracking?.provider,
          durationInTraffic:
            navRoute?.durationInTraffic ??
            eta?.durationInTraffic ??
            tracking?.durationInTraffic,
        })}
        {rider ? ' · GPS sharing' : ''}
      </Text>
      {geo ? (
        <Text style={styles.geo}>
          Pickup {geo.atPickup ? 'inside' : 'outside'} {geo.pickupMeters}m · Drop{' '}
          {geo.atDrop ? 'inside' : 'outside'} {geo.dropMeters}m
        </Text>
      ) : null}
      {nav ? (
        <Pressable onPress={() => openExternalNav(nav)} style={styles.navBtn}>
          <Navigation color="#FFFFFF" size={14} />
          <Text style={styles.navBtnText}>Open in Google Maps</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 140,
    backgroundColor: '#111827',
    padding: 16,
    borderRadius: 16,
    gap: 4,
  },
  title: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#9CA3AF',
  },
  eta: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: '#FFFFFF',
  },
  meta: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#FDBA74',
  },
  geo: {
    marginTop: 4,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#D1D5DB',
    lineHeight: 17,
  },
  navBtn: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  navBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
});
