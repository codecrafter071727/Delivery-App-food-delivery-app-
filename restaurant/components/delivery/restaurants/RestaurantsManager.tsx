import { useRouter } from 'expo-router';
import {
  Eye,
  MapPin,
  MessageCircle,
  Phone,
  Power,
  Star,
  TrendingUp,
  Wifi,
} from 'lucide-react-native';
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
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { usePartnerDutyStatus } from '@/lib/delivery-partner/availability-hooks';
import { isDutySwitchOn } from '@/lib/delivery-partner/availability-types';
import {
  formatGoOnlineError,
  getGoOnlineBlocker,
} from '@/lib/delivery-partner/go-online-guard';
import {
  useDeliveryOrderMutations,
  useDeliveryPartnerMe,
} from '@/lib/delivery-partner/hooks';
import {
  formatDistanceKm,
  formatLastOrder,
  formatRestaurantRating,
  isRestaurantActive,
} from '@/lib/delivery-partner/restaurants-api';
import { usePartnerRestaurants } from '@/lib/delivery-partner/restaurants-hooks';
import type { PartnerRestaurant } from '@/lib/delivery-partner/restaurants-types';
import { getApiErrorMessage } from '@/lib/errors';

function callPhone(phone?: string) {
  if (!phone) return;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return;
  void Linking.openURL(`tel:${digits}`);
}

function openChat(phone?: string) {
  if (!phone) {
    Alert.alert('Chat unavailable', 'No contact number for this restaurant.');
    return;
  }
  const digits = phone.replace(/[^\d]/g, '');
  if (!digits) {
    Alert.alert('Chat unavailable', 'No contact number for this restaurant.');
    return;
  }
  void Linking.openURL(`sms:${digits}`);
}

function openMenu(restaurant: PartnerRestaurant) {
  if (restaurant.menuUrl) {
    void Linking.openURL(restaurant.menuUrl);
    return;
  }
  Alert.alert(
    'Menu unavailable',
    'This restaurant has not shared a menu link yet.'
  );
}

