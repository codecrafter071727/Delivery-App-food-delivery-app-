import { useRouter } from 'expo-router';
import { Flame, MapPin, Navigation, Zap } from 'lucide-react-native';
import { useState } from 'react';
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
import {
  LocationMapPicker,
  type MapPickResult,
} from '@/components/restaurant/LocationMapPicker';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { usePartnerDutyStatus } from '@/lib/delivery-partner/availability-hooks';
import { isDutySwitchOn } from '@/lib/delivery-partner/availability-types';
import { useDeliveryPartnerMe } from '@/lib/delivery-partner/hooks';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { formatLocationError } from '@/lib/delivery-partner/tracking-api';
import {
  useLastLocation,
  useNearbyHeatmap,
  useSaveHomeLocation,
} from '@/lib/delivery-partner/tracking-hooks';
import {
  formatLocationAge,
  intensityColor,
  type HeatmapZone,
} from '@/lib/delivery-partner/tracking-types';
import { getApiErrorCode } from '@/lib/errors';

/**
 * Web: list-only demand UI (react-native-maps is native-only).
 */
export function DemandHeatmapScreen() {
  const router = useRouter();
  const headerScroll = useDeliveryHeaderScrollProps();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [homePickerOpen, setHomePickerOpen] = useState(false);
  const [selected, setSelected] = useState<HeatmapZone | null>(null);

  const me = useDeliveryPartnerMe();
  const duty = usePartnerDutyStatus();
  const isOnline = isDutySwitchOn(
    duty.data?.dutyStatus ?? me.data?.dutyStatus,
    Boolean(me.data?.isOnline ?? me.data?.isAvailable ?? duty.data?.isOnline)
  );
  const heatmap = useNearbyHeatmap(true);
  const lastLocation = useLastLocation(true);
  const saveHome = useSaveHomeLocation();

  const errorCode = getApiErrorCode(heatmap.error);
  const errorMessage = heatmap.isError
    ? formatLocationError(heatmap.error, 'Could not load demand map.')
    : null;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([heatmap.refetch(), lastLocation.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const onSaveHome = async (result: MapPickResult) => {
    try {
      await saveHome.mutateAsync({
        latitude: result.lat,
        longitude: result.lng,
        address: result.label || result.formattedAddress,
      });
      setHomePickerOpen(false);
      await heatmap.refetch();
    } catch (err) {
      Alert.alert(
        'Could not save home location',
        formatLocationError(err, 'Please try again.')
      );
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{
          paddingTop: headerScroll.contentInsetTop + 12,
          paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
          paddingHorizontal: 16,
          gap: 12,
        }}
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
        <View style={styles.intro}>
          <Flame color={authTheme.brand} size={20} />
          <View style={{ flex: 1 }}>
            <Text style={styles.introTitle}>Where to wait</Text>
            <Text style={styles.introHint}>
              Hot zones near you (list view on web — use the mobile app for the
              map).
              {lastLocation.data
                ? ` GPS ${formatLocationAge(lastLocation.data.updatedAt, lastLocation.data.ageSeconds) ?? 'on'}.`
                : ''}
            </Text>
          </View>
        </View>

        {heatmap.isLoading && !heatmap.data ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
            <Text style={styles.muted}>Loading demand…</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Couldn’t load heatmap</Text>
            <Text style={styles.muted}>{errorMessage}</Text>
            {errorCode === 'PARTNER_OFFLINE' || !isOnline ? (
              <Pressable
                onPress={() => router.push(DELIVERY_ROUTES.home as never)}
                style={styles.primaryBtn}
              >
                <Text style={styles.primaryBtnText}>Go online</Text>
              </Pressable>
            ) : errorCode === 'LOCATION_REQUIRED' ||
              errorCode === 'LOCATION_NOT_FOUND' ? (
              <Pressable
                onPress={() => setHomePickerOpen(true)}
                style={styles.primaryBtn}
              >
                <Text style={styles.primaryBtnText}>Set home location</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => void heatmap.refetch()} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Retry</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Demand near you</Text>
              <Text style={styles.muted}>
                Map is available in the iOS / Android app. Hot zones below use the
                same live heatmap API.
              </Text>
            </View>

            <Pressable
              onPress={() => setHomePickerOpen(true)}
              style={styles.secondaryBtn}
            >
              <MapPin color={authTheme.brand} size={16} />
              <Text style={styles.secondaryBtnText}>Set / update home location</Text>
            </Pressable>

            {(heatmap.data?.zones ?? []).map((zone) => {
              const surge = zone.surgeMultiplier ?? 1;
              return (
                <Pressable
                  key={zone.zoneId ?? `${zone.latitude}-${zone.longitude}`}
                  onPress={() => setSelected(zone)}
                  style={[
                    styles.zoneCard,
                    selected?.zoneId === zone.zoneId && styles.zoneCardOn,
                  ]}
                >
                  <View style={styles.zoneTop}>
                    <Text style={styles.zoneName}>
                      {zone.name || 'Demand zone'}
                    </Text>
                    <View
                      style={[
                        styles.intensityPill,
                        { backgroundColor: `${intensityColor(zone.intensity)}22` },
                      ]}
                    >
                      <Text
                        style={[
                          styles.intensityText,
                          { color: intensityColor(zone.intensity) },
                        ]}
                      >
                        {(zone.intensity || 'low').replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.zoneMeta}>
                    {[
                      zone.city,
                      zone.distanceKm != null
                        ? `${zone.distanceKm.toFixed(1)} km`
                        : null,
                      `${zone.openDeliveries ?? 0} open`,
                      `${zone.activePartners ?? 0} riders`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {surge > 1 ? (
                    <View style={styles.surgeRow}>
                      <Zap color="#B45309" size={14} />
                      <Text style={styles.surgeText}>
                        Surge {surge.toFixed(1)}x
                      </Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => {
                      void Linking.openURL(
                        `https://www.google.com/maps/dir/?api=1&destination=${zone.latitude},${zone.longitude}&travelmode=driving`
                      );
                    }}
                    style={styles.zoneNav}
                  >
                    <Navigation color={authTheme.brand} size={14} />
                    <Text style={styles.secondaryBtnText}>Navigate to wait here</Text>
                  </Pressable>
                </Pressable>
              );
            })}

            {!heatmap.data?.zones.length && !heatmap.data?.cells.length ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>Quiet right now</Text>
                <Text style={styles.muted}>
                  No hot spots nearby. Stay online — demand updates automatically.
                </Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <LocationMapPicker
        visible={homePickerOpen}
        onClose={() => setHomePickerOpen(false)}
        onConfirm={(result) => void onSaveHome(result)}
        locationTitle="Home / base location"
        currentLocationHint="Used for heatmap when GPS is off"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollView: { flex: 1 },
  intro: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FED7AA',
  },
  introTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  introHint: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  center: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  primaryBtn: {
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.brand,
  },
  zoneCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 4,
  },
  zoneCardOn: {
    borderColor: authTheme.brand,
  },
  zoneTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  zoneName: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  intensityPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  intensityText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    textTransform: 'capitalize',
  },
  zoneMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  surgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  surgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#B45309',
  },
  zoneNav: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
