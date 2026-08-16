import {
  BarChart3,
  Download,
  RefreshCcw,
  ShoppingCart,
  Star,
  UtensilsCrossed,
  Wallet,
} from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  CategoryPieChart,
  HourDemandChart,
  RevenueTrendChart,
} from '@/components/analytics/AnalyticsCharts';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  resolveAnalyticsRange,
  restaurantAnalyticsApi,
  shareAnalyticsCsv,
} from '@/lib/analytics/api';
import {
  useAnalyticsCancellations,
  useAnalyticsOrders,
  useAnalyticsOverview,
  useAnalyticsRevenue,
  useAnalyticsTopItems,
} from '@/lib/analytics/hooks';
import type { AnalyticsPeriod, OrdersStatusPoint } from '@/lib/analytics/types';
import { formatCurrency } from '@/lib/dashboard/format';

const PERIODS: { key: AnalyticsPeriod; label: string }[] = [
  { key: 'day', label: 'Today' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
];

const TOP_LIMITS = [5, 10] as const;

const STATUS_COLORS: Record<string, string> = {
  delivered: '#22C55E',
  preparing: '#F97316',
  accepted: '#38BDF8',
  ready: '#A855F7',
  picked_up: '#14B8A6',
  out_for_delivery: '#0EA5E9',
  placed: '#EAB308',
  rejected: '#EF4444',
  cancelled: '#F43F5E',
};

function formatRangeLabel(from?: string, to?: string) {
  if (!from || !to) return 'Asia/Kolkata';
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${from} – ${to} · IST`;
  }
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const left = start.toLocaleDateString('en-IN', opts);
  const right = end.toLocaleDateString('en-IN', opts);
  return from === to ? `${left} · IST` : `${left} – ${right} · IST`;
}

function statusLabel(status: string) {
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function reasonLabel(code: string) {
  const map: Record<string, string> = {
    out_of_stock: 'Out of stock',
    too_busy: 'Kitchen busy',
    closed: 'Outlet closed',
    item_unavailable: 'Item unavailable',
    store_closed: 'Outlet closed',
    unknown: 'Other',
    customer: 'Customer',
    restaurant: 'Restaurant',
    system: 'System',
  };
  return map[code] ?? statusLabel(code);
}

function statusSlices(rows: OrdersStatusPoint[]) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows
    .filter((row) => row.count > 0)
    .map((row, index) => ({
      name: statusLabel(row.status),
      value: row.count,
      percent: total > 0 ? Math.round((row.count / total) * 100) : 0,
      color:
        STATUS_COLORS[row.status] ??
        ['#F97316', '#EF4444', '#38BDF8', '#A855F7', '#22C55E'][index % 5],
    }));
}

function MetricValue({
  value,
  format = 'number',
}: {
  value: number | null | undefined;
  format?: 'number' | 'money' | 'rating' | 'percent';
}) {
  if (value == null || !Number.isFinite(value)) {
    return <Text style={styles.metricValue}>—</Text>;
  }
  if (format === 'money') {
    return <Text style={styles.metricValue}>{formatCurrency(value)}</Text>;
  }
  if (format === 'rating') {
    return (
      <Text style={styles.metricValue}>
        {value.toFixed(1)}
        <Text style={styles.metricSuffix}> / 5</Text>
      </Text>
    );
  }
  if (format === 'percent') {
    return (
      <Text style={styles.metricValue}>
        {value.toFixed(1)}
        <Text style={styles.metricSuffix}>%</Text>
      </Text>
    );
  }
  return <Text style={styles.metricValue}>{Math.round(value)}</Text>;
}

function SectionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.emptyInline}>
      <Text style={styles.emptyText}>{message}</Text>
      <Pressable style={styles.retryBtn} onPress={onRetry}>
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

export function AnalyticsManager() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('week');
  const [topLimit, setTopLimit] = useState<(typeof TOP_LIMITS)[number]>(5);
  const [chartWidth, setChartWidth] = useState(0);
  const [exporting, setExporting] = useState(false);

  const overview = useAnalyticsOverview();
  const revenue = useAnalyticsRevenue(period);
  const topItems = useAnalyticsTopItems(topLimit);
  const orders = useAnalyticsOrders(period);
  const cancellations = useAnalyticsCancellations(period);
  const range = resolveAnalyticsRange(period);

  const restaurantName = overview.restaurantName || 'Your restaurant';
  const locationLabel = overview.restaurantCity;
  const restaurantId = overview.restaurantId;

  const refreshing =
    overview.isRefetching ||
    revenue.isRefetching ||
    topItems.isRefetching ||
    orders.isRefetching ||
    cancellations.isRefetching;

  const bootLoading =
    (overview.isLoading && !overview.data) ||
    (revenue.isLoading && !revenue.data) ||
    (orders.isLoading && !orders.data);

  const metricCards = [
    {
      key: 'today-orders',
      label: "Today's orders",
      value: overview.data?.ordersToday ?? null,
      format: 'number' as const,
      icon: ShoppingCart,
      tint: '#FFF1F2',
    },
    {
      key: 'today-revenue',
      label: "Today's sales",
      value: overview.data?.revenueToday ?? null,
      format: 'money' as const,
      icon: Wallet,
      tint: '#FFF7ED',
    },
    {
      key: 'orders',
      label: 'All-time orders',
      value: overview.data?.totalOrders ?? null,
      format: 'number' as const,
      icon: BarChart3,
      tint: '#EFF6FF',
    },
    {
      key: 'revenue',
      label: 'All-time sales',
      value: overview.data?.totalRevenue ?? null,
      format: 'money' as const,
      icon: Wallet,
      tint: '#F0FDF4',
    },
    {
      key: 'aov',
      label: 'Avg order value',
      value: overview.data?.avgOrderValue ?? null,
      format: 'money' as const,
      icon: Wallet,
      tint: '#F5F3FF',
    },
    {
      key: 'items',
      label: 'Live menu items',
      value: overview.data?.activeItems ?? null,
      format: 'number' as const,
      icon: UtensilsCrossed,
      tint: '#ECFDF5',
    },
  ];

  const revenuePoints = revenue.data?.points ?? [];
  const hasRevenueTrend = revenuePoints.some(
    (point) => point.revenue > 0 || point.orders > 0
  );
  const topList = topItems.data ?? [];
  const hourRows = orders.data?.byHour ?? [];
  const statusRows = orders.data?.byStatus ?? [];
  const slices = statusSlices(statusRows);
  const cancelTotals = cancellations.data?.totals;
  const peakHour = hourRows.reduce(
    (best, row) => (row.count > best.count ? row : best),
    hourRows[0] ?? { hour: 0, count: 0, revenue: 0 }
  );

  const onChartLayout = (event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next > 0 && next !== chartWidth) setChartWidth(next);
  };

  const refreshAll = async () => {
    await Promise.all([
      overview.refetch(),
      revenue.refetch(),
      topItems.refetch(),
      orders.refetch(),
      cancellations.refetch(),
    ]);
  };

  const exportCsv = async () => {
    if (!restaurantId) {
      Alert.alert('Restaurant not ready', 'Open Insights again after the outlet loads.');
      return;
    }
    setExporting(true);
    try {
      const file = await restaurantAnalyticsApi.exportOrdersCsv(restaurantId, {
        from: range.from,
        to: range.to,
      });
      await shareAnalyticsCsv(file.csv, file.filename);
      if (Platform.OS === 'web') {
        Alert.alert(
          'Export downloaded',
          `${file.filename} · ${file.rowCount} order${file.rowCount === 1 ? '' : 's'} (max 90 days).`
        );
      }
    } catch (error) {
      Alert.alert(
        'Export failed',
        error instanceof Error ? error.message : 'Could not download the CSV.'
      );
    } finally {
      setExporting(false);
    }
  };

  const overviewError =
    overview.error instanceof Error ? overview.error.message : null;
  const rangeLabel = formatRangeLabel(
    orders.data?.from || range.from,
    orders.data?.to || range.to
  );

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Insights"
        subtitle={
          locationLabel
            ? `${restaurantName} · ${locationLabel}`
            : restaurantName
        }
        showBack
        hideActions
        headerRight={
          <View style={styles.headerActions}>
            <Pressable
              style={styles.headerIconBtn}
              onPress={() => void exportCsv()}
              disabled={exporting || !restaurantId}
            >
              {exporting ? (
                <ActivityIndicator color={authTheme.brand} size="small" />
              ) : (
                <Download color={authTheme.text} size={18} strokeWidth={2.4} />
              )}
            </Pressable>
            <Pressable
              style={styles.headerIconBtn}
              onPress={() => void refreshAll()}
              disabled={refreshing}
            >
              {refreshing ? (
                <ActivityIndicator color={authTheme.text} size="small" />
              ) : (
                <RefreshCcw color={authTheme.text} size={18} strokeWidth={2.4} />
              )}
            </Pressable>
          </View>
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshAll()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.periodRow}>
          <View style={styles.periodGroup}>
            {PERIODS.map((item) => {
              const active = item.key === period;
              return (
                <Pressable
                  key={item.key}
                  onPress={() => setPeriod(item.key)}
                  style={[styles.periodChip, active && styles.periodChipActive]}
                >
                  <Text
                    style={[
                      styles.periodText,
                      active && styles.periodTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.rangeHint}>{rangeLabel}</Text>
        </View>

        {bootLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : null}

        {!bootLoading && overviewError && !overview.data ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn’t load insights</Text>
            <Text style={styles.emptyText}>{overviewError}</Text>
            <Pressable style={styles.retryBtn} onPress={() => void refreshAll()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!bootLoading ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.metricRow}
          >
            {metricCards.map((card) => {
              const Icon = card.icon;
              return (
                <View key={card.key} style={styles.metricCard}>
                  <View
                    style={[styles.metricIcon, { backgroundColor: card.tint }]}
                  >
                    <Icon color={authTheme.brand} size={16} strokeWidth={2.2} />
                  </View>
                  <Text style={styles.metricLabel}>{card.label}</Text>
                  <MetricValue value={card.value} format={card.format} />
                </View>
              );
            })}
          </ScrollView>
        ) : null}

        {!bootLoading ? (
          <View style={styles.bottomRow}>
            <View style={styles.bottomCard}>
              <View style={styles.bottomTop}>
                <Text style={styles.bottomLabel}>Customer rating</Text>
                <Star color="#D97706" size={16} fill="#FBBF24" />
              </View>
              <MetricValue
                value={overview.data?.avgRating ?? null}
                format="rating"
              />
              <Text style={styles.bottomCaption}>
                {overview.data?.totalRatings
                  ? `${overview.data.totalRatings} review${overview.data.totalRatings === 1 ? '' : 's'}`
                  : 'From listing reviews'}
              </Text>
            </View>
            <View style={styles.bottomCard}>
              <View style={styles.bottomTop}>
                <Text style={styles.bottomLabel}>Menu categories</Text>
                <UtensilsCrossed color={authTheme.brand} size={16} />
              </View>
              <MetricValue
                value={overview.data?.totalCategories ?? null}
                format="number"
              />
              <Text style={styles.bottomCaption}>On your live menu</Text>
            </View>
          </View>
        ) : null}

        {!bootLoading ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Revenue & orders</Text>
            <Text style={styles.panelCaption}>
              {period === 'day'
                ? 'Last 24 hours, by hour'
                : period === 'week'
                  ? 'Last 7 days'
                  : 'Last 30 days'}
            </Text>
            <View style={styles.chartBox} onLayout={onChartLayout}>
              {revenue.isError ? (
                <SectionError
                  message={
                    revenue.error instanceof Error
                      ? revenue.error.message
                      : 'Could not load the revenue trend.'
                  }
                  onRetry={() => void revenue.refetch()}
                />
              ) : hasRevenueTrend && chartWidth > 0 ? (
                <RevenueTrendChart points={revenuePoints} width={chartWidth} />
              ) : (
                <Text style={styles.emptyText}>
                  No paid orders in this range yet.
                </Text>
              )}
            </View>
          </View>
        ) : null}

        {!bootLoading ? (
          <View style={styles.panel}>
            <View style={styles.topHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.panelTitle}>Orders by hour</Text>
                <Text style={styles.panelCaption}>
                  {peakHour.count > 0
                    ? `Peak ${peakHour.hour % 12 === 0 ? 12 : peakHour.hour % 12}${peakHour.hour >= 12 ? 'pm' : 'am'} · ${peakHour.count} orders`
                    : 'When customers place orders'}
                </Text>
              </View>
            </View>
            {orders.isError ? (
              <SectionError
                message={
                  orders.error instanceof Error
                    ? orders.error.message
                    : 'Could not load hourly orders.'
                }
                onRetry={() => void orders.refetch()}
              />
            ) : (orders.data?.totals.orders ?? 0) > 0 ? (
              <HourDemandChart hours={hourRows} />
            ) : (
              <View style={styles.emptyInline}>
                <Text style={styles.emptyText}>
                  No orders in this range.
                </Text>
              </View>
            )}
          </View>
        ) : null}

        {!bootLoading ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Orders by status</Text>
            {orders.isError ? (
              <SectionError
                message={
                  orders.error instanceof Error
                    ? orders.error.message
                    : 'Could not load status mix.'
                }
                onRetry={() => void orders.refetch()}
              />
            ) : slices.length ? (
              <View style={styles.pieWrap}>
                <CategoryPieChart slices={slices} size={132} />
                <View style={styles.legend}>
                  {slices.map((slice) => (
                    <View key={slice.name} style={styles.legendRow}>
                      <View
                        style={[
                          styles.legendDot,
                          { backgroundColor: slice.color },
                        ]}
                      />
                      <Text style={styles.legendLabel} numberOfLines={1}>
                        {slice.name}
                      </Text>
                      <Text style={styles.legendValue}>
                        {slice.value} · {slice.percent}%
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.emptyInline}>
                <Text style={styles.emptyText}>No orders in this range.</Text>
              </View>
            )}
          </View>
        ) : null}

        {!bootLoading ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Cancellations</Text>
            <Text style={styles.panelCaption}>
              Reject and cancel rates for this range
            </Text>
            {cancellations.isLoading && !cancellations.data ? (
              <View style={styles.emptyInline}>
                <ActivityIndicator color={authTheme.brand} />
              </View>
            ) : cancellations.isError ? (
              <SectionError
                message={
                  cancellations.error instanceof Error
                    ? cancellations.error.message
                    : 'Could not load cancellations.'
                }
                onRetry={() => void cancellations.refetch()}
              />
            ) : (
              <>
                <View style={styles.rateRow}>
                  <View style={styles.rateCard}>
                    <Text style={styles.metricLabel}>Reject rate</Text>
                    <MetricValue
                      value={cancelTotals?.rejectRate ?? null}
                      format="percent"
                    />
                    <Text style={styles.bottomCaption}>
                      {cancelTotals?.rejected ?? 0} rejected
                    </Text>
                  </View>
                  <View style={styles.rateCard}>
                    <Text style={styles.metricLabel}>Customer cancel</Text>
                    <MetricValue
                      value={cancelTotals?.customerCancelRate ?? null}
                      format="percent"
                    />
                    <Text style={styles.bottomCaption}>
                      {cancelTotals?.cancelledByCustomer ?? 0} by customer
                    </Text>
                  </View>
                  <View style={styles.rateCard}>
                    <Text style={styles.metricLabel}>All cancels</Text>
                    <MetricValue
                      value={cancelTotals?.cancelRate ?? null}
                      format="percent"
                    />
                    <Text style={styles.bottomCaption}>
                      {cancelTotals?.cancelled ?? 0} cancelled
                    </Text>
                  </View>
                </View>
                {(cancellations.data?.byRejectReason.length ?? 0) > 0 ? (
                  <View style={styles.reasonList}>
                    <Text style={styles.reasonTitle}>Reject reasons</Text>
                    {cancellations.data?.byRejectReason.map((row) => (
                      <View key={row.code} style={styles.reasonRow}>
                        <Text style={styles.topName}>{reasonLabel(row.code)}</Text>
                        <Text style={styles.topOrders}>{row.count}</Text>
                      </View>
                    ))}
                  </View>
                ) : (cancelTotals?.orders ?? 0) === 0 ? (
                  <View style={styles.emptyInline}>
                    <Text style={styles.emptyText}>
                      No orders in this range.
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.panelCaption}>
                    No rejects in this range.
                  </Text>
                )}
              </>
            )}
          </View>
        ) : null}

        {!bootLoading ? (
          <View style={styles.panel}>
            <View style={styles.topHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.panelTitle}>Best sellers</Text>
                <Text style={styles.panelCaption}>
                  All-time from your menu (not filtered by date)
                </Text>
              </View>
              <View style={styles.limitGroup}>
                {TOP_LIMITS.map((limit) => {
                  const active = limit === topLimit;
                  return (
                    <Pressable
                      key={limit}
                      onPress={() => setTopLimit(limit)}
                      style={[
                        styles.limitChip,
                        active && styles.limitChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.limitText,
                          active && styles.limitTextActive,
                        ]}
                      >
                        Top {limit}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {topItems.isLoading && !topItems.data ? (
              <View style={styles.emptyInline}>
                <ActivityIndicator color={authTheme.brand} />
              </View>
            ) : topItems.isError ? (
              <SectionError
                message={
                  topItems.error instanceof Error
                    ? topItems.error.message
                    : 'Could not load best sellers.'
                }
                onRetry={() => void topItems.refetch()}
              />
            ) : topList.length ? (
              <View style={styles.topList}>
                {topList.map((item, index) => (
                  <View
                    key={item.id || `${item.name}-${index}`}
                    style={[
                      styles.topRow,
                      index < topList.length - 1 && styles.topRowBorder,
                    ]}
                  >
                    <Text style={styles.rank}>{index + 1}</Text>
                    <Text style={styles.topName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.topOrders}>
                      {item.orders} sold
                      {item.revenue != null && Number.isFinite(item.revenue)
                        ? ` · ${formatCurrency(item.revenue)}`
                        : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.emptyInline}>
                <Text style={styles.emptyText}>
                  No menu sales recorded yet.
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <Pressable
          style={styles.exportCard}
          onPress={() => void exportCsv()}
          disabled={exporting || !restaurantId}
        >
          {exporting ? (
            <ActivityIndicator color={authTheme.brand} />
          ) : (
            <Download color={authTheme.brand} size={18} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.exportTitle}>Export orders CSV</Text>
            <Text style={styles.panelCaption}>
              {range.from} to {range.to} · max 90 days
            </Text>
          </View>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    gap: 16,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodRow: {
    marginTop: 16,
    gap: 8,
  },
  periodGroup: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.08)',
    padding: 4,
    gap: 4,
    alignSelf: 'flex-start',
  },
  periodChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
  },
  periodChipActive: {
    backgroundColor: authTheme.brand,
  },
  periodText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  periodTextActive: {
    color: '#FFFFFF',
  },
  rangeHint: {
    color: authTheme.textDim,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  loadingBox: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  metricRow: {
    gap: 10,
    paddingRight: 4,
  },
  metricCard: {
    width: 148,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 14,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  metricLabel: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
    marginBottom: 4,
  },
  metricValue: {
    color: authTheme.text,
    fontSize: 20,
    fontFamily: fonts.extraBold,
  },
  metricSuffix: {
    fontSize: 12,
    color: authTheme.textMuted,
    fontFamily: fonts.semiBold,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 16,
  },
  panelTitle: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.bold,
    marginBottom: 4,
  },
  panelCaption: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    marginBottom: 10,
  },
  chartBox: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pieWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 8,
  },
  legend: {
    flex: 1,
    gap: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    flex: 1,
    color: authTheme.text,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  legendValue: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  limitGroup: {
    flexDirection: 'row',
    backgroundColor: authTheme.surface,
    borderRadius: 10,
    padding: 3,
    gap: 2,
  },
  limitChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  limitChipActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.12)',
  },
  limitText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  limitTextActive: {
    color: authTheme.brand,
  },
  topList: {
    marginTop: 4,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 10,
  },
  topRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(122, 14, 34, 0.1)',
  },
  rank: {
    width: 18,
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  topName: {
    flex: 1,
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  topOrders: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  bottomRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  bottomCard: {
    flexGrow: 1,
    flexBasis: '40%',
    minWidth: 140,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 14,
  },
  bottomTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  bottomLabel: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
    flex: 1,
    marginRight: 8,
  },
  bottomCaption: {
    marginTop: 6,
    color: authTheme.textDim,
    fontSize: 11,
    fontFamily: fonts.medium,
  },
  rateRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  rateCard: {
    flex: 1,
    backgroundColor: authTheme.surface,
    borderRadius: 12,
    padding: 10,
  },
  reasonList: {
    marginTop: 8,
  },
  reasonTitle: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.bold,
    marginBottom: 4,
  },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  exportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: authTheme.brandSoft,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
  },
  exportTitle: {
    color: authTheme.brand,
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyInline: {
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  emptyText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 4,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
});
