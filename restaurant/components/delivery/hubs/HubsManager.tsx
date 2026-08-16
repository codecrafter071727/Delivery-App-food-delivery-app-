import { useRouter } from 'expo-router';
import {
  Building2,
  CheckCircle2,
  MapPin,
  Navigation,
  RotateCcw,
  Store,
  Wallet,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useDeliveryHeaderScrollProps } from '@/components/delivery/shared/header-scroll';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatDutyError,
  readDutyGps,
  useNearbyHubs,
  usePartnerDutyMutations,
  usePartnerDutyStatus,
} from '@/lib/delivery-partner/availability-hooks';
import {
  canAcceptOffers,
  formatMeters,
  hubKindLabel,
  type NearbyHub,
} from '@/lib/delivery-partner/availability-types';
import { pushLiveToast } from '@/lib/delivery-partner/live-toast-store';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { useLocationSyncSnapshot } from '@/lib/delivery-partner/use-partner-location-sync';
import { getApiErrorCode } from '@/lib/errors';

function KindIcon({ kind }: { kind?: string }) {
  const key = (kind ?? '').toLowerCase();
  if (key === 'cash_drop' || key === 'cashdrop') {
    return <Wallet color="#0F766E" size={18} />;
  }
  if (key === 'dark_store' || key === 'darkstore') {
    return <Store color="#C2410C" size={18} />;
  }
  return <Building2 color={authTheme.brand} size={18} />;
}

