import {
  Award,
  BarChart3,
  ChevronDown,
  Clock3,
  Flame,
  Gift,
  Package,
  Star,
  TrendingUp,
  CreditCard,
  Briefcase,
  Target,
  Zap,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatHours,
  formatIncentiveAmount,
  formatPercent,
  formatRating,
  formatCurrency,
  lastNDays,
  selectEarningsPeriod,
} from '@/lib/delivery-partner/analytics-api';
import {
  usePartnerDailyEarnings,
  usePartnerEarnings,
  usePartnerIncentives,
  usePartnerPerformance,
} from '@/lib/delivery-partner/analytics-hooks';
import type {
  PartnerDailyEarning,
  PartnerIncentive,
  EarningsPeriodDays,
} from '@/lib/delivery-partner/analytics-types';
import { getApiErrorMessage } from '@/lib/errors';

// Helper for polar coordinates and SVG paths
function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(
  x: number,
  y: number,
  radius: number,
  startAngle: number,
  endAngle: number
) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return [
    'M',
    start.x,
    start.y,
    'A',
    radius,
    radius,
    0,
    largeArcFlag,
    0,
    end.x,
    end.y,
  ].join(' ');
}

function StrokeDonutChart({
  slices,
  size,
  thickness,
}: {
  slices: any[];
  size: number;
  thickness: number;
}) {
  const center = size / 2;
  const radius = (size - thickness) / 2;
  let currentAngle = 0;
  const gapAngle = 8; // Gap between slices

  return (
    <Svg width={size} height={size}>
      {slices.map((slice, i) => {
        const sweep = Math.max((slice.percent / 100) * 360, gapAngle + 1);
        const start = currentAngle + gapAngle / 2;
        const end = currentAngle + sweep - gapAngle / 2;
        currentAngle += sweep;

        if (slices.length === 1) {
          return (
            <Circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              stroke={slice.color}
              strokeWidth={thickness}
              fill="none"
              strokeLinecap="round"
            />
          );
        }

        if (end <= start) return null;

        return (
          <Path
            key={i}
            d={describeArc(center, center, radius, start, end)}
            fill="none"
            stroke={slice.color}
            strokeWidth={thickness}
            strokeLinecap="round"
          />
        );
      })}
    </Svg>
  );
}

