import { Bell, BellOff } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { DeliveryNotificationRow } from '@/components/delivery/notifications/NotificationRow';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  useClearAllNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useDeleteNotification,
} from '@/lib/notification/hooks';
import { useKitchenInbox } from '@/lib/restaurant/inbox-hooks';
import type { AppNotification } from '@/lib/notification/types';

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
  const [filter, setFilter] = useState<Filter>('all');
  const inbox = useKitchenInbox({
    page: 1,
    limit: 30,
    unread: filter === 'unread' ? true : undefined,
  });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const clearAll = useClearAllNotifications();
  const remove = useDeleteNotification();

  const items = useMemo(
    () => inbox.data?.notifications ?? [],
    [inbox.data?.notifications]
  );
  const unread = Math.max(0, inbox.unreadCount);

  const onRefresh = useCallback(async () => {
    await inbox.refetch();
  }, [inbox]);

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
});