function openMaps(hub: NearbyHub) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${hub.latitude},${hub.longitude}`;
  void Linking.openURL(url).catch(() => {
    Alert.alert('Could not open maps', 'Copy the address and navigate manually.');
  });
}

export function HubsManager() {
  const router = useRouter();
  const headerScroll = useDeliveryHeaderScrollProps();
  const duty = usePartnerDutyStatus();
  const { checkInHub, checkOutHub, setDutyStatus } = usePartnerDutyMutations();
  const gpsSnap = useLocationSyncSnapshot();
  const [gps, setGps] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [busyHubId, setBusyHubId] = useState<string | null>(null);

  const liveGps = gpsSnap?.coords
    ? { latitude: gpsSnap.coords.latitude, longitude: gpsSnap.coords.longitude }
    : gps;

  const hubs = useNearbyHubs(liveGps, true);
  const checkedInId = duty.data?.hub?.hubId ?? null;
  const atHub = Boolean(duty.data?.hub?.checkedInAt);
  const onWayToHub = duty.data?.dutyStatus === 'on_way_to_hub' && !atHub;
  const onDelivery = duty.data?.dutyStatus === 'on_delivery';
  const onBreak = duty.data?.dutyStatus === 'on_break';
  const accepting = canAcceptOffers(duty.data?.dutyStatus);

  useEffect(() => {
    if (liveGps) return;
    let alive = true;
    void readDutyGps()
      .then((coords) => {
        if (!alive) return;
        setGps(coords);
        setGpsError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setGpsError(formatDutyError(err, 'Location is required to find hubs.'));
      });
    return () => {
      alive = false;
    };
  }, [liveGps]);

  const sorted = useMemo(() => {
    return [...(hubs.data ?? [])].sort(
      (a, b) => a.distanceMeters - b.distanceMeters
    );
  }, [hubs.data]);

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      try {
        const coords = await readDutyGps();
        setGps(coords);
        setGpsError(null);
      } catch (err) {
        setGpsError(formatDutyError(err, 'Could not refresh GPS.'));
      }
      await Promise.all([hubs.refetch(), duty.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const onCheckIn = (hub: NearbyHub) => {
    if (onDelivery) {
      Alert.alert(
        'Active delivery',
        'Finish the current trip before checking in at a hub.'
      );
      return;
    }
    Alert.alert(
      `Check in at ${hub.name}?`,
      hub.distanceMeters > hub.radiusMeters
        ? `You are ${formatMeters(hub.distanceMeters)} away (need ${formatMeters(hub.radiusMeters)}). The server will reject if you are still outside the geofence.`
        : `You are within ${formatMeters(hub.radiusMeters)} of this ${hubKindLabel(hub.kind).toLowerCase()}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Check in',
          onPress: () => {
            setBusyHubId(hub.hubId);
            checkInHub.mutate(
              {
                hubId: hub.hubId,
                latitude: liveGps?.latitude,
                longitude: liveGps?.longitude,
              },
              {
                onSuccess: () =>
                  pushLiveToast({
                    title: 'Checked in',
                    body: `You’re at ${hub.name}. Check out when you leave.`,
                    tone: 'success',
                  }),
                onError: (err) =>
                  Alert.alert(
                    'Could not check in',
                    formatDutyError(err, 'Move closer and try again.')
                  ),
                onSettled: () => setBusyHubId(null),
              }
            );
          },
        },
      ]
    );
  };

  const resumeOnline = (title: string, body: string) => {
    setDutyStatus.mutate(
      {
        dutyStatus: 'online',
        latitude: liveGps?.latitude,
        longitude: liveGps?.longitude,
      },
      {
        onSuccess: () =>
          pushLiveToast({
            title,
            body,
            tone: 'success',
          }),
        onError: (err) =>
          Alert.alert(
            'Could not go online',
            formatDutyError(err, 'Please try again.')
          ),
      }
    );
  };

  const onCheckOut = () => {
    if (onWayToHub && !atHub) {
      resumeOnline('Back online', 'You’ll receive nearby orders again.');
      return;
    }
    checkOutHub.mutate(undefined, {
      onSuccess: () =>
        pushLiveToast({
          title: 'Left hub',
          body: 'You’re back online for new orders.',
          tone: 'success',
        }),
      onError: (err) => {
        if (getApiErrorCode(err) === 'NOT_AT_HUB') {
          resumeOnline('Back online', 'You’ll receive nearby orders again.');
          return;
        }
        Alert.alert(
          'Could not check out',
          formatDutyError(err, 'Please try again.')
        );
      },
    });
  };

  const onHeadToHub = (hub: NearbyHub) => {
    if (onDelivery) {
      Alert.alert(
        'Active delivery',
        'Finish the current trip before heading to a hub.'
      );
      return;
    }
    if (onBreak) {
      Alert.alert(
        'On break',
        'End your break before heading to a hub.'
      );
      return;
    }
    if (!accepting) {
      Alert.alert(
        'Go online first',
        'You must be online (and not on a trip) before marking on the way to a hub.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open home',
            onPress: () => router.push(DELIVERY_ROUTES.home as never),
          },
        ]
      );
      return;
    }
    Alert.alert(
      `Head to ${hub.name}?`,
      'New orders pause until you check in at the hub or cancel heading.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'On my way',
          onPress: () => {
            setBusyHubId(hub.hubId);
            setDutyStatus.mutate(
              {
                dutyStatus: 'on_way_to_hub',
                latitude: liveGps?.latitude,
                longitude: liveGps?.longitude,
              },
              {
                onSuccess: () =>
                  pushLiveToast({
                    title: 'Heading to hub',
                    body: `Navigate to ${hub.name}, then check in when you’re in range.`,
                    tone: 'info',
                  }),
                onError: (err) =>
                  Alert.alert(
                    'Could not update status',
                    formatDutyError(err, 'Stay online and try again.')
                  ),
                onSettled: () => setBusyHubId(null),
              }
            );
          },
        },
      ]
    );
  };

  const listError =
    hubs.isError && !hubs.data
      ? formatDutyError(hubs.error, 'Could not load nearby hubs.')
      : gpsError;
  const locationRequired =
    getApiErrorCode(hubs.error) === 'LOCATION_REQUIRED' || Boolean(gpsError);

  const loading = hubs.isLoading && !hubs.data && !listError;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: headerScroll.contentInsetTop + 12,
            paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
          },
        ]}
        onScroll={headerScroll.onScroll}
        scrollEventThrottle={headerScroll.scrollEventThrottle}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {atHub || onWayToHub ? (
          <View style={styles.checkedBanner}>
            <Text style={styles.checkedTitle}>
              {atHub ? 'Checked in at hub' : 'Heading to hub'}
            </Text>
            <Text style={styles.checkedHint}>
              {atHub
                ? 'Leave the hub to start receiving orders again.'
                : 'Check in when you arrive, or cancel heading to take orders again.'}
            </Text>
            <Pressable
              onPress={onCheckOut}
              disabled={checkOutHub.isPending || setDutyStatus.isPending}
              style={styles.checkoutBtn}
            >
              {checkOutHub.isPending || setDutyStatus.isPending ? (
                <ActivityIndicator color="#111827" size="small" />
              ) : (
                <Text style={styles.checkoutText}>
                  {atHub ? 'Check out → online' : 'Cancel heading → online'}
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
            <Text style={styles.muted}>Finding nearby hubs…</Text>
          </View>
        ) : listError ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Couldn’t load hubs</Text>
            <Text style={styles.muted}>{listError}</Text>
            <Pressable
              onPress={() => void onRefresh()}
              style={styles.primaryBtn}
            >
              <RotateCcw color="#FFFFFF" size={16} />
              <Text style={styles.primaryBtnText}>
                {locationRequired ? 'Enable GPS and retry' : 'Retry'}
              </Text>
            </Pressable>
          </View>
        ) : sorted.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>No hubs nearby</Text>
            <Text style={styles.muted}>
              Nothing in range of your GPS. Move closer to a hub or cash-drop
              and pull to refresh.
            </Text>
            <Pressable
              onPress={() => router.push(DELIVERY_ROUTES.home as never)}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>Back to home</Text>
            </Pressable>
          </View>
        ) : (
          sorted.map((hub) => {
            const inFence = hub.distanceMeters <= hub.radiusMeters;
            const isHere =
              atHub && (!checkedInId || checkedInId === hub.hubId);
            const busy =
              busyHubId === hub.hubId ||
              checkInHub.isPending ||
              setDutyStatus.isPending;
            return (
              <View key={hub.hubId} style={styles.hubCard}>
                <View style={styles.hubTop}>
                  <View style={styles.kindPlate}>
                    <KindIcon kind={hub.kind} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.hubName} numberOfLines={1}>
                      {hub.name}
                    </Text>
                    <Text style={styles.hubMeta} numberOfLines={1}>
                      {hubKindLabel(hub.kind)}
                      {hub.city ? ` · ${hub.city}` : ''}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.distPill,
                      inFence ? styles.distIn : styles.distOut,
                    ]}
                  >
                    <Text
                      style={[
                        styles.distText,
                        inFence ? styles.distTextIn : styles.distTextOut,
                      ]}
                    >
                      {formatMeters(hub.distanceMeters)}
                    </Text>
                  </View>
                </View>

                {hub.address ? (
                  <Text style={styles.address} numberOfLines={2}>
                    {hub.address}
                  </Text>
                ) : null}

                <Text style={styles.fenceHint}>
                  Check-in radius {formatMeters(hub.radiusMeters)}
                  {inFence
                    ? ' · You’re in range'
                    : ' · On my way, then check in when you arrive'}
                </Text>

                <View style={styles.hubActions}>
                  <Pressable
                    onPress={() => openMaps(hub)}
                    style={styles.navBtn}
                  >
                    <Navigation color={authTheme.brand} size={15} />
                    <Text style={styles.navBtnText}>Navigate</Text>
                  </Pressable>
                  {isHere ? (
                    <View style={styles.hereChip}>
                      <CheckCircle2 color="#15803D" size={15} />
                      <Text style={styles.hereText}>You’re here</Text>
                    </View>
                  ) : inFence ? (
                    <Pressable
                      onPress={() => onCheckIn(hub)}
                      disabled={busy || !hub.isActive || onDelivery}
                      style={[
                        styles.checkInBtn,
                        (!hub.isActive || onDelivery) && styles.checkInDisabled,
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <>
                          <MapPin color="#FFFFFF" size={15} />
                          <Text style={styles.checkInText}>Check in</Text>
                        </>
                      )}
                    </Pressable>
                  ) : onWayToHub ? (
                    <View style={styles.headingChip}>
                      <Navigation color="#C2410C" size={15} />
                      <Text style={styles.headingText}>Heading</Text>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => onHeadToHub(hub)}
                      disabled={busy || !hub.isActive || onDelivery}
                      style={[
                        styles.wayBtn,
                        (!hub.isActive || onDelivery) && styles.checkInDisabled,
                      ]}
                    >
                      {busy ? (
                        <ActivityIndicator color="#111827" size="small" />
                      ) : (
                        <Text style={styles.wayBtnText}>On my way</Text>
                      )}
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F4F6' },
  scrollView: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  center: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  primaryBtn: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 14,
    paddingVertical: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  secondaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.brand,
  },
  checkedBanner: {
    backgroundColor: '#FFF7ED',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FED7AA',
    gap: 6,
  },
  checkedTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#9A3412',
  },
  checkedHint: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#C2410C',
  },
  checkoutBtn: {
    marginTop: 8,
    alignItems: 'center',
    backgroundColor: '#FDBA74',
    borderRadius: 14,
    paddingVertical: 12,
  },
  checkoutText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#111827',
  },
  hubCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  hubTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kindPlate: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubName: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  hubMeta: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  distPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  distIn: { backgroundColor: '#DCFCE7' },
  distOut: { backgroundColor: '#F1F5F9' },
  distText: { fontFamily: fonts.bold, fontSize: 12 },
  distTextIn: { color: '#15803D' },
  distTextOut: { color: '#475569' },
  address: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
  },
  fenceHint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  hubActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  navBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingVertical: 12,
    backgroundColor: '#FFF7ED',
  },
  navBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.brand,
  },
  checkInBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: '#111827',
  },
  checkInDisabled: { opacity: 0.45 },
  checkInText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  hereChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: '#DCFCE7',
  },
  hereText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#15803D',
  },
  headingChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: '#FFEDD5',
  },
  headingText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#C2410C',
  },
  wayBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingVertical: 12,
    backgroundColor: '#FDBA74',
  },
  wayBtnText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#111827',
  },
});
