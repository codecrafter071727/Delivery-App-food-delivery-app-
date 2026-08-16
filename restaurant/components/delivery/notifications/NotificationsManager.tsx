import { useRouter } from 'expo-router';
import {
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeliveryNotificationRow } from '@/components/delivery/notifications/NotificationRow';
import { useDeliveryHeaderScrollProps } from '@/components/delivery/shared/header-scroll';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { getApiErrorMessage } from '@/lib/errors';
import {
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import {
  useClearAllNotifications,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '@/lib/notification/hooks';
import {
  isNotificationAllowed,
  loadNotificationPreferences,
  saveNotificationPreferences,
} from '@/lib/notification/preferences';
import type {
  AppNotification,
  NotificationPreferenceKey,
  NotificationPreferences,
} from '@/lib/notification/types';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_META,
} from '@/lib/notification/types';

type Filter = 'all' | 'unread';

function openNotificationDeepLink(
  router: ReturnType<typeof useRouter>,
  item: AppNotification
) {
  const data = item.data ?? {};
  const orderId = String(
    data.orderId ?? data.order_id ?? data.order ?? data.deliveryId ?? ''
  ).trim();

  if (orderId) {
    router.push(DELIVERY_ROUTES.orders as never);
    return;
  }

  const t = item.type.toLowerCase();
  if (t.includes('earn') || t.includes('pay') || t.includes('payout')) {
    router.push(DELIVERY_ROUTES.earnings as never);
    return;
  }
  if (t.includes('support')) {
    router.push(DELIVERY_ROUTES.support as never);
  }
}

function StatCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

export function PartnerNotificationsManager() {
  const insets = useSafeAreaInsets();
  const headerScroll = useDeliveryHeaderScrollProps();
  const isActive = useAppIsActive();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES
  );
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadNotificationPreferences().then((loaded) => {
      if (!mounted) return;
      setPrefs(loaded);
      setPrefsReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const listQuery = useNotifications(
    { page: 1, limit: 50 },
    {
      // Live while this screen is open — no pull-to-refresh needed
      refetchInterval: liveRefetchInterval(15_000, isActive),
    }
  );
  const unreadCount = useUnreadNotificationCount({
    refetchInterval: liveRefetchInterval(15_000, isActive),
  });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const deleteOne = useDeleteNotification();
  const clearAll = useClearAllNotifications();

  const rawNotifications = listQuery.data?.notifications ?? [];
  const notifications = useMemo(() => {
    const allowed = rawNotifications.filter((n) =>
      isNotificationAllowed(n, prefs)
    );
    if (filter === 'unread') {
      return allowed.filter((n) => !n.isRead);
    }
    return allowed;
  }, [rawNotifications, prefs, filter]);

  const totalFromApi =
    listQuery.data?.meta?.total ?? rawNotifications.length;
  const unread =
    unreadCount.data ??
    rawNotifications.filter(
      (n) => !n.isRead && isNotificationAllowed(n, prefs)
    ).length;
  const statusLabel = unread > 0 ? `${unread} pending` : 'All caught up';

  const loading = listQuery.isLoading && !listQuery.data;
  const error =
    listQuery.isError && !listQuery.data
      ? getApiErrorMessage(listQuery.error, 'Could not load notifications.')
      : null;

  const onRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([listQuery.refetch(), unreadCount.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  }, [listQuery, unreadCount]);

  const togglePreference = async (key: NotificationPreferenceKey) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    try {
      await saveNotificationPreferences(next);
    } catch {
      setPrefs(prefs);
      Alert.alert('Could not save', 'Preference was not saved. Try again.');
    }
  };

  const onOpen = (item: AppNotification) => {
    if (!item.isRead) {
      markRead.mutate(item.id, {
        onError: (err) =>
          Alert.alert(
            'Could not mark read',
            getApiErrorMessage(err, 'Please try again.')
          ),
      });
    }
    openNotificationDeepLink(router, item);
  };

  const onDelete = (item: AppNotification) => {
    Alert.alert('Delete notification?', item.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteOne.mutate(item.id, {
            onError: (err) =>
              Alert.alert(
                'Delete failed',
                getApiErrorMessage(err, 'Please try again.')
              ),
          }),
      },
    ]);
  };

  const onMarkAll = () => {
    if (unread <= 0) return;
    markAllRead.mutate(undefined, {
      onError: (err) =>
        Alert.alert(
          'Could not mark all read',
          getApiErrorMessage(err, 'Please try again.')
        ),
    });
  };

  const onClearAll = () => {
    if (rawNotifications.length === 0) return;
    Alert.alert(
      'Clear all notifications?',
      'This permanently removes every notification from your inbox.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: () =>
            clearAll.mutate(undefined, {
              onError: (err) =>
                Alert.alert(
                  'Clear failed',
                  getApiErrorMessage(err, 'Please try again.')
                ),
            }),
        },
      ]
    );
  };

  return (
    <View style={[styles.root, { paddingTop: headerScroll.contentInsetTop }]}>
      <View style={styles.actionStrip}>
        <Text style={styles.actionHint}>
          {unread > 0 ? `${unread} unread` : 'All caught up'}
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerBtn}
            onPress={onMarkAll}
            disabled={unread <= 0 || markAllRead.isPending}
            hitSlop={6}
          >
            {markAllRead.isPending ? (
              <ActivityIndicator color={authTheme.brand} size="small" />
            ) : (
              <CheckCheck
                color={unread > 0 ? authTheme.brand : authTheme.textDim}
                size={18}
              />
            )}
          </Pressable>
          <Pressable
            style={styles.headerBtn}
            onPress={onClearAll}
            disabled={rawNotifications.length === 0 || clearAll.isPending}
            hitSlop={6}
          >
            {clearAll.isPending ? (
              <ActivityIndicator color={authTheme.brand} size="small" />
            ) : (
              <Trash2
                color={
                  rawNotifications.length > 0
                    ? authTheme.brand
                    : authTheme.textDim
                }
                size={18}
              />
            )}
          </Pressable>
        </View>
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
        <View style={styles.statsRow}>
          <StatCard
            label="Total"
            value={String(totalFromApi)}
          />
          <StatCard
            label="Unread"
            value={String(unread)}
            valueColor={unread > 0 ? authTheme.brand : undefined}
          />
          <StatCard
            label="Status"
            value={statusLabel}
            valueColor={unread > 0 ? '#D97706' : authTheme.success}
          />
        </View>

        <View style={styles.filterRow}>
          <View style={styles.filterTrack}>
            <Pressable
              onPress={() => setFilter('all')}
              style={styles.filterHit}
            >
              <View
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      filter === 'all' ? authTheme.brand : 'transparent',
                  },
                ]}
              >
                <Text
                  style={{
                    color: filter === 'all' ? '#FFFFFF' : authTheme.text,
                    fontFamily:
                      filter === 'all' ? fonts.bold : fonts.semiBold,
                    fontSize: 13,
                  }}
                >
                  All
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => setFilter('unread')}
              style={styles.filterHit}
            >
              <View
                style={[
                  styles.filterPill,
                  {
                    backgroundColor:
                      filter === 'unread' ? authTheme.brand : 'transparent',
                  },
                ]}
              >
                <Text
                  style={{
                    color: filter === 'unread' ? '#FFFFFF' : authTheme.text,
                    fontFamily:
                      filter === 'unread' ? fonts.bold : fonts.semiBold,
                    fontSize: 13,
                  }}
                >
                  Unread{unread > 0 ? ` (${unread})` : ''}
                </Text>
              </View>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
            <Text style={styles.muted}>Loading notifications…</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn’t load notifications</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.emptyCard}>
            {filter === 'unread' ? (
              <BellOff color={authTheme.textDim} size={40} />
            ) : (
              <Bell color={authTheme.textDim} size={40} />
            )}
            <Text style={styles.emptyTitle}>
              {filter === 'unread'
                ? 'No unread notifications'
                : 'No notifications yet'}
            </Text>
            <Text style={styles.muted}>
              {filter === 'unread'
                ? "You're all caught up!"
                : 'Order alerts, earnings, and announcements will show here.'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {notifications.map((item) => (
              <DeliveryNotificationRow
                key={item.id}
                notification={item}
                onPress={() => onOpen(item)}
                onDelete={() => onDelete(item)}
              />
            ))}
            <Text style={styles.hint}>Long-press a notification to delete</Text>
          </View>
        )}

        <View style={styles.prefsCard}>
          <View style={styles.prefsHeader}>
            <Bell color={authTheme.brand} size={16} />
            <Text style={styles.prefsTitle}>Notification Preferences</Text>
          </View>
          <Text style={styles.prefsSubtitle}>
            Choose what you want alerts for. Off categories stay out of the
            inbox and the phone notification tray. Saved on this device.
          </Text>

          {!prefsReady ? (
            <ActivityIndicator color={authTheme.brand} style={{ marginTop: 12 }} />
          ) : (
            NOTIFICATION_PREFERENCE_META.map((item, index) => {
              const enabled = prefs[item.key];
              return (
                <View
                  key={item.key}
                  style={[
                    styles.prefRow,
                    index < NOTIFICATION_PREFERENCE_META.length - 1 &&
                      styles.prefRowBorder,
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.prefLabel}>{item.label}</Text>
                    <Text style={styles.prefDesc}>{item.description}</Text>
                  </View>
                  <View style={styles.prefRight}>
                    <Text
                      style={[
                        styles.prefState,
                        { color: enabled ? authTheme.brand : authTheme.textDim },
                      ]}
                    >
                      {enabled ? 'On' : 'Off'}
                    </Text>
                    <Switch
                      value={enabled}
                      onValueChange={() => void togglePreference(item.key)}
                      trackColor={{
                        false: '#CBD5E1',
                        true: 'rgba(122, 14, 34, 0.35)',
                      }}
                      thumbColor={enabled ? authTheme.brand : '#F8FAFC'}
                      ios_backgroundColor="#CBD5E1"
                    />
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authTheme.surface,
  },
  actionStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: authTheme.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  actionHint: {
    color: authTheme.textMuted,
    fontFamily: fonts.semiBold,
    fontSize: 13,
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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brandSoft,
  },
  scrollView: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statCard: {
    flex: 1,
    backgroundColor: authTheme.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 12,
    minHeight: 72,
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
    marginBottom: 6,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  filterRow: {
    marginTop: 2,
  },
  filterTrack: {
    flexDirection: 'row',
    backgroundColor: authTheme.tabBg,
    borderRadius: 12,
    padding: 4,
  },
  filterHit: {
    flex: 1,
  },
  filterPill: {
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  muted: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyCard: {
    backgroundColor: authTheme.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
    marginTop: 4,
  },
  list: {
    gap: 10,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    color: authTheme.textDim,
    textAlign: 'center',
    marginTop: 4,
  },
  prefsCard: {
    backgroundColor: authTheme.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    marginTop: 4,
  },
  prefsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  prefsTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  prefsSubtitle: {
    marginTop: 4,
    marginBottom: 4,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  prefRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  prefLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  prefDesc: {
    marginTop: 2,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  prefRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  prefState: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    minWidth: 24,
    textAlign: 'right',
  },
  retryBtn: {
    marginTop: 8,
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
