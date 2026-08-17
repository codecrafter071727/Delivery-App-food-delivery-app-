import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  ChefHat,
  ClipboardList,
  Clock3,
  History,
  Inbox,
  LayoutGrid,
  Package,
  RefreshCw,
  Timer,
} from 'lucide-react-native';

import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import {
  AcceptPrepSheet,
  RejectOrderSheet,
} from '@/components/orders/KitchenActionSheets';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { OwnerOrder } from '@/lib/dashboard/types';
import { formatOrderTime } from '@/lib/dashboard/format';
import { getApiErrorMessage } from '@/lib/errors';
import {
  hardRefreshRestaurantOrders,
  restaurantOrderKeys,
  useKitchenKds,
  useKitchenTicketMutations,
  useMyRestaurantId,
  useOrderHistory,
  useRejectReasons,
  useRestaurantOrders,
  useScheduledOrders,
  useUpdateRestaurantOrderStatus,
} from '@/lib/order/hooks';
import type { RestaurantOrderAction } from '@/lib/order/owner-api';
import {
  canReject,
  displayStatus,
  money,
  nextKitchenAction,
  kitchenHandoverCopy,
  rejectBlockedReason,
  resolveOrderTotal,
  shortOrderId,
  statusTone,
  type KitchenTicketAction,
} from '@/lib/order/ui';

type BoardTab = 'board' | 'incoming' | 'scheduled' | 'history';
type HistoryRange = 'today' | '7d' | '30d';
type IncomingFilter = 'all' | 'pending' | 'preparing' | 'ready' | 'cancelled';

const TABS: { key: BoardTab; label: string; Icon: typeof LayoutGrid }[] = [
  { key: 'board', label: 'Board', Icon: LayoutGrid },
  { key: 'incoming', label: 'Incoming', Icon: Inbox },
  { key: 'scheduled', label: 'Scheduled', Icon: CalendarClock },
  { key: 'history', label: 'History', Icon: History },
];

const INCOMING_FILTERS: { key: IncomingFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'New' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'cancelled', label: 'Cancelled' },
];

