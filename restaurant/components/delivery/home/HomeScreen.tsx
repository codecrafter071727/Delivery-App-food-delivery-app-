import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import {
  CalendarClock,
  ChevronRight,
  FileText,
  Flame,
  HelpCircle,
  Package,
  Star,
  UtensilsCrossed,
  Building2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MapPin, Bell } from 'lucide-react-native';
import { useAuthStore } from '@/store/auth-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DutyControlCard } from '@/components/delivery/home/DutyControlCard';
import {
  LocationMapPicker,
  type MapPickResult,
} from '@/components/restaurant/LocationMapPicker';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatCurrency,
  formatPercent,
  formatRating,
} from '@/lib/delivery-partner/analytics-api';
import {
  usePartnerEarnings,
  usePartnerPerformance,
} from '@/lib/delivery-partner/analytics-hooks';
import {
  deliveryPartnerApi,
  deliveryStatusLabel,
} from '@/lib/delivery-partner/api';
import {
  formatDutyError,
  usePartnerBreakPolicy,
  usePartnerDutyMutations,
  usePartnerDutyStatus,
  usePartnerDutySummary,
} from '@/lib/delivery-partner/availability-hooks';
import {
  canAcceptOffers,
  isDutySwitchOn,
} from '@/lib/delivery-partner/availability-types';
import { pushLiveToast } from '@/lib/delivery-partner/live-toast-store';
import { useLocationSyncSnapshot } from '@/lib/delivery-partner/use-partner-location-sync';
import { formatLocationError } from '@/lib/delivery-partner/tracking-api';
import {
  useLastLocation,
  useSaveHomeLocation,
} from '@/lib/delivery-partner/tracking-hooks';
import {
  formatLocationAge,
  LOCATION_ERROR_COPY,
} from '@/lib/delivery-partner/tracking-types';
import {
  formatGoOnlineError,
  getGoOnlineBlocker,
} from '@/lib/delivery-partner/go-online-guard';
import {
  useActiveDelivery,
  useDeliveryHistory,
  useDeliveryOrderMutations,
  useDeliveryPartnerMe,
} from '@/lib/delivery-partner/hooks';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/errors';

const LIVE_LOCATION_STORAGE_KEY = '@tokajo/partner-live-location';
const LIVE_LOCATION_FALLBACK = 'Tap to set your live location';

type SavedLiveLocation = {
  label: string;
  lat: number;
  lng: number;
};

const MORE_FEATURES = [
  {
    key: 'documents',
    label: 'Documents',
    description: 'KYC upload & verification',
    href: DELIVERY_ROUTES.documents,
    icon: FileText,
    accent: '#7A0E22',
    soft: '#F8E8EC',
  },
  {
    key: 'restaurants',
    label: 'Restaurants',
    description: 'Partner outlets near you',
    href: DELIVERY_ROUTES.restaurants,
    icon: UtensilsCrossed,
    accent: '#EA580C',
    soft: '#FFF1E8',
  },
  {
    key: 'shifts',
    label: 'Shifts',
    description: 'Book slots & attendance',
    href: DELIVERY_ROUTES.shifts,
    icon: CalendarClock,
    accent: '#0F766E',
    soft: '#ECFDF5',
  },
  {
    key: 'hubs',
    label: 'Hubs',
    description: 'Check-in & cash drop',
    href: DELIVERY_ROUTES.hubs,
    icon: Building2,
    accent: '#0369A1',
    soft: '#E0F2FE',
  },
  {
    key: 'heatmap',
    label: 'Demand',
    description: 'Nearby order heatmap',
    href: DELIVERY_ROUTES.heatmap,
    icon: Flame,
    accent: '#B45309',
    soft: '#FFFBEB',
  },
  {
    key: 'support',
    label: 'Support',
    description: 'Help & tickets',
    href: DELIVERY_ROUTES.support,
    icon: HelpCircle,
    accent: '#2563EB',
    soft: '#EFF4FF',
  },
] as const;