function SummaryCard({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: string;
  subtitle: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <View style={styles.summaryValueRow}>
        <Text style={styles.summaryValue}>{value}</Text>
        {accent ? <Star color="#F59E0B" size={14} fill="#F59E0B" /> : null}
      </View>
      <Text style={styles.summarySub}>{subtitle}</Text>
    </View>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCell}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function RestaurantCard({ restaurant }: { restaurant: PartnerRestaurant }) {
  const active = isRestaurantActive(restaurant.status);
  const tags = [
    ...(restaurant.tags ?? []),
    ...(restaurant.cuisine ?? []),
  ].filter((tag, index, arr) => arr.indexOf(tag) === index);
  const distance = formatDistanceKm(restaurant.distanceKm);
  const rating = formatRestaurantRating(restaurant.rating);
  const lastOrder = formatLastOrder(
    restaurant.lastOrderAt,
    restaurant.lastOrderLabel
  );
  const dailyOrders = restaurant.dailyOrdersLabel;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {restaurant.name}
          </Text>
          {restaurant.location ? (
            <View style={styles.locationRow}>
              <MapPin color={authTheme.textMuted} size={13} />
              <Text style={styles.locationText} numberOfLines={1}>
                {restaurant.location}
              </Text>
            </View>
          ) : null}
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: active ? '#DCFCE7' : '#F1F5F9',
            },
          ]}
        >
          <Text
            style={{
              color: active ? '#15803D' : authTheme.textMuted,
              fontFamily: fonts.semiBold,
              fontSize: 11,
            }}
          >
            {active ? 'Active' : restaurant.status || 'Inactive'}
          </Text>
        </View>
      </View>

      {(distance || dailyOrders || rating || lastOrder) ? (
        <View style={styles.metricsBox}>
          <View style={styles.metricsRow}>
            <MetricCell label="Distance" value={distance ?? '—'} />
            <MetricCell label="Daily Orders" value={dailyOrders ?? '—'} />
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>Rating</Text>
              <View style={styles.ratingRow}>
                <Text style={styles.metricValue}>{rating ?? '—'}</Text>
                {rating ? (
                  <Star color="#F59E0B" size={12} fill="#F59E0B" />
                ) : null}
              </View>
            </View>
            <MetricCell label="Last Order" value={lastOrder ?? '—'} />
          </View>
        </View>
      ) : null}

      {tags.length ? (
        <View style={styles.tagsRow}>
          {tags.slice(0, 4).map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {restaurant.phone ? (
        <Pressable
          onPress={() => callPhone(restaurant.phone)}
          style={styles.phoneRow}
        >
          <Phone color={authTheme.brand} size={14} />
          <Text style={styles.phoneText}>{restaurant.phone}</Text>
        </Pressable>
      ) : null}

      <View style={styles.actionsRow}>
        <Pressable
          onPress={() => openChat(restaurant.phone)}
          style={styles.chatHit}
        >
          <View style={styles.chatBtn}>
            <MessageCircle color={authTheme.text} size={15} />
            <Text style={styles.chatText}>Chat</Text>
          </View>
        </Pressable>
        <Pressable onPress={() => openMenu(restaurant)} style={styles.menuHit}>
          <View style={styles.menuBtn}>
            <Eye color="#FFFFFF" size={15} />
            <Text style={styles.menuText}>Menu</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export function PartnerRestaurantsManager() {
  const router = useRouter();
  const headerScroll = useDeliveryHeaderScrollProps();
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [busyOnline, setBusyOnline] = useState(false);

  const me = useDeliveryPartnerMe();
  const duty = usePartnerDutyStatus();
  const restaurantsQuery = usePartnerRestaurants();
  const mutations = useDeliveryOrderMutations();

  const dutyStatus = duty.data?.dutyStatus ?? me.data?.dutyStatus;
  const isOnline = isDutySwitchOn(
    dutyStatus,
    Boolean(me.data?.isOnline ?? me.data?.isAvailable ?? duty.data?.isOnline)
  );
  const onDelivery = dutyStatus === 'on_delivery';
  const goOnlineBlocker = getGoOnlineBlocker(me.data);
  const data = restaurantsQuery.data;
  const restaurants = data?.restaurants ?? [];
  const summary = data?.summary;
  const topPerformers = data?.topPerformers ?? [];

  const loading = restaurantsQuery.isLoading && !data;
  const error =
    restaurantsQuery.error && !data
      ? getApiErrorMessage(
          restaurantsQuery.error,
          'Could not load partner restaurants.'
        )
      : null;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        restaurantsQuery.refetch(),
        me.refetch(),
        duty.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const handleToggleOnline = async () => {
    const next = !isOnline;
    if (onDelivery && isOnline) {
      Alert.alert(
        'Active delivery',
        'Complete your active delivery before going offline.'
      );
      return;
    }
    if (next && goOnlineBlocker) {
      Alert.alert(goOnlineBlocker.title, goOnlineBlocker.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: goOnlineBlocker.actionLabel,
          onPress: () => router.push(goOnlineBlocker.actionHref as never),
        },
      ]);
      return;
    }

    setBusyOnline(true);
    try {
      await mutations.setOnline.mutateAsync(next);
    } catch (err) {
      Alert.alert(
        'Could not go online',
        formatGoOnlineError(err, 'Could not update online status.')
      );
    } finally {
      setBusyOnline(false);
    }
  };

  const totalLabel =
    summary?.totalRestaurants != null
      ? String(summary.totalRestaurants)
      : restaurants.length
        ? String(restaurants.length)
        : '—';
  const activeSub =
    summary?.activeRestaurants != null
      ? `${summary.activeRestaurants} active`
      : 'From partnerships';
  const avgOrders =
    summary?.avgDailyOrdersLabel ??
    (summary?.avgDailyOrders != null
      ? String(Math.round(summary.avgDailyOrders))
      : '—');
  const avgRating =
    formatRestaurantRating(summary?.avgRating) ?? '—';

  return (
    <View style={[styles.root, { paddingTop: headerScroll.contentInsetTop }]}>
      <View style={styles.actionStrip}>
        <View
          style={[
            styles.liveBadge,
            {
              backgroundColor: isOnline ? '#DCFCE7' : '#F1F5F9',
            },
          ]}
        >
          <Wifi
            color={isOnline ? '#15803D' : authTheme.textMuted}
            size={13}
          />
          <Text
            style={{
              color: isOnline ? '#15803D' : authTheme.textMuted,
              fontFamily: fonts.semiBold,
              fontSize: 11,
            }}
          >
            {isOnline ? 'Live' : 'Offline'}
          </Text>
        </View>
        <Pressable
          onPress={() => void handleToggleOnline()}
          disabled={busyOnline || mutations.setOnline.isPending}
          style={styles.powerHit}
        >
          <View
            style={[
              styles.powerBtn,
              {
                backgroundColor: isOnline
                  ? authTheme.brand
                  : authTheme.success,
              },
            ]}
          >
            {busyOnline || mutations.setOnline.isPending ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Power color="#FFFFFF" size={16} />
            )}
          </View>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16 },
        ]}
        onScroll={headerScroll.onScroll}
        scrollEventThrottle={headerScroll.scrollEventThrottle}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
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
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
            <Text style={styles.muted}>Loading restaurants…</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.cardTitle}>Couldn’t load restaurants</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.summaryRow}>
              <SummaryCard
                label="Total Restaurants"
                value={totalLabel}
                subtitle={activeSub}
              />
              <SummaryCard
                label="Avg Daily Orders"
                value={avgOrders}
                subtitle="Across all restaurants"
              />
              <SummaryCard
                label="Avg Restaurant Rating"
                value={avgRating}
                subtitle="Partner satisfaction"
                accent={avgRating !== '—'}
              />
            </View>

            <Text style={styles.sectionTitle}>All Partnerships</Text>
            {restaurants.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.cardTitle}>No restaurants yet</Text>
                <Text style={styles.muted}>
                  Partner restaurants will appear here when the delivery
                  service assigns outlets to you.
                </Text>
              </View>
            ) : (
              restaurants.map((restaurant) => (
                <RestaurantCard key={restaurant.id} restaurant={restaurant} />
              ))
            )}

            {topPerformers.length > 0 ? (
              <View style={styles.topBox}>
                <View style={styles.topHeader}>
                  <TrendingUp color={authTheme.success} size={16} />
                  <Text style={styles.topTitle}>Top Performing Partners</Text>
                </View>
                {topPerformers.map((item) => {
                  const rating = formatRestaurantRating(item.rating);
                  const orders =
                    item.dailyOrdersLabel != null
                      ? `${item.dailyOrdersLabel} orders/day`
                      : item.ordersCount != null
                        ? `${item.ordersCount} orders`
                        : undefined;
                  return (
                    <View key={`top-${item.id}`} style={styles.topRow}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={styles.topName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {orders ? (
                          <Text style={styles.topSub}>{orders}</Text>
                        ) : null}
                      </View>
                      {rating ? (
                        <View style={styles.topRating}>
                          <View style={styles.ratingRow}>
                            <Text style={styles.topRatingValue}>{rating}</Text>
                            <Star color="#F59E0B" size={12} fill="#F59E0B" />
                          </View>
                          <Text style={styles.topRatingLabel}>Avg rating</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authTheme.surface,
  },
  scrollView: {
    flex: 1,
  },
  actionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: authTheme.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: authTheme.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  kicker: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: authTheme.brand,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: authTheme.text,
    marginTop: 2,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
  },
  powerHit: {
    borderRadius: 999,
  },
  powerBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 10,
  },
  muted: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: authTheme.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    padding: 16,
    minHeight: 104,
  },
  summaryLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: authTheme.textMuted,
    marginBottom: 6,
  },
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryValue: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: authTheme.text,
  },
  summarySub: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: authTheme.textDim,
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
    marginTop: 4,
  },
  card: {
    backgroundColor: authTheme.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    padding: 16,
    gap: 12,
  },
  emptyCard: {
    backgroundColor: authTheme.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    padding: 24,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  locationText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  metricsBox: {
    backgroundColor: authTheme.bgSoft,
    borderRadius: 16,
    padding: 12,
    gap: 12,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metricCell: {
    flex: 1,
  },
  metricLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: authTheme.textDim,
    marginBottom: 2,
  },
  metricValue: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    backgroundColor: authTheme.brandSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tagText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: authTheme.brand,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phoneText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.text,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  chatHit: {
    flex: 1,
  },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    backgroundColor: authTheme.bgSoft,
  },
  chatText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
  menuHit: {
    flex: 1,
  },
  menuBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
  },
  menuText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  topBox: {
    backgroundColor: authTheme.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    padding: 16,
    gap: 12,
    marginTop: 4,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  topName: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  topSub: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: authTheme.textMuted,
    marginTop: 2,
  },
  topRating: {
    alignItems: 'flex-end',
  },
  topRatingValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  topRatingLabel: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: authTheme.textDim,
    marginTop: 2,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: authTheme.brand,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
});