function ymdIST(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function historyRange(preset: HistoryRange): { from: string; to: string } {
  const to = ymdIST();
  if (preset === 'today') return { from: to, to };
  const days = preset === '7d' ? 6 : 29;
  return { from: ymdIST(new Date(Date.now() - days * 86_400_000)), to };
}

function ticketItems(order: OwnerOrder) {
  if (order.items.length) {
    const head = order.items
      .slice(0, 2)
      .map((item) => `${item.quantity}× ${item.name}`)
      .join(', ');
    const more = order.items.length > 2 ? ` +${order.items.length - 2}` : '';
    return head + more;
  }
  if (order.itemCount) {
    return `${order.itemCount} item${order.itemCount === 1 ? '' : 's'}`;
  }
  return 'Tap for details';
}

function formatSlot(iso?: string) {
  if (!iso) return 'Scheduled';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Scheduled';
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function acceptWindow(iso?: string) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'Accept overdue';
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  return mins === 1 ? '1 min to accept' : `${mins} min to accept`;
}

function incomingMatches(order: OwnerOrder, filter: IncomingFilter) {
  if (filter === 'all') return true;
  if (filter === 'pending') {
    return (
      order.status === 'pending' ||
      order.status === 'placed' ||
      order.status === 'pending_payment'
    );
  }
  if (filter === 'preparing') {
    return order.status === 'accepted' || order.status === 'preparing';
  }
  if (filter === 'cancelled') {
    return order.status === 'cancelled' || order.status === 'rejected';
  }
  return order.status === filter;
}

export function KitchenOrdersManager() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<BoardTab>('board');
  const [incomingFilter, setIncomingFilter] = useState<IncomingFilter>('pending');
  const [historyPreset, setHistoryPreset] = useState<HistoryRange>('today');
  const [rejecting, setRejecting] = useState<OwnerOrder | null>(null);
  const [accepting, setAccepting] = useState<OwnerOrder | null>(null);
  const [hardRefreshing, setHardRefreshing] = useState(false);

  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id;
  const range = useMemo(() => historyRange(historyPreset), [historyPreset]);

  const kdsQuery = useKitchenKds(restaurantId, {
    enabled: tab === 'board',
  });
  const ordersQuery = useRestaurantOrders(restaurantId);
  const scheduledQuery = useScheduledOrders(restaurantId, {
    enabled: tab === 'scheduled',
  });
  const historyQuery = useOrderHistory(restaurantId, range, {
    enabled: tab === 'history',
  });
  const reasonsQuery = useRejectReasons(restaurantId);
  const updateStatus = useUpdateRestaurantOrderStatus(restaurantId);
  const ticket = useKitchenTicketMutations(restaurantId);
  const laneBusy = updateStatus.isPending || ticket.isPending;

  const board = kdsQuery.data ?? {
    new: [] as OwnerOrder[],
    preparing: [] as OwnerOrder[],
    ready: [] as OwnerOrder[],
    delayed: [] as OwnerOrder[],
  };
  const incoming = ordersQuery.data ?? [];
  const scheduled = scheduledQuery.data ?? [];
  const historyOrders = (historyQuery.data?.pages ?? []).flatMap(
    (page) => page.orders
  );
  const visibleIncoming = incoming.filter((order) =>
    incomingMatches(order, incomingFilter)
  );
  const reasons = reasonsQuery.data ?? [];

  const activeQuery =
    tab === 'board'
      ? kdsQuery
      : tab === 'incoming'
        ? ordersQuery
        : tab === 'scheduled'
          ? scheduledQuery
          : historyQuery;

  async function refreshBoard() {
    if (!restaurantId) {
      void restaurantQuery.refetch();
      return;
    }
    setHardRefreshing(true);
    try {
      const fresh = await hardRefreshRestaurantOrders(restaurantId);
      queryClient.setQueryData(restaurantOrderKeys.list(restaurantId), fresh);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: restaurantOrderKeys.kds(restaurantId),
        }),
        queryClient.invalidateQueries({
          queryKey: restaurantOrderKeys.scheduled(restaurantId),
        }),
        queryClient.invalidateQueries({
          queryKey: restaurantOrderKeys.history(
            restaurantId,
            range.from,
            range.to
          ),
        }),
      ]);
    } catch (error) {
      Alert.alert('Could not refresh orders', getApiErrorMessage(error));
    } finally {
      setHardRefreshing(false);
    }
  }

  async function runAction(
    order: OwnerOrder,
    action: RestaurantOrderAction,
    payload?: { prepTime?: number; reasonCode?: string; note?: string }
  ) {
    if (action === 'accept' && payload?.prepTime == null) {
      setAccepting(order);
      return;
    }
    if (action === 'reject') {
      const blocked = rejectBlockedReason(order);
      if (blocked) {
        Alert.alert('Cannot reject yet', blocked);
        return;
      }
    }
    try {
      await updateStatus.mutateAsync({
        orderId: order.id,
        action,
        prepTime: payload?.prepTime,
        reasonCode: payload?.reasonCode,
        note: payload?.note,
      });
      setRejecting(null);
      setAccepting(null);
      if (action === 'ready' && order.fulfillmentTone === 'delivery') {
        router.push(`/order/${encodeURIComponent(order.id)}`);
      }
    } catch (error) {
      Alert.alert('Could not update order', getApiErrorMessage(error));
    }
  }

  async function handleTicketAction(
    order: OwnerOrder,
    action: KitchenTicketAction
  ) {
    if (action.kind === 'pickup-ready') {
      try {
        await ticket.pickupReady.mutateAsync(order.id);
        router.push(`/order/${encodeURIComponent(order.id)}`);
      } catch (error) {
        Alert.alert('Could not mark pickup ready', getApiErrorMessage(error));
      }
      return;
    }
    if (action.kind === 'complete-takeaway') {
      try {
        await ticket.completeTakeaway.mutateAsync(order.id);
      } catch (error) {
        Alert.alert('Could not complete takeaway', getApiErrorMessage(error));
      }
      return;
    }
    if (action.kind === 'handover') {
      try {
        const result = await ticket.handToRider.mutateAsync(order.id);
        const copy = kitchenHandoverCopy(
          result.outcome,
          result.handover.message
        );
        if (result.outcome === 'need_otp' || result.outcome === 'waiting') {
          Alert.alert(copy.title, copy.body);
          router.push(`/order/${encodeURIComponent(order.id)}`);
          return;
        }
        Alert.alert(copy.title, copy.body);
      } catch (error) {
        Alert.alert('Could not hand to rider', getApiErrorMessage(error));
      }
      return;
    }
    await runAction(order, action.action);
  }

  function openReject(order: OwnerOrder) {
    setRejecting(order);
  }

  function openOrder(order: OwnerOrder) {
    queryClient.setQueryData(
      restaurantOrderKeys.detail(restaurantId ?? '', order.id),
      order
    );
    router.push(`/order/${encodeURIComponent(order.id)}`);
  }

  const waitingForRestaurant =
    restaurantQuery.isPending && !restaurantQuery.data;
  const waitingForTab =
    Boolean(restaurantId) &&
    activeQuery.isPending &&
    !activeQuery.isFetched &&
    !activeQuery.data;
  const initialLoading = waitingForRestaurant || waitingForTab;
  const noRestaurant =
    !waitingForRestaurant && !restaurantId && !restaurantQuery.error;
  const loadError =
    restaurantQuery.error ??
    (tab === 'board'
      ? kdsQuery.error
      : tab === 'incoming'
        ? ordersQuery.error
        : tab === 'scheduled'
          ? scheduledQuery.error
          : historyQuery.error);
  const refreshing = hardRefreshing || activeQuery.isRefetching;
  const boardCount = board.new.length + board.preparing.length + board.ready.length;

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Orders"
        subtitle={restaurantQuery.data?.name || 'Kitchen board'}
        headerRight={
          <Pressable
            accessibilityLabel="Refresh orders"
            disabled={refreshing || !restaurantId}
            onPress={() => void refreshBoard()}
            style={styles.refreshBtn}
          >
            {refreshing ? (
              <ActivityIndicator color={authTheme.text} size="small" />
            ) : (
              <RefreshCw color={authTheme.text} size={18} strokeWidth={2.4} />
            )}
          </Pressable>
        }
      >
        <View style={styles.tabs}>
          {TABS.map((item) => {
            const active = tab === item.key;
            const Icon = item.Icon;
            const count =
              item.key === 'board'
                ? board.new.length
                : item.key === 'incoming'
                  ? incoming.filter((order) => incomingMatches(order, 'pending'))
                      .length
                  : item.key === 'scheduled'
                    ? scheduled.length
                    : historyQuery.data?.pages[0]?.total;
            return (
              <Pressable
                key={item.key}
                onPress={() => setTab(item.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Icon
                  color={active ? authTheme.brand : authTheme.textMuted}
                  size={14}
                  strokeWidth={2.2}
                />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {item.label}
                </Text>
                {typeof count === 'number' && count > 0 ? (
                  <View style={[styles.tabBadge, active && styles.tabBadgeActive]}>
                    <Text
                      style={[
                        styles.tabCount,
                        active && styles.tabCountActive,
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </RestaurantPageHeader>

      {initialLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={authTheme.brand} size="large" />
          <Text style={styles.muted}>Loading kitchen orders…</Text>
        </View>
      ) : noRestaurant ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Restaurant not found</Text>
          <Text style={styles.muted}>
            Complete restaurant setup first, then open Orders again.
          </Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => router.push('/restaurant-setup')}
          >
            <Text style={styles.primaryBtnText}>Open setup</Text>
          </Pressable>
        </View>
      ) : loadError && !activeQuery.data ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn’t load orders</Text>
          <Text style={styles.muted}>{getApiErrorMessage(loadError)}</Text>
          <Pressable
            style={styles.primaryBtn}
            onPress={() => {
              void restaurantQuery.refetch();
              void activeQuery.refetch();
            }}
          >
            <Text style={styles.primaryBtnText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.listFlex}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refreshBoard()}
              tintColor={authTheme.brand}
              colors={[authTheme.brand]}
            />
          }
        >
          {tab === 'board' ? (
            <>
              {boardCount === 0 && board.delayed.length === 0 ? (
                <EmptyState
                  title="Kitchen is clear"
                  body="New orders land in New. Preparing and Ready update live."
                />
              ) : null}
              <Lane
                title="New"
                tone="new"
                count={board.new.length}
                empty="No new orders"
                orders={board.new}
                busy={laneBusy}
                onOpen={openOrder}
                onAction={handleTicketAction}
                onReject={openReject}
              />
              <Lane
                title="Preparing"
                tone="prep"
                count={board.preparing.length}
                empty="Nothing cooking"
                orders={board.preparing}
                busy={laneBusy}
                onOpen={openOrder}
                onAction={handleTicketAction}
                onReject={openReject}
              />
              <Lane
                title="Ready"
                tone="ready"
                count={board.ready.length}
                empty="No packed orders"
                orders={board.ready}
                busy={laneBusy}
                onOpen={openOrder}
                onAction={handleTicketAction}
                onReject={openReject}
              />
              <Lane
                title="Delayed"
                tone="late"
                count={board.delayed.length}
                empty="No late orders"
                orders={board.delayed}
                busy={laneBusy}
                onOpen={openOrder}
                onAction={handleTicketAction}
                onReject={openReject}
              />
            </>
          ) : null}

          {tab === 'incoming' ? (
            <>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterRow}
              >
                {INCOMING_FILTERS.map((item) => {
                  const active = incomingFilter === item.key;
                  const count = incoming.filter((order) =>
                    incomingMatches(order, item.key)
                  ).length;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setIncomingFilter(item.key)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        style={[styles.chipText, active && styles.chipTextActive]}
                      >
                        {item.label}
                      </Text>
                      <Text
                        style={[
                          styles.chipCount,
                          active && styles.chipCountActive,
                        ]}
                      >
                        {count}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {visibleIncoming.length === 0 ? (
                <EmptyState
                  title="No incoming orders"
                  body="New tickets appear here to accept or reject."
                />
              ) : (
                visibleIncoming.map((order) => (
                  <OrderTicket
                    key={order.id}
                    order={order}
                    busy={laneBusy}
                    onOpen={() => openOrder(order)}
                    onAction={(action) => void handleTicketAction(order, action)}
                    onReject={() => openReject(order)}
                  />
                ))
              )}
            </>
          ) : null}

          {tab === 'scheduled' ? (
            scheduled.length === 0 ? (
              <EmptyState
                title="No scheduled orders"
                body="Pre-orders show here with the slot time until they are due."
              />
            ) : (
              scheduled.map((order) => (
                <OrderTicket
                  key={order.id}
                  order={order}
                  scheduled
                  busy={laneBusy}
                  onOpen={() => openOrder(order)}
                  onAction={(action) => void handleTicketAction(order, action)}
                  onReject={() => openReject(order)}
                />
              ))
            )
          ) : null}

          {tab === 'history' ? (
            <>
              <View style={styles.filterRow}>
                {(
                  [
                    { key: 'today' as const, label: 'Today' },
                    { key: '7d' as const, label: '7 days' },
                    { key: '30d' as const, label: '30 days' },
                  ]
                ).map((item) => {
                  const active = historyPreset === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setHistoryPreset(item.key)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Text
                        style={[styles.chipText, active && styles.chipTextActive]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {historyOrders.length === 0 ? (
                <EmptyState
                  title="No past orders"
                  body="Completed and cancelled orders for this date range show here."
                />
              ) : (
                historyOrders.map((order) => (
                  <OrderTicket
                    key={order.id}
                    order={order}
                    history
                    busy={false}
                    onOpen={() => openOrder(order)}
                  />
                ))
              )}
              {historyQuery.hasNextPage ? (
                <Pressable
                  style={styles.loadMore}
                  disabled={historyQuery.isFetchingNextPage}
                  onPress={() => void historyQuery.fetchNextPage()}
                >
                  {historyQuery.isFetchingNextPage ? (
                    <ActivityIndicator color={authTheme.brand} size="small" />
                  ) : (
                    <Text style={styles.loadMoreText}>Load more</Text>
                  )}
                </Pressable>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      )}

      <AcceptPrepSheet
        key={accepting?.id ?? 'accept'}
        visible={Boolean(accepting)}
        order={accepting}
        busy={updateStatus.isPending}
        onClose={() => setAccepting(null)}
        onConfirm={(prepTime) => {
          if (accepting) void runAction(accepting, 'accept', { prepTime });
        }}
      />
      <RejectOrderSheet
        key={rejecting?.id ?? 'reject'}
        visible={Boolean(rejecting)}
        order={rejecting}
        reasons={reasons}
        reasonsError={reasonsQuery.error}
        busy={updateStatus.isPending}
        onClose={() => setRejecting(null)}
        onConfirm={(reasonCode, note) => {
          if (rejecting) {
            void runAction(rejecting, 'reject', { reasonCode, note });
          }
        }}
      />
    </View>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <ClipboardList color={authTheme.textDim} size={26} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.muted}>{body}</Text>
    </View>
  );
}

function Lane({
  title,
  tone,
  count,
  empty,
  orders,
  busy,
  onOpen,
  onAction,
  onReject,
}: {
  title: string;
  tone: 'new' | 'prep' | 'ready' | 'late';
  count: number;
  empty: string;
  orders: OwnerOrder[];
  busy: boolean;
  onOpen: (order: OwnerOrder) => void;
  onAction: (order: OwnerOrder, action: KitchenTicketAction) => void;
  onReject: (order: OwnerOrder) => void;
}) {
  return (
    <View style={styles.lane}>
      <View style={styles.laneHead}>
        <View style={[styles.laneDot, LANE_DOT[tone]]} />
        <Text style={styles.laneTitle}>{title}</Text>
        <View style={styles.laneCount}>
          <Text style={styles.laneCountText}>{count}</Text>
        </View>
      </View>
      {orders.length === 0 ? (
        <Text style={styles.laneEmpty}>{empty}</Text>
      ) : (
        orders.map((order) => (
          <OrderTicket
            key={`${tone}-${order.id}`}
            order={order}
            busy={busy}
            onOpen={() => onOpen(order)}
            onAction={(action) => onAction(order, action)}
            onReject={() => onReject(order)}
          />
        ))
      )}
    </View>
  );
}

function OrderTicket({
  order,
  busy,
  scheduled,
  history,
  onOpen,
  onAction,
  onReject,
}: {
  order: OwnerOrder;
  busy: boolean;
  scheduled?: boolean;
  history?: boolean;
  onOpen: () => void;
  onAction?: (action: KitchenTicketAction) => void;
  onReject?: () => void;
}) {
  const tone = statusTone(order.status);
  const action = history ? null : nextKitchenAction(order);
  const ActionIcon = action?.Icon;
  const windowLabel = acceptWindow(order.acceptBy);
  const showReject = Boolean(onReject && canReject(order) && !history);

  return (
    <Pressable onPress={onOpen} style={styles.ticket}>
      <View style={styles.ticketTop}>
        <View style={styles.iconBox}>
          {scheduled ? (
            <CalendarClock color="#64748B" size={20} strokeWidth={2} />
          ) : order.isDelayed ? (
            <Timer color="#DC2626" size={20} strokeWidth={2} />
          ) : (
            <Package color="#64748B" size={20} strokeWidth={2} />
          )}
        </View>
        <View style={styles.ticketMid}>
          <Text style={styles.ticketId}>#{shortOrderId(order).toUpperCase()}</Text>
          <Text style={styles.ticketMeta} numberOfLines={1}>
            {order.customerName
              ? `${order.customerName} · ${ticketItems(order)}`
              : ticketItems(order)}
          </Text>
          {scheduled ? (
            <Text style={styles.slotText}>{formatSlot(order.scheduledFor)}</Text>
          ) : (
            <Text style={styles.ticketTime}>
              {windowLabel && canReject(order)
                ? windowLabel
                : formatOrderTime(order.createdAt)}
              {order.fulfillmentLabel ? ` · ${order.fulfillmentLabel}` : ''}
            </Text>
          )}
        </View>
        <View style={styles.ticketRight}>
          <Text style={styles.amount}>{money(resolveOrderTotal(order))}</Text>
          <View style={styles.statusRow}>
            {order.status === 'cancelled' || order.status === 'rejected' ? (
              <Ban color={tone.color} size={12} strokeWidth={3} />
            ) : order.status === 'delivered' ? (
              <CheckCircle2 color={tone.color} size={12} strokeWidth={3} />
            ) : order.status === 'preparing' ? (
              <ChefHat color={tone.color} size={12} strokeWidth={3} />
            ) : order.isDelayed ? (
              <Clock3 color="#DC2626" size={12} strokeWidth={3} />
            ) : null}
            <Text
              style={[
                styles.statusText,
                { color: order.isDelayed ? '#DC2626' : tone.color },
              ]}
            >
              {order.isDelayed && order.delayMinutes
                ? `Late +${order.delayMinutes}m`
                : displayStatus(order.status)}
            </Text>
          </View>
        </View>
      </View>

      {showReject || action ? (
        <View style={styles.actions}>
          {showReject ? (
            <Pressable
              disabled={busy}
              onPress={(event) => {
                event.stopPropagation();
                onReject?.();
              }}
              style={[styles.actionBtn, styles.rejectBtn]}
            >
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
          ) : null}
          {action ? (
            <Pressable
              disabled={busy}
              onPress={(event) => {
                event.stopPropagation();
                onAction?.(action);
              }}
              style={styles.actionBtn}
            >
              {ActionIcon ? <ActionIcon color={authTheme.brand} size={14} /> : null}
              <Text style={styles.acceptText}>{action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

const LANE_DOT: Record<'new' | 'prep' | 'ready' | 'late', { backgroundColor: string }> = {
  new: { backgroundColor: authTheme.brand },
  prep: { backgroundColor: '#EA580C' },
  ready: { backgroundColor: '#059669' },
  late: { backgroundColor: '#DC2626' },
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  refreshBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 10,
    backgroundColor: '#F8FAFC',
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: authTheme.brand,
  },
  tabText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  tabTextActive: {
    color: authTheme.brand,
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 6,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
  },
  tabBadgeActive: {
    backgroundColor: authTheme.brandSoft,
  },
  tabCount: {
    fontFamily: fonts.bold,
    fontSize: 10,
    color: authTheme.textMuted,
  },
  tabCountActive: {
    color: authTheme.brand,
  },
  listFlex: {
    flex: 1,
  },
  list: {
    padding: 16,
    paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
    gap: 10,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
  },
  chipActive: {
    borderColor: authTheme.brand,
    backgroundColor: '#FFFFFF',
  },
  chipText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  chipTextActive: {
    color: authTheme.brand,
  },
  chipCount: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: authTheme.textDim,
  },
  chipCountActive: {
    color: authTheme.brand,
  },
  lane: {
    gap: 8,
    marginBottom: 8,
  },
  laneHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  laneDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  laneTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: authTheme.text,
    flex: 1,
  },
  laneCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
  },
  laneCountText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: authTheme.textMuted,
  },
  laneEmpty: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textDim,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  ticket: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  ticketTop: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  ticketMid: {
    flex: 1,
  },
  ticketId: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  ticketMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    marginTop: 2,
  },
  ticketTime: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textDim,
    marginTop: 2,
  },
  slotText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: authTheme.brand,
    marginTop: 4,
  },
  ticketRight: {
    alignItems: 'flex-end',
  },
  amount: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  statusText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  rejectBtn: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: authTheme.cardBorder,
  },
  rejectText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  acceptText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.brand,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 36,
    paddingHorizontal: 24,
    gap: 6,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    marginBottom: 6,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  errorHint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.error,
    textAlign: 'left',
  },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  loadMore: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
  },
  loadMoreText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.brand,
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  dialogTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: authTheme.text,
  },
  reasonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reasonChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: authTheme.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  reasonChipOn: {
    backgroundColor: authTheme.brandSoft,
    borderColor: authTheme.brand,
  },
  reasonChipText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  reasonChipTextOn: {
    color: authTheme.brand,
  },
  reasonInput: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 12,
    textAlignVertical: 'top',
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  dialogCancel: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  dialogCancelText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.textMuted,
  },
  dialogConfirm: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.error,
  },
  dialogConfirmText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
});