/** Delivery Home — clean API-fed dashboard. */
export function DeliveryHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [confirmingLocation, setConfirmingLocation] = useState(false);
  const [liveLocation, setLiveLocation] = useState<SavedLiveLocation | null>(
    null
  );

  const me = useDeliveryPartnerMe();
  const duty = usePartnerDutyStatus();
  const dutySummary = usePartnerDutySummary();
  const breakPolicy = usePartnerBreakPolicy();
  const { startBreak, endBreak, extendBreak, setDutyStatus, checkOutHub } =
    usePartnerDutyMutations();
  const gpsSnap = useLocationSyncSnapshot();
  const saveHome = useSaveHomeLocation();
  const lastLocation = useLastLocation(true);
  const authUser = useAuthStore((s) => s.user);
  const displayName =
    [me.data?.firstName, me.data?.lastName].filter(Boolean).join(' ') ||
    me.data?.name ||
    [authUser?.firstName, authUser?.lastName].filter(Boolean).join(' ') ||
    'Partner';
  const active = useActiveDelivery();
  const history = useDeliveryHistory(5);
  const performance = usePartnerPerformance();
  const earnings = usePartnerEarnings(1);
  const { setOnline } = useDeliveryOrderMutations();

  const dutyStatus =
    duty.data?.dutyStatus ?? me.data?.dutyStatus ?? undefined;
  const isOnline = isDutySwitchOn(
    dutyStatus,
    Boolean(me.data?.isOnline ?? me.data?.isAvailable ?? duty.data?.isOnline)
  );
  const onDelivery = dutyStatus === 'on_delivery';
  const acceptingOrders = canAcceptOffers(dutyStatus);
  const breakBusy =
    startBreak.isPending || endBreak.isPending || extendBreak.isPending;
  const delivery = active.data ?? null;
  const goOnlineBlocker = getGoOnlineBlocker(me.data);

  const todayEarnings = earnings.data?.totalEarnings ?? 0;
  const currency = earnings.data?.currency ?? 'INR';

  const totalDeliveries = performance.data?.totalDeliveries ?? 0;
  const avgRating = performance.data?.avgRating ?? 0;
  const completionRate = performance.data?.completionRate ?? 0;
  const acceptanceRate = performance.data?.acceptanceRate ?? 0;
  const onTimeRate = performance.data?.onTimeRate ?? 0;
  const streak = performance.data?.currentStreak ?? 0;

  const recent = history.data?.pages.flatMap((p) => p.deliveries) ?? [];
  const loading = me.isLoading && !me.data;

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(LIVE_LOCATION_STORAGE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        try {
          const parsed = JSON.parse(raw) as SavedLiveLocation;
          if (
            parsed?.label &&
            Number.isFinite(parsed.lat) &&
            Number.isFinite(parsed.lng)
          ) {
            setLiveLocation(parsed);
          }
        } catch {
          // ignore corrupt cache
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        me.refetch(),
        duty.refetch(),
        dutySummary.refetch(),
        breakPolicy.refetch(),
        active.refetch(),
        history.refetch(),
        performance.refetch(),
        earnings.refetch(),
        lastLocation.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const onToggleOnline = () => {
    if (onDelivery) {
      Alert.alert(
        'Active delivery',
        'Complete your active delivery before going offline.'
      );
      return;
    }
    if (!isOnline && goOnlineBlocker) {
      Alert.alert(goOnlineBlocker.title, goOnlineBlocker.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: goOnlineBlocker.actionLabel,
          onPress: () => router.push(goOnlineBlocker.actionHref as never),
        },
      ]);
      return;
    }
    setOnline.mutate(!isOnline, {
      onSuccess: () => {
        pushLiveToast({
          title: !isOnline ? 'You’re online' : 'You’re offline',
          body: !isOnline
            ? 'Nearby orders will start coming in.'
            : 'You won’t receive new orders.',
          tone: 'success',
        });
      },
      onError: (err) => {
        Alert.alert(
          'Could not update duty',
          formatGoOnlineError(err, 'Please try again.')
        );
      },
    });
  };

  const onStartBreak = (durationMinutes: number) => {
    if (onDelivery) {
      Alert.alert(
        'Active delivery',
        'Finish the current trip before starting a break.'
      );
      return;
    }
    if (!acceptingOrders) {
      Alert.alert('Go online first', 'You need to be online to take a break.');
      return;
    }
    startBreak.mutate(
      { durationMinutes },
      {
        onSuccess: () =>
          pushLiveToast({
            title: 'Break started',
            body: `New orders pause for ${durationMinutes} min.`,
            tone: 'info',
          }),
        onError: (err) =>
          Alert.alert(
            'Could not start break',
            formatDutyError(err, 'Please try again.')
          ),
      }
    );
  };

  const onEndBreak = () => {
    endBreak.mutate(undefined as void, {
      onSuccess: () =>
        pushLiveToast({
          title: 'Break ended',
          body: 'You’re back online for new orders.',
          tone: 'success',
        }),
      onError: (err) =>
        Alert.alert(
          'Could not end break',
          formatDutyError(err, 'Please try again.')
        ),
    });
  };

  const onExtendBreak = (additionalMinutes: number) => {
    extendBreak.mutate(additionalMinutes, {
      onSuccess: () =>
        pushLiveToast({
          title: 'Break extended',
          body: `Added ${additionalMinutes} min within today’s cap.`,
          tone: 'info',
        }),
      onError: (err) =>
        Alert.alert(
          'Could not extend break',
          formatDutyError(err, 'Daily or single-break limit reached.')
        ),
    });
  };

  const onLeaveHub = () => {
    const heading =
      dutyStatus === 'on_way_to_hub' && !duty.data?.hub?.checkedInAt;
    if (heading) {
      setDutyStatus.mutate(
        { dutyStatus: 'online' },
        {
          onSuccess: () =>
            pushLiveToast({
              title: 'Back online',
              body: 'You’ll receive nearby orders again.',
              tone: 'success',
            }),
          onError: (err) =>
            Alert.alert(
              'Could not go online',
              formatDutyError(err, 'Please try again.')
            ),
        }
      );
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
          setDutyStatus.mutate(
            { dutyStatus: 'online' },
            {
              onSuccess: () =>
                pushLiveToast({
                  title: 'Back online',
                  body: 'You’ll receive nearby orders again.',
                  tone: 'success',
                }),
              onError: (onlineErr) =>
                Alert.alert(
                  'Could not go online',
                  formatDutyError(onlineErr, 'Please try again.')
                ),
            }
          );
          return;
        }
        Alert.alert(
          'Could not check out',
          formatDutyError(err, 'Please try again.')
        );
      },
    });
  };

  const onConfirmLiveLocation = async (result: MapPickResult) => {
    setConfirmingLocation(true);
    try {
      await saveHome.mutateAsync({
        latitude: result.lat,
        longitude: result.lng,
        address: result.label || result.formattedAddress,
      });
      try {
        await deliveryPartnerApi.pushLocation({
          latitude: result.lat,
          longitude: result.lng,
          timestamp: Date.now(),
        });
      } catch {
        // home location saved; ping may require being online
      }
      const saved: SavedLiveLocation = {
        label: result.label || result.formattedAddress,
        lat: result.lat,
        lng: result.lng,
      };
      setLiveLocation(saved);
      await AsyncStorage.setItem(
        LIVE_LOCATION_STORAGE_KEY,
        JSON.stringify(saved)
      );
      setMapOpen(false);
    } catch (err) {
      Alert.alert(
        'Could not save location',
        formatLocationError(err, getApiErrorMessage(err, 'Please try again.'))
      );
    } finally {
      setConfirmingLocation(false);
    }
  };

  const gpsAge = formatLocationAge(
    lastLocation.data?.updatedAt,
    lastLocation.data?.ageSeconds
  );
  const locationChip =
    liveLocation?.label ??
    (gpsSnap?.coords || lastLocation.data
      ? `Sharing GPS${gpsAge ? ` · ${gpsAge}` : ''}`
      : LIVE_LOCATION_FALLBACK);

  const gpsBanner = (() => {
    if (!isOnline || !gpsSnap) return null;
    if (gpsSnap.mockBlocked) {
      return LOCATION_ERROR_COPY.MOCK_LOCATION;
    }
    if (gpsSnap.offlineBlocked) {
      return LOCATION_ERROR_COPY.PARTNER_OFFLINE;
    }
    if (gpsSnap.stale) return 'Location outdated — stay in open sky.';
    if (gpsSnap.lowAccuracy) {
      return 'Move to open sky / better GPS.';
    }
    if (gpsSnap.locationRequired) {
      return LOCATION_ERROR_COPY.LOCATION_REQUIRED;
    }
    return null;
  })();

  if (me.isError && !me.data) {
    return (
      <View style={[styles.root, styles.centered, { padding: 24, gap: 12 }]}>
        <Text style={{ fontFamily: fonts.semiBold, color: authTheme.text }}>
          Couldn’t load your duty profile.
        </Text>
        <Pressable onPress={() => void me.refetch()}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator color={authTheme.brand} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingBottom:
              PARTNER_BOTTOM_NAV_INSET + Math.max(insets.bottom, 8),
          },
        ]}
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
        <View style={[styles.darkHeader, { paddingTop: insets.top + 48 }]}>
          {/* Top Row */}
          <View style={styles.dhTopRow}>
            <Pressable
              onPress={() => setMapOpen(true)}
              style={styles.dhLocation}
              accessibilityRole="button"
              accessibilityLabel="Set live location"
            >
              <Text style={styles.dhLocLabel}>Live Location</Text>
              <View style={styles.dhLocRow}>
                <MapPin color="#EA4B14" size={16} />
                <Text style={styles.dhLocText} numberOfLines={1}>
                  {locationChip}
                </Text>
              </View>
            </Pressable>
            <View style={styles.dhActions}>
              <Pressable onPress={() => router.push(DELIVERY_ROUTES.profile)}>
                {me.data?.photoUrl ? (
                  <Image source={{ uri: me.data.photoUrl }} style={styles.dhAvatar} />
                ) : (
                  <View style={styles.dhAvatarFallback}>
                    <Text style={styles.dhAvatarText}>{displayName.charAt(0)}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable style={styles.dhBell} onPress={() => router.push(DELIVERY_ROUTES.notifications)}>
                <Bell color="#FFFFFF" size={18} />
                <View style={styles.dhBellDot} />
              </Pressable>
            </View>
          </View>

          {/* Status Pill */}
          <DutyControlCard
            snapshot={duty.data}
            fallbackStatus={dutyStatus}
            isOnDuty={isOnline}
            summary={dutySummary.data}
            policy={breakPolicy.data}
            statusLoading={duty.isLoading}
            statusError={
              duty.isError
                ? formatDutyError(duty.error, 'Could not load duty status.')
                : null
            }
            onRetryStatus={() => void duty.refetch()}
            togglePending={setOnline.isPending}
            breakBusy={breakBusy}
            resumeBusy={checkOutHub.isPending || setDutyStatus.isPending}
            onToggle={onToggleOnline}
            onStartBreak={onStartBreak}
            onEndBreak={onEndBreak}
            onExtendBreak={onExtendBreak}
            onLeaveHub={onLeaveHub}
            onOpenHubs={() => router.push(DELIVERY_ROUTES.hubs as never)}
            gpsBanner={gpsBanner}
            actionError={
              setOnline.isError
                ? formatGoOnlineError(setOnline.error, 'Could not update status')
                : null
            }
            summaryError={
              dutySummary.isError && !dutySummary.data
                ? formatDutyError(
                    dutySummary.error,
                    'Could not load today’s duty summary.'
                  )
                : null
            }
            onRetrySummary={() => void dutySummary.refetch()}
          />

          {/* Earning & Profile Bottom */}
          <View style={styles.dhBottomRow}>
            <View style={styles.dhEarnCol}>
              <Text style={styles.dhEarnLabel}>Today's Earning</Text>
              <Text style={styles.dhEarnAmount}>{formatCurrency(todayEarnings, currency)}</Text>
              <Text style={styles.dhName}>{displayName}</Text>
            </View>
            <View style={styles.dhGraphic}>
              <Image source={require('../../../public/scooter.png')} style={styles.scooterImg} resizeMode="contain" />
            </View>
          </View>
        </View>

        {delivery ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Active trip</Text>
            <Pressable
              onPress={() => router.push(DELIVERY_ROUTES.orders)}
              style={styles.activeCard}
            >
              <View style={styles.activeTop}>
                <View>
                  <Text style={styles.activeCardLabel}>Order</Text>
                  <Text style={styles.activeCardValue}>
                    #{delivery.orderNumber || delivery.orderId || delivery.id.slice(-6)}
                  </Text>
                </View>
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>
                    {deliveryStatusLabel(delivery.status)}
                  </Text>
                </View>
              </View>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: '55%' }]} />
              </View>

              <View style={styles.activeBottom}>
                <View style={{ flex: 1.2 }}>
                  <Text style={styles.activeCardLabel}>From</Text>
                  <Text style={styles.activeCardValue} numberOfLines={1}>
                    {delivery.restaurantName || 'Restaurant'}
                  </Text>
                </View>
                <View style={{ flex: 1.2 }}>
                  <Text style={styles.activeCardLabel}>To</Text>
                  <Text style={styles.activeCardValue} numberOfLines={1}>
                    {delivery.customerName || 'Customer'}
                  </Text>
                </View>
                <View style={{ flex: 1.6 }}>
                  <Text style={styles.activeCardLabel}>ETA</Text>
                  <Text style={styles.activeCardValue} numberOfLines={1}>
                    {delivery.etaMinutes != null
                      ? `${delivery.etaMinutes} min`
                      : 'Open map'}
                  </Text>
                </View>
              </View>
            </Pressable>
          </View>
        ) : acceptingOrders ? (
          <View style={styles.section}>
            <Pressable
              onPress={() => router.push(DELIVERY_ROUTES.heatmap as never)}
              style={styles.demandCta}
            >
              <Flame color={authTheme.brand} size={18} />
              <View style={{ flex: 1 }}>
                <Text style={styles.demandCtaTitle}>Find orders</Text>
                <Text style={styles.demandCtaHint}>
                  See nearby demand heatmap while you wait
                </Text>
              </View>
              <ChevronRight color={authTheme.textMuted} size={18} />
            </Pressable>
          </View>
        ) : null}



        {/* Key stats — performance API */}
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{totalDeliveries}</Text>
            <Text style={styles.statLabel}>Deliveries</Text>
          </View>
          <View style={styles.stat}>
            <View style={styles.statValueRow}>
              <Star color="#D97706" size={13} fill="#FBBF24" />
              <Text style={styles.statValue}>{formatRating(avgRating)}</Text>
            </View>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {formatPercent(completionRate)}
            </Text>
            <Text style={styles.statLabel}>Completion</Text>
          </View>
        </View>

        {/* Performance */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Performance</Text>
          <View style={styles.card}>
            <View style={styles.perfGrid}>
              <View style={styles.perfItem}>
                <Text style={styles.perfValue}>
                  {formatPercent(acceptanceRate)}
                </Text>
                <Text style={styles.perfLabel}>Acceptance</Text>
              </View>
              <View style={styles.perfItem}>
                <Text style={styles.perfValue}>
                  {formatPercent(completionRate)}
                </Text>
                <Text style={styles.perfLabel}>Completion</Text>
              </View>
              <View style={styles.perfItem}>
                <Text style={styles.perfValue}>
                  {formatPercent(onTimeRate)}
                </Text>
                <Text style={styles.perfLabel}>On-time</Text>
              </View>
              <View style={styles.perfItem}>
                <Text style={styles.perfValue}>
                  {streak}d
                </Text>
                <Text style={styles.perfLabel}>Streak</Text>
              </View>
            </View>
          </View>
        </View>

        {/* History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delivery history</Text>

          <View style={styles.recentList}>
            {history.isLoading && !recent.length ? (
              <View style={[styles.orderCard, { justifyContent: 'center' }]}>
                <ActivityIndicator color={authTheme.brand} />
              </View>
            ) : recent.length ? (
              recent.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => router.push(DELIVERY_ROUTES.orders)}
                  style={styles.orderCard}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.listLabel} numberOfLines={1}>
                      Order #{item.orderNumber || '7620937'}
                    </Text>
                    <Text style={styles.listTitle} numberOfLines={1}>
                      From {item.restaurantName || 'Paris'} to {item.customerName || 'Berlin'}
                    </Text>
                  </View>
                  <View style={styles.orderStatusPill}>
                    <Text style={styles.orderStatusText}>
                      {deliveryStatusLabel(item.status)}
                    </Text>
                  </View>
                </Pressable>
              ))
            ) : (
              <View style={[styles.orderCard, { justifyContent: 'center', flexDirection: 'column' }]}>
                <Package color={authTheme.textDim} size={26} />
                <Text style={styles.emptyText}>No deliveries yet</Text>
              </View>
            )}
          </View>
        </View>

        {/* Services */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Services</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.moreScroll}
          >
            {MORE_FEATURES.map((item) => {
              const Icon = item.icon;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => router.push(item.href)}
                  style={styles.moreCard}
                >
                  <View style={styles.moreIcon}>
                    <Icon color="#EA4B14" size={24} strokeWidth={1.5} />
                  </View>
                  <Text style={styles.moreLabel}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>

      <LocationMapPicker
        visible={mapOpen}
        initial={
          liveLocation
            ? { lat: liveLocation.lat, lng: liveLocation.lng }
            : null
        }
        autoDetectOnOpen
        locationTitle="HOME / LIVE LOCATION"
        currentLocationHint="Saved as home base for heatmap if GPS is off"
        onClose={() => {
          if (!confirmingLocation) setMapOpen(false);
        }}
        onConfirm={(result) => {
          void onConfirmLiveLocation(result);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  darkHeader: {
    marginHorizontal: -16,
    marginTop: -40,
    marginBottom: 16,
    backgroundColor: '#121212',
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    paddingHorizontal: 24,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  dhTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  dhLocation: {
    flex: 1,
  },
  dhLocLabel: {
    color: '#9CA3AF',
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  dhLocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingRight: 8,
  },
  dhLocText: {
    flex: 1,
    minWidth: 0,
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  dhActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dhAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  dhAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dhAvatarText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  dhBell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dhBellDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EA4B14',
  },
  dhStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#262626',
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
  },
  dhStatusInfo: {
    flex: 1,
  },
  dhStatusLabel: {
    color: '#9CA3AF',
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  dhStatusText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 16,
    marginTop: 4,
  },
  dhBreakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3F3F46',
    borderRadius: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  dhBreakBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.semiBold,
    fontSize: 14,
  },
  dhBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  dhEarnCol: {
    flex: 1,
  },
  dhEarnLabel: {
    color: '#9CA3AF',
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  dhEarnAmount: {
    color: '#EA4B14',
    fontFamily: fonts.extraBold,
    fontSize: 42,
    letterSpacing: -1.5,
    marginVertical: 4,
  },
  dhName: {
    color: '#FFFFFF',
    fontFamily: fonts.semiBold,
    fontSize: 20,
    marginTop: 4,
  },
  dhGraphic: {
    width: 140,
    height: 140,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    position: 'relative',
  },
  scooterImg: {
    width: '120%',
    height: '120%',
    position: 'absolute',
    bottom: -20,
    right: -20,
  },
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  heroBleed: {
    marginHorizontal: -16,
    marginBottom: -8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 6,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  searchLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchText: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: '#6B7280',
  },
  scanBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EA4B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillContainer: {
    backgroundColor: '#EA4B14',
    borderRadius: 32,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#EA4B14',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  statusInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusPillTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#000000',
  },
  statusPillSub: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#000000',
    opacity: 0.7,
    marginTop: 2,
  },
  statusBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  statusBtnText: {
    color: '#000000',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  cardSub: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  kycBlock: {
    marginTop: 12,
    gap: 8,
  },
  kycTrack: {
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  kycFill: {
    height: '100%',
    backgroundColor: authTheme.brand,
    borderRadius: 999,
  },
  link: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.brand,
  },
  error: {
    marginTop: 8,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.error,
  },
  gpsBanner: {
    marginTop: 4,
    marginBottom: 10,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#FDBA74',
    lineHeight: 17,
  },
  demandCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FED7AA',
  },
  demandCtaTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  demandCtaHint: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  activeCard: {
    backgroundColor: '#EA4B14',
    borderRadius: 24,
    padding: 20,
    overflow: 'hidden',
    shadowColor: '#EA4B14',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  activeTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  activeCardLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  activeCardValue: {
    marginTop: 4,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#000000',
  },
  activeBadge: {
    backgroundColor: '#000000',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  activeBadgeText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 3,
    marginVertical: 24,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#000000',
    borderRadius: 3,
  },
  activeBottom: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modernEarnCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  modernEarnTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  modernEarnIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modernEarnBottom: {},
  modernEarnValue: {
    fontFamily: fonts.bold,
    fontSize: 36,
    color: '#EA4B14',
    letterSpacing: -1,
  },
  modernEarnLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 4,
  },
  earnCard: {
    backgroundColor: '#EA4B14',
    borderRadius: 24,
    padding: 20,
  },
  earnTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  earnLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#374151',
  },
  earnValue: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 28,
    color: '#000000',
    letterSpacing: -0.6,
  },
  trendPill: {
    backgroundColor: '#000000',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  trendText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
  },
  section: {
    gap: 8,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: '#374151',
    marginBottom: 4,
  },
  perfGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  perfItem: {
    width: '50%',
    paddingVertical: 10,
    paddingHorizontal: 6,
    gap: 4,
  },
  perfValue: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: authTheme.text,
  },
  perfLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  listLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
  },
  listTitle: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: '#000000',
  },
  recentList: {
    gap: 12,
  },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  orderStatusPill: {
    backgroundColor: '#FFF7ED',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  orderStatusText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#EA4B14',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  moreScroll: {
    gap: 12,
  },
  moreCard: {
    minWidth: 116,
    paddingHorizontal: 12,
    height: 110,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  moreIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
  },
  moreLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#000000',
    textAlign: 'center',
  },
});
