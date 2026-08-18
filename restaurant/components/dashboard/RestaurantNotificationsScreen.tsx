import { Bell, BellOff } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
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

import { DeliveryNotificationRow } from '@/components/delivery/notifications/NotificationRow';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import {
  useClearAllNotifications,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationChannelPreferences,
  useNotificationDevices,
  useUnreadNotificationCount,
  useUpdateNotificationChannelPreferences,
} from '@/lib/notification/hooks';
import { getApiErrorMessage } from '@/lib/errors';
import { useKitchenInbox } from '@/lib/restaurant/inbox-hooks';
import type {
  AppNotification,
  NotificationChannelPreferences,
} from '@/lib/notification/types';
import { useAuthStore } from '@/store/auth-store';

type Filter = 'all' | 'unread';

function openNotificationDeepLink(
  router: ReturnType<typeof useRouter>,
  item: AppNotification
) {
  const data = item.data ?? {};
  const orderId = String(
    data.orderId ?? data.order_id ?? data.order ?? ''
  ).trim();
  if (orderId) {
    router.push(`/order/${encodeURIComponent(orderId)}`);
    return;
  }
  const t = item.type.toLowerCase();
  if (t.includes('order') || t.includes('kitchen')) {
    router.replace('/orders');
    return;
  }
  if (t.includes('review') || t.includes('rating')) {
    router.push('/reviews');
    return;
  }
  if (t.includes('payout') || t.includes('settle') || t.includes('invoice')) {
    router.push('/payouts');
    return;
  }
  if (t.includes('support') || t.includes('ticket')) {
    router.push('/support');
    return;
  }
  if (t.includes('offer') || t.includes('promo')) {
    router.replace('/offers');
  }
}

