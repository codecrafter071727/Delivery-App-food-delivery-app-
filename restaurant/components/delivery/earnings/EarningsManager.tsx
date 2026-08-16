import {
  AlertTriangle,
  ArrowDownCircle,
  Clock,
  Gift,
  HelpCircle,
  ChevronLeft,
  Settings2,
  Target,
  TrendingDown,
  Wallet,
  Zap,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatCurrency,
  formatIncentiveAmount,
  lastNDays,
} from '@/lib/delivery-partner/analytics-api';
import {
  usePartnerDailyEarnings,
  usePartnerEarnings,
  usePartnerIncentives,
} from '@/lib/delivery-partner/analytics-hooks';
import type {
  EarningsPeriodDays,
  PartnerDailyEarning,
  PartnerIncentive,
} from '@/lib/delivery-partner/analytics-types';
import { usePartnerBank } from '@/lib/delivery-partner/bank-hooks';
import { bankStatusLabel, isBankVerified } from '@/lib/delivery-partner/bank-types';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { getApiErrorMessage } from '@/lib/errors';

const PERIODS: { label: string; days: EarningsPeriodDays }[] = [
  { label: 'Today', days: 1 },
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

function SimpleLineChart({ points, width }: { points: PartnerDailyEarning[]; width: number }) {
  if (!points.length || width <= 0) return null;
  const values = points.map((p) => p.earnings);
  const max = Math.max(...values, 1);
  const height = 180;
  
  const stepX = (width - 40) / Math.max(1, (points.length - 1));
  
  let path = '';
  points.forEach((p, i) => {
    const x = i * stepX;
    const y = height - (p.earnings / max) * height * 0.8 - 10;
    if (i === 0) path += `M ${x} ${y} `;
    else path += `L ${x} ${y} `;
  });

  return (
    <View style={{ width, height, marginTop: 16 }}>
      {/* Y Axis pseudo-labels */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 20, justifyContent: 'space-between' }}>
        <Text style={styles.chartYLabel}>{(max).toFixed(0)}</Text>
        <Text style={styles.chartYLabel}>{(max * 0.5).toFixed(0)}</Text>
        <Text style={styles.chartYLabel}>0</Text>
      </View>
      <View style={{ marginLeft: 30 }}>
        <Svg width={width - 30} height={height}>
          <Path d={path} fill="none" stroke="#EA4B14" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
        {/* X axis labels */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          {points.filter((_, i) => i % 2 === 0).map((p, i) => (
            <Text key={i} style={styles.chartXLabel}>{p.label.slice(0, 3)}</Text>
          ))}
        </View>
      </View>
    </View>
  );
}

export function PartnerEarningsManager() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const chartWidth = Math.max(windowWidth - 72, 240);
  
  const [days, setDays] = useState<EarningsPeriodDays>(7);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [autoSettle, setAutoSettle] = useState(false);

  const earnings = usePartnerEarnings(days);
  const daily = usePartnerDailyEarnings(days);
  const incentivesQuery = usePartnerIncentives();

  const summary = earnings.data;
  const currency = summary?.currency ?? 'INR';
  const chartPoints = useMemo(() => {
    const points = daily.data?.points ?? [];
    return days <= 7
      ? lastNDays(points, days)
      : lastNDays(points, Math.min(days, 14));
  }, [daily.data?.points, days]);

  const hasChartData = chartPoints.some((p) => p.earnings > 0 || p.orders > 0);
  const incentiveRows = incentivesQuery.data?.incentives ?? [];
  const payout = summary?.payout;
  const bankQuery = usePartnerBank(true);
  const bank = bankQuery.data;
  const hasPayout = Boolean(bank?.hasAccount || payout?.bankAccountNo || payout?.ifscCode);

  const loading = (earnings.isLoading && !summary) || (daily.isLoading && !daily.data);
  const error = earnings.error && !summary ? getApiErrorMessage(earnings.error, 'Could not load earnings.') : null;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        earnings.refetch(),
        daily.refetch(),
        incentivesQuery.refetch(),
        bankQuery.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const breakdown = [
    {
      key: 'base',
      label: 'Base pay',
      value: formatCurrency(summary?.baseEarnings ?? 0, currency),
      icon: Wallet,
    },
    {
      key: 'incentives',
      label: 'Incentives',
      value: formatCurrency(summary?.incentives ?? 0, currency),
      icon: Zap,
    },
    {
      key: 'tips',
      label: 'Tips',
      value: formatCurrency(summary?.tips ?? 0, currency),
      icon: Gift,
    },
    {
      key: 'deductions',
      label: 'Deductions',
      value:
        (summary?.deductions ?? 0) > 0
          ? `−${formatCurrency(summary?.deductions ?? 0, currency)}`
          : formatCurrency(0, currency),
      icon: TrendingDown,
      negative: (summary?.deductions ?? 0) > 0,
    },
  ] as const;

  return (
    <View style={styles.root}>
      {/* Background shape behind cards */}
      <View style={styles.heroBackground} />
      
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace(DELIVERY_ROUTES.home);
          }}
          style={styles.backBtn}
        >
          <ChevronLeft color="#000000" size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>Wallet</Text>
        <Pressable style={styles.backBtn}>
          <Settings2 color="#000000" size={20} />
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
            tintColor="#EA4B14"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#EA4B14" size="large" />
            <Text style={styles.mutedText}>Loading earnings…</Text>
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Couldn’t load earnings</Text>
            <Text style={[styles.mutedText, { marginTop: 6 }]}>{error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Top Cards: Total Earnings & Due */}
            <View style={styles.topRow}>
              <View style={[styles.walletCard, styles.earningsCard]}>
                <Text style={styles.walletCardTitle}>Total Earnings</Text>
                <Text style={styles.walletCardAmount}>
                  {formatCurrency(summary?.totalEarnings ?? 0, currency)}
                </Text>
                <Pressable style={styles.walletCardBtn}>
                  <Text style={styles.walletCardBtnTextBlack}>Withdraw Now</Text>
                </Pressable>
              </View>

              <View style={[styles.walletCard, styles.dueCard]}>
                <Text style={styles.walletCardTitle}>Due to company</Text>
                <Text style={styles.walletCardAmount}>
                  {formatCurrency(summary?.deductions ?? 0, currency)}
                </Text>
                <Pressable style={styles.walletCardBtn}>
                  <Text style={styles.walletCardBtnTextBlack}>Settle Now</Text>
                </Pressable>
              </View>
            </View>

            {/* Action Row */}
            <View style={styles.actionRow}>
              <Pressable style={styles.actionBtn}>
                <ArrowDownCircle color="#000000" size={20} strokeWidth={1.5} />
                <Text style={styles.actionText}>Cash Out</Text>
              </Pressable>
              <Pressable style={styles.actionBtn}>
                <Clock color="#000000" size={20} strokeWidth={1.5} />
                <Text style={styles.actionText}>History</Text>
              </Pressable>
              <Pressable style={styles.actionBtn}>
                <HelpCircle color="#000000" size={20} strokeWidth={1.5} />
                <Text style={styles.actionText}>Support</Text>
              </Pressable>
            </View>

            {/* Breakdown Grid */}
            <View style={styles.breakdownGrid}>
              {breakdown.map((item) => {
                const Icon = item.icon;
                return (
                  <View key={item.key} style={styles.splitCard}>
                    <View style={styles.splitIconRow}>
                      <View style={styles.splitIcon}>
                        <Icon color="#EA4B14" size={16} />
                      </View>
                      <Text style={styles.splitLabel}>{item.label}</Text>
                    </View>
                    <Text
                      style={[
                        styles.splitAmount,
                        'negative' in item && item.negative
                          ? { color: authTheme.error }
                          : null,
                      ]}
                      numberOfLines={1}
                    >
                      {item.value}
                    </Text>
                  </View>
                );
              })}
            </View>

            {/* Auto-Settle Dues */}
            <View style={styles.autoSettleBlock}>
              <View style={styles.autoSettleInfo}>
                <Text style={styles.autoSettleTitle}>Auto-Settle Dues</Text>
                <Text style={styles.autoSettleSub}>
                  Automatically pay dues from future earnings
                </Text>
              </View>
              <Switch
                value={autoSettle}
                onValueChange={setAutoSettle}
                trackColor={{ false: '#E5E7EB', true: '#EA4B14' }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* Warning Banner */}
            {summary?.deductions && summary.deductions > 50 ? (
              <View style={styles.warningBanner}>
                <View style={styles.warningIconWrap}>
                  <AlertTriangle color="#F59E0B" size={20} />
                </View>
                <Text style={styles.warningText}>
                  Your due amount is nearing limits. Please settle now to keep receiving new orders.
                </Text>
              </View>
            ) : null}

            {/* Statistic Report */}
            <View style={styles.chartBlock}>
              <View style={styles.chartHeader}>
                <Text style={styles.chartTitle}>Statistic report</Text>
                <View style={styles.chartTabs}>
                  {PERIODS.map((p) => {
                    const active = days === p.days;
                    return (
                      <Pressable 
                        key={p.days} 
                        onPress={() => setDays(p.days)}
                        style={[styles.chartTab, active && styles.chartTabActive]}
                      >
                        <Text style={[styles.chartTabText, active && styles.chartTabActiveText]}>
                          {p.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {hasChartData ? (
                <SimpleLineChart points={chartPoints} width={chartWidth} />
              ) : (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>No earnings for this period</Text>
                </View>
              )}
            </View>

            {/* Incentives */}
            <View style={styles.transactionsContainer}>
              <View style={styles.txHeader}>
                <Text style={styles.txTitle}>Incentive Programs</Text>
              </View>
              {incentivesQuery.isError && !incentiveRows.length ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>Could not load incentives</Text>
                </View>
              ) : incentiveRows.length === 0 ? (
                <View style={styles.empty}>
                  <Target color="#9CA3AF" size={22} />
                  <Text style={styles.emptyText}>No programs available right now</Text>
                </View>
              ) : (
                incentiveRows.map((item, index) => (
                  <IncentiveProgramRow
                    key={item.id}
                    incentive={item}
                    currency={currency}
                    bordered={index < incentiveRows.length - 1}
                  />
                ))
              )}
            </View>

            {/* Payout */}
            <Pressable
              onPress={() => router.push(DELIVERY_ROUTES.profile)}
              style={styles.transactionsContainer}
            >
              <View style={styles.txHeader}>
                <Text style={styles.txTitle}>Payout Account</Text>
                <Text style={styles.payoutCta}>
                  {bank?.hasAccount ? 'Manage' : 'Add bank'}
                </Text>
              </View>
              {bankQuery.isError && !bank ? (
                <Text style={styles.payoutMeta}>Could not load bank. Pull to retry.</Text>
              ) : hasPayout ? (
                <View style={styles.payoutRows}>
                  <View
                    style={[
                      styles.payoutBadge,
                      {
                        backgroundColor: isBankVerified(bank)
                          ? '#DCFCE7'
                          : '#FEF3C7',
                      },
                    ]}
                  >
                    <Zap
                      color={isBankVerified(bank) ? '#15803D' : '#B45309'}
                      size={12}
                    />
                    <Text
                      style={[
                        styles.payoutBadgeText,
                        {
                          color: isBankVerified(bank) ? '#15803D' : '#B45309',
                        },
                      ]}
                    >
                      {bank?.payoutsEnabled
                        ? 'Instant payouts on'
                        : bank?.hasAccount
                          ? `${bankStatusLabel(bank.verificationStatus)} · verify in Profile`
                          : 'Add bank in Profile'}
                    </Text>
                  </View>
                  {bank?.holderName || payout?.accountHolderName ? (
                    <Text style={styles.payoutName}>
                      {bank?.holderName || payout?.accountHolderName}
                    </Text>
                  ) : null}
                  {bank?.bankName || payout?.bankName ? (
                    <Text style={styles.payoutMeta}>
                      {bank?.bankName || payout?.bankName}
                    </Text>
                  ) : null}
                  <Text style={styles.payoutLine}>
                    A/C {bank?.accountMasked || (payout?.bankAccountNo
                      ? `····${String(payout.bankAccountNo).slice(-4)}`
                      : '—')}
                  </Text>
                  {(bank?.ifsc || payout?.ifscCode) ? (
                    <Text style={styles.payoutMeta}>
                      IFSC {bank?.ifsc || payout?.ifscCode}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View style={[styles.warningBanner, { marginTop: 0 }]}>
                  <View style={styles.warningIconWrap}>
                    <AlertTriangle color="#F59E0B" size={20} />
                  </View>
                  <Text style={styles.warningText}>
                    No payout account. Add IFSC + account in Profile. Instant
                    payouts need penny-drop Verified — we never fake paid.
                  </Text>
                </View>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function IncentiveProgramRow({
  incentive,
  currency,
  bordered,
}: {
  incentive: PartnerIncentive;
  currency: string;
  bordered: boolean;
}) {
  const reward = formatIncentiveAmount(incentive.amount, incentive.currency ?? currency) ?? undefined;
  const progress = incentive.progress ?? 0;
  const target = incentive.target ?? 0;
  const pct = target > 0 ? Math.max(0, Math.min(100, (progress / target) * 100)) : 0;

  return (
    <View style={[styles.programRow, bordered && styles.rowBorder]}>
      <View style={styles.programTop}>
        <Text style={styles.programTitle} numberOfLines={2}>{incentive.title}</Text>
        {reward ? <Text style={styles.programReward}>{reward}</Text> : null}
      </View>
      {incentive.description ? (
        <Text style={styles.programDesc} numberOfLines={2}>{incentive.description}</Text>
      ) : null}
      {target > 0 ? (
        <>
          <View style={styles.rateTrack}>
            <View style={[styles.rateFill, { width: `${pct}%`, backgroundColor: '#EA4B14' }]} />
          </View>
          <View style={styles.programProgress}>
            <Text style={styles.programProgressText}>
              {incentive.progressLabel ?? `${progress} / ${target}`}
            </Text>
            <Text style={styles.programProgressText}>{Math.round(pct)}%</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  heroBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: '#000000',
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 16,
  },
  center: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  mutedText: {
    color: '#9CA3AF',
    fontFamily: fonts.medium,
    fontSize: 14,
    marginTop: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#000000',
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: '#EA4B14',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  retryText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  topRow: {
    flexDirection: 'row',
    gap: 12,
  },
  walletCard: {
    flex: 1,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  earningsCard: {
    backgroundColor: '#000000',
  },
  dueCard: {
    backgroundColor: '#000000',
  },
  walletCardTitle: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#EA4B14',
  },
  walletCardAmount: {
    fontFamily: fonts.extraBold,
    fontSize: 26,
    color: '#EA4B14',
    marginTop: 4,
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  walletCardBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletCardBtnTextBlack: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#000000',
  },
  walletCardBtnTextOrange: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#EA4B14',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  actionText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#374151',
  },
  breakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  splitCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  splitIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  splitIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitLabel: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  splitAmount: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#000000',
  },
  autoSettleBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  autoSettleInfo: {
    flex: 1,
    paddingRight: 12,
  },
  autoSettleTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#000000',
  },
  autoSettleSub: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 16,
  },
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  warningIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  warningText: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#000000',
    lineHeight: 18,
  },
  chartBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  chartTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#000000',
  },
  chartTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
  },
  chartTab: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  chartTabActive: {
    backgroundColor: '#EA4B14',
  },
  chartTabText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#9CA3AF',
  },
  chartTabActiveText: {
    fontFamily: fonts.bold,
    color: '#FFFFFF',
  },
  chartYLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: '#9CA3AF',
    width: 20,
  },
  chartXLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: '#9CA3AF',
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
    color: '#9CA3AF',
    textAlign: 'center',
  },
  transactionsContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  txHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  txTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#000000',
  },
  programRow: {
    paddingVertical: 14,
    gap: 8,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
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
    color: '#EA4B14',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  programDesc: {
    color: '#6B7280',
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  rateTrack: {
    height: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 3,
    marginTop: 4,
    overflow: 'hidden',
  },
  rateFill: {
    height: '100%',
    borderRadius: 3,
  },
  programProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  programProgressText: {
    color: '#9CA3AF',
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  payoutRows: {
    gap: 6,
  },
  payoutName: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#000000',
    marginBottom: 4,
  },
  payoutMeta: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  payoutCta: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#EA4B14',
  },
  payoutBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
  },
  payoutBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  payoutLine: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#000000',
  },
});