function MiniBarChart({
  points,
  valueKey,
  color,
  width,
}: {
  points: PartnerDailyEarning[];
  valueKey: 'orders' | 'earnings';
  color: string;
  width: number;
}) {
  if (!points.length || width <= 0) return null;

  const values = points.map((p) => Math.max(0, p[valueKey]));
  const max = Math.max(...values, 1);
  const gap = 6;
  const barW = Math.max(
    8,
    (width - gap * Math.max(points.length - 1, 0)) / points.length
  );

  return (
    <View style={{ width }}>
      <View style={[styles.barsRow, { height: 100 }]}>
        {points.map((point, index) => {
          const value = values[index] ?? 0;
          const h = Math.max(6, (value / max) * 100);
          return (
            <View
              key={`${point.date}-${index}`}
              style={[styles.barCol, { width: barW }]}
            >
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { height: h, backgroundColor: color },
                  ]}
                />
              </View>
              <Text style={styles.barLabel} numberOfLines={1}>
                {point.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function PartnerAnalyticsManager() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = Math.max(windowWidth - 72, 240);
  const [days, setDays] = useState<EarningsPeriodDays>(30);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const performance = usePartnerPerformance();
  const earnings = usePartnerEarnings();
  const daily = usePartnerDailyEarnings(days);
  const incentives = usePartnerIncentives();

  const perf = performance.data;
  const summary = earnings.data;
  const period = selectEarningsPeriod(summary, days === 7 ? 'week' : 'month');
  const currency = summary?.currency ?? 'INR';
  const incentiveRows = incentives.data?.incentives ?? [];
  const last7 = useMemo(
    () => lastNDays(daily.data?.points ?? [], 7),
    [daily.data?.points]
  );

  const hasOrderSeries = last7.some((p) => p.orders > 0);
  const hasEarningSeries = last7.some((p) => p.earnings > 0);

  const loading =
    (performance.isLoading && !perf) ||
    (earnings.isLoading && !earnings.data) ||
    (daily.isLoading && !daily.data) ||
    (incentives.isLoading && !incentives.data);

  const error =
    performance.error || earnings.error || daily.error || incentives.error
      ? getApiErrorMessage(
          performance.error ??
            earnings.error ??
            daily.error ??
            incentives.error,
          'Could not load analytics.'
        )
      : null;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        performance.refetch(),
        earnings.refetch(),
        daily.refetch(),
        incentives.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  // Derive Donut Chart Data
  const totalEarn = period.totalEarnings;
  const baseEarn = period.baseEarnings;
  const tipsEarn = period.tips;
  const incEarn = period.incentives;

  const donutSlices = [
    {
      name: 'Base Pay',
      percent: totalEarn > 0 ? (baseEarn / totalEarn) * 100 : 0,
      color: '#000000',
    },
    {
      name: 'Tips',
      percent: totalEarn > 0 ? (tipsEarn / totalEarn) * 100 : 0,
      color: '#EA4B14', // Orange
    },
    {
      name: 'Incentives',
      percent: totalEarn > 0 ? (incEarn / totalEarn) * 100 : 0,
      color: '#E5E7EB', // Neutral grey for contrast
    },
  ].filter((s) => s.percent > 0);

  // If completely empty, show a grey ring
  if (donutSlices.length === 0) {
    donutSlices.push({ name: 'No Earnings', percent: 100, color: '#E2E4E9' });
  }

  // Transactions / Metrics Data
  const metrics = [
    {
      id: 'deliveries',
      title: 'Total Deliveries',
      category: 'Performance',
      value: String(perf?.totalDeliveries ?? 0),
      icon: Package,
    },
    {
      id: 'score',
      title: 'Performance Score',
      category: perf?.scoreLabel ?? 'Metrics',
      value: `${Math.round(perf?.performanceScore ?? 0)}/100`,
      icon: Award,
    },
    {
      id: 'rating',
      title: 'Average Rating',
      category: 'Customer Feedback',
      value: `${formatRating(perf?.avgRating ?? 0)}`,
      icon: Star,
    },
    {
      id: 'completion',
      title: 'Completion Rate',
      category: 'Reliability',
      value: formatPercent(perf?.completionRate ?? 0),
      icon: BarChart3,
    },
    {
      id: 'streak',
      title: 'Delivery Streak',
      category: 'Consistency',
      value: `${perf?.currentStreak ?? 0} days`,
      icon: Flame,
    },
    {
      id: 'hours',
      title: 'Online Hours',
      category: 'Availability',
      value: formatHours(period.onlineHours),
      icon: Clock3,
    },
  ];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Analytics</Text>
        <Pressable
          onPress={() => setDays(days === 7 ? 30 : 7)}
          style={styles.periodPill}
        >
          <Text style={styles.periodPillText}>
            {days === 7 ? 'Week' : 'Month'}
          </Text>
          <ChevronDown color="#1A1D23" size={16} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET + 24 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor="#1A1D23"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#1A1D23" size="large" />
          </View>
        ) : error && !perf ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <>
            {/* Hero Donut Chart */}
            <View style={styles.heroSection}>
              <View style={styles.donutContainer}>
                <StrokeDonutChart
                  slices={donutSlices}
                  size={260}
                  thickness={22}
                />
                <View style={styles.donutCenter}>
                  <Text style={styles.donutCenterLabel}>Total amount</Text>
                  <Text style={styles.donutCenterAmount}>
                    {formatCurrency(totalEarn, currency)}
                  </Text>
                </View>
              </View>

              {/* Legend */}
              <View style={styles.legendRow}>
                {donutSlices.map(
                  (slice, i) =>
                    slice.name !== 'No Earnings' && (
                      <View key={i} style={styles.legendPill}>
                        <View
                          style={[
                            styles.legendDot,
                            { backgroundColor: slice.color },
                          ]}
                        />
                        <Text style={styles.legendText}>
                          {slice.name} {Math.round(slice.percent)}%
                        </Text>
                      </View>
                    )
                )}
              </View>
            </View>

            {/* Metrics List (Styled as Transactions) */}
            <View style={styles.listSection}>
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>Metrics & Performance</Text>
                <Text style={styles.listSeeAll}>See all</Text>
              </View>

              {metrics.map((item) => {
                const Icon = item.icon;
                return (
                  <View key={item.id} style={styles.listItem}>
                    <View style={styles.listIconWrap}>
                      <Icon color="#000000" size={20} />
                    </View>
                    <View style={styles.listBody}>
                      <Text style={styles.listTitleText}>{item.title}</Text>
                      <Text style={styles.listSubText}>{item.category}</Text>
                    </View>
                    <Text style={styles.listValueText}>{item.value}</Text>
                  </View>
                );
              })}
            </View>

            {/* Daily Trends */}
            <View style={styles.listSection}>
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>Daily Trends</Text>
              </View>
              <View style={styles.whiteCard}>
                <Text style={styles.cardSubTitle}>Earnings Last 7 Days</Text>
                {hasEarningSeries ? (
                  <MiniBarChart
                    points={last7}
                    valueKey="earnings"
                    color="#EA4B14"
                    width={chartWidth}
                  />
                ) : (
                  <Text style={styles.emptyText}>No data available</Text>
                )}
              </View>
            </View>

            {/* Incentives */}
            <View style={styles.listSection}>
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>Incentive Programs</Text>
              </View>
              {incentiveRows.length > 0 ? (
                incentiveRows.map((item) => (
                  <View key={item.id} style={styles.whiteCard}>
                    <View style={styles.programTop}>
                      <Text style={styles.programTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.programReward}>
                        {formatIncentiveAmount(item.amount, item.currency ?? 'INR')}
                      </Text>
                    </View>
                    {item.description ? (
                      <Text style={styles.programDesc} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>
                  No active incentive programs.
                </Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F6F8FB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: fonts.extraBold,
    fontSize: 24,
    color: '#000000',
    letterSpacing: -0.5,
  },
  periodPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  periodPillText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#1A1D23',
  },
  scroll: {
    paddingTop: 16,
    paddingHorizontal: 20,
    gap: 32,
  },
  center: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  errorText: {
    fontFamily: fonts.medium,
    color: authTheme.error,
  },
  heroSection: {
    alignItems: 'center',
    gap: 24,
  },
  donutContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    height: 260,
    width: 260,
  },
  donutCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutCenterLabel: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  donutCenterAmount: {
    fontFamily: fonts.extraBold,
    fontSize: 32,
    color: '#000000',
    letterSpacing: -1,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  legendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#1A1D23',
  },
  listSection: {
    gap: 16,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: '#000000',
    letterSpacing: -0.3,
  },
  listSeeAll: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#A0AEC0',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 12,
  },
  listIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  listBody: {
    flex: 1,
  },
  listTitleText: {
    fontFamily: fonts.semiBold,
    fontSize: 16,
    color: '#000000',
  },
  listSubText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#A0AEC0',
    marginTop: 2,
  },
  listValueText: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#000000',
  },
  whiteCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 12,
  },
  cardSubTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#000000',
    marginBottom: 16,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  barCol: {
    alignItems: 'center',
    gap: 8,
  },
  barTrack: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    backgroundColor: '#F7FAFC',
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 6,
  },
  barLabel: {
    color: '#A0AEC0',
    fontFamily: fonts.medium,
    fontSize: 10,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#A0AEC0',
    textAlign: 'center',
    paddingVertical: 20,
  },
  programTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  programTitle: {
    flex: 1,
    color: '#000000',
    fontFamily: fonts.semiBold,
    fontSize: 15,
  },
  programReward: {
    color: '#1A1D23',
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  programDesc: {
    marginTop: 8,
    color: '#A0AEC0',
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
});