export function RestaurantNotificationsScreen() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const isActive = useAppIsActive();
  const [filter, setFilter] = useState<Filter>('all');
  const inbox = useKitchenInbox({
    page: 1,
    limit: 30,
    unread: filter === 'unread' ? true : undefined,
  });
  const unreadQuery = useUnreadNotificationCount({
    enabled: Boolean(token),
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.notifications, isActive),
  });
  const channelPrefs = useNotificationChannelPreferences(Boolean(token));
  const updateChannels = useUpdateNotificationChannelPreferences();
  const devices = useNotificationDevices(Boolean(token));
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const clearAll = useClearAllNotifications();
  const remove = useDeleteNotification();

  const items = useMemo(
    () => inbox.data?.notifications ?? [],
    [inbox.data?.notifications]
  );
  const unread = Math.max(0, unreadQuery.data ?? inbox.unreadCount);

  const onRefresh = useCallback(async () => {
    await Promise.all([
      inbox.refetch(),
      unreadQuery.refetch(),
      channelPrefs.refetch(),
      devices.refetch(),
    ]);
  }, [inbox, unreadQuery, channelPrefs, devices]);

  const patchChannel = async (
    key: keyof NotificationChannelPreferences,
    value: boolean
  ) => {
    const current = channelPrefs.data;
    if (!current) return;
    try {
      await updateChannels.mutateAsync({ ...current, [key]: value });
    } catch (error) {
      Alert.alert(
        'Could not save',
        getApiErrorMessage(error, 'Try again.')
      );
    }
  };

  const openItem = useCallback(
    (item: AppNotification) => {
      if (!item.isRead) void markRead.mutateAsync(item.id);
      openNotificationDeepLink(router, item);
    },
    [markRead, router]
  );

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        showBack
      />

      {unread > 0 || items.length > 0 ? (
        <View style={styles.actions}>
          {unread > 0 ? (
            <Pressable
              onPress={() => void markAll.mutateAsync()}
              style={styles.actionChip}
            >
              <Text style={styles.actionText}>Mark all read</Text>
            </Pressable>
          ) : null}
          {items.length > 0 ? (
            <Pressable
              onPress={() => void clearAll.mutateAsync()}
              style={styles.actionChip}
            >
              <Text style={styles.actionText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.filters}>
        {(['all', 'unread'] as const).map((key) => {
          const active = filter === key;
          return (
            <Pressable
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text
                style={[styles.filterText, active && styles.filterTextActive]}
              >
                {key === 'all' ? 'All' : 'Unread'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={inbox.isRefetching}
            onRefresh={() => void onRefresh()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {inbox.isLoading && !inbox.data ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : null}

        {inbox.isError ? (
          <View style={styles.empty}>
            <BellOff color={authTheme.textDim} size={32} />
            <Text style={styles.emptyTitle}>Couldn’t load inbox</Text>
            <Text style={styles.muted}>
              {inbox.error instanceof Error
                ? inbox.error.message
                : 'Try again in a moment'}
            </Text>
            <Pressable style={styles.retry} onPress={() => void inbox.refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!inbox.isLoading && !inbox.isError && items.length === 0 ? (
          <View style={styles.empty}>
            <Bell color={authTheme.textDim} size={32} />
            <Text style={styles.emptyTitle}>
              {filter === 'unread' ? 'No unread alerts' : 'No notifications yet'}
            </Text>
            <Text style={styles.muted}>
              New orders, reviews, and payouts will show up here.
            </Text>
          </View>
        ) : null}

        {items.map((item) => (
          <DeliveryNotificationRow
            key={item.id}
            notification={item}
            onPress={() => openItem(item)}
            onDelete={() => void remove.mutateAsync(item.id)}
          />
        ))}

        <View style={styles.prefsCard}>
          <Text style={styles.prefsTitle}>Channel prefs</Text>
          <Text style={styles.muted}>
            Notification-service push / SMS / email. Account-level toggles are in
            Admin → Your account.
          </Text>
          {channelPrefs.isLoading && !channelPrefs.data ? (
            <ActivityIndicator color={authTheme.brand} />
          ) : channelPrefs.isError && !channelPrefs.data ? (
            <Pressable onPress={() => void channelPrefs.refetch()}>
              <Text style={styles.retryTextInline}>
                {getApiErrorMessage(channelPrefs.error, 'Could not load prefs. Retry')}
              </Text>
            </Pressable>
          ) : (
            (
              [
                ['ordersPush', 'Order push'],
                ['offersPush', 'Offer push'],
                ['promoPush', 'Promo push'],
                ['sms', 'SMS'],
                ['whatsapp', 'WhatsApp'],
                ['email', 'Email'],
              ] as const
            ).map(([key, label]) => (
              <View key={key} style={styles.prefRow}>
                <Text style={styles.prefLabel}>{label}</Text>
                <Switch
                  value={channelPrefs.data?.[key] ?? false}
                  onValueChange={(next) => void patchChannel(key, next)}
                  disabled={updateChannels.isPending}
                  trackColor={{ false: '#E2E8F0', true: 'rgba(122,14,34,0.35)' }}
                  thumbColor={
                    channelPrefs.data?.[key] ? authTheme.brand : '#F8FAFC'
                  }
                />
              </View>
            ))
          )}
        </View>

        <View style={styles.prefsCard}>
          <Text style={styles.prefsTitle}>Push devices</Text>
          {devices.isLoading && !devices.data ? (
            <ActivityIndicator color={authTheme.brand} />
          ) : devices.isError && !devices.data ? (
            <Pressable onPress={() => void devices.refetch()}>
              <Text style={styles.retryTextInline}>
                {getApiErrorMessage(devices.error, 'Could not load devices. Retry')}
              </Text>
            </Pressable>
          ) : (devices.data ?? []).length === 0 ? (
            <Text style={styles.muted}>
              No FCM/APNs token yet. Enable alerts in Settings → Operations.
            </Text>
          ) : (
            (devices.data ?? []).map((row) => (
              <Text key={row.deviceId} style={styles.deviceLine}>
                {(row.app || row.platform || 'device') +
                  (row.tokenMasked ? ` · ${row.tokenMasked}` : '')}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  filters: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  actionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: authTheme.surface,
  },
  actionText: {
    color: authTheme.brand,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: authTheme.surface,
  },
  filterChipActive: { backgroundColor: authTheme.brand },
  filterText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  filterTextActive: { color: '#FFFFFF' },
  content: { paddingHorizontal: 16, gap: 8 },
  center: { paddingVertical: 48, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 8, paddingHorizontal: 24 },
  emptyTitle: { color: authTheme.text, fontSize: 16, fontFamily: fonts.bold },
  muted: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
    lineHeight: 18,
  },
  retry: {
    marginTop: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: fonts.bold },
  retryTextInline: {
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  prefsCard: {
    marginTop: 8,
    padding: 14,
    borderRadius: 16,
    backgroundColor: authTheme.surface,
    gap: 8,
  },
  prefsTitle: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  prefLabel: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  deviceLine: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
});
