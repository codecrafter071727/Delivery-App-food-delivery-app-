import {
  AlertTriangle,
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
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { CodRemitSheet } from '@/components/delivery/earnings/CodRemitSheet';
import { InstantPayoutSheet } from '@/components/delivery/earnings/InstantPayoutSheet';
import { PayoutDetailSheet } from '@/components/delivery/earnings/PayoutDetailSheet';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatCurrency,
  formatIncentiveAmount,
  lastNDays,
  selectEarningsPeriod,
} from '@/lib/delivery-partner/analytics-api';
import {
  usePartnerDailyEarnings,
  usePartnerEarnings,
  usePartnerIncentives,
} from '@/lib/delivery-partner/analytics-hooks';
import type {
  EarningsPeriodDays,
  EarningsPeriodKey,
  PartnerDailyEarning,
  PartnerIncentive,
} from '@/lib/delivery-partner/analytics-types';
import { usePartnerBank } from '@/lib/delivery-partner/bank-hooks';
import { bankStatusLabel, isBankVerified } from '@/lib/delivery-partner/bank-types';
import { formatFinanceError } from '@/lib/delivery-partner/finance-api';
import {
  useCodPending,
  useCodRemittanceHistory,
  useInstantPayoutEligibility,
  usePartnerPayouts,
  usePartnerWallet,
  usePayoutSchedule,
  useWalletTransactions,
} from '@/lib/delivery-partner/finance-hooks';
import {
  eligibilityReasonCopy,
  payoutStatusLabel,
  walletTxnLabel,
} from '@/lib/delivery-partner/finance-types';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

const PERIODS: {
  key: EarningsPeriodKey;
  label: string;
  chartDays: EarningsPeriodDays;
}[] = [
  { key: 'today', label: 'Today', chartDays: 7 },
  { key: 'week', label: 'Week', chartDays: 7 },
  { key: 'month', label: 'Month', chartDays: 30 },
  { key: 'lifetime', label: 'All', chartDays: 90 },
];

const TABS = [
  { key: 'wallet', label: 'Wallet' },
  { key: 'cod', label: 'COD' },
  { key: 'payouts', label: 'Payouts' },
  { key: 'ledger', label: 'Ledger' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TXN_TYPES = [
  { key: '', label: 'All' },
  { key: 'delivery_credit', label: 'Trips' },
  { key: 'payout_debit', label: 'Payouts' },
  { key: 'cod_collect', label: 'COD in' },
  { key: 'cod_remit', label: 'Remits' },
  { key: 'incentive_credit', label: 'Bonus' },
];

function when(iso?: string | null) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function SimpleLineChart({ points, width }: { points: PartnerDailyEarning[]; width: number }) {
  if (!points.length || width <= 0) return null;
  const values = points.map((p) => p.earnings);
  const max = Math.max(...values, 1);
  const height = 180;
  const stepX = (width - 40) / Math.max(1, points.length - 1);

  let path = '';
  points.forEach((p, i) => {
    const x = i * stepX;
    const y = height - (p.earnings / max) * height * 0.8 - 10;
    if (i === 0) path += `M ${x} ${y} `;
    else path += `L ${x} ${y} `;
  });

  return (
    <View style={{ width, height, marginTop: 16 }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 20,
          justifyContent: 'space-between',
        }}
      >
        <Text style={styles.chartYLabel}>{max.toFixed(0)}</Text>
        <Text style={styles.chartYLabel}>{(max * 0.5).toFixed(0)}</Text>
        <Text style={styles.chartYLabel}>0</Text>
      </View>
      <View style={{ marginLeft: 30 }}>
        <Svg width={width - 30} height={height}>
          <Path
            d={path}
            fill="none"
            stroke="#EA4B14"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          {points
            .filter((_, i) => i % 2 === 0)
            .map((p, i) => (
              <Text key={i} style={styles.chartXLabel}>
                {p.label.slice(0, 3)}
              </Text>
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

  const [period, setPeriod] = useState<EarningsPeriodKey>('today');
  const [tab, setTab] = useState<TabKey>('wallet');
  const [txnType, setTxnType] = useState('');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [showInstant, setShowInstant] = useState(false);
  const [showRemit, setShowRemit] = useState(false);
  const [payoutId, setPayoutId] = useState<string | null>(null);

  const chartDays =
    PERIODS.find((p) => p.key === period)?.chartDays ?? 7;
  const earnings = usePartnerEarnings();
  const daily = usePartnerDailyEarnings(chartDays);
  const incentivesQuery = usePartnerIncentives();
  const wallet = usePartnerWallet(true);
  const eligibility = useInstantPayoutEligibility(true);
  const schedule = usePayoutSchedule(true);
  const codPending = useCodPending(true);
  const remittances = useCodRemittanceHistory(tab === 'cod');
  const payouts = usePartnerPayouts(tab === 'payouts');
  const ledger = useWalletTransactions(txnType || undefined, tab === 'ledger');
  const bankQuery = usePartnerBank(true);

  const summary = earnings.data;
  const selected = selectEarningsPeriod(summary, period);
  const currency = wallet.data?.currency ?? summary?.currency ?? 'INR';
  const chartPoints = useMemo(() => {
    const points = daily.data?.points ?? [];
    return lastNDays(points, Math.min(chartDays, 14));
  }, [daily.data?.points, chartDays]);

  const hasChartData = chartPoints.some((p) => p.earnings > 0 || p.orders > 0);
  const incentiveRows = incentivesQuery.data?.incentives ?? [];
  const payout = summary?.payout;
  const bank = bankQuery.data;
  const hasPayout = Boolean(bank?.hasAccount || payout?.bankAccountNo || payout?.ifscCode);
  const cashDue = wallet.data?.cashInHand ?? codPending.data?.cashInHand ?? 0;
  const payable = wallet.data?.earningsBalance ?? 0;
  const remittanceRows = remittances.data?.pages.flatMap((page) => page.items) ?? [];
  const payoutRows = payouts.data?.pages.flatMap((page) => page.items) ?? [];
  const ledgerRows = ledger.data?.pages.flatMap((page) => page.items) ?? [];

  const loading = wallet.isLoading && !wallet.data;
  const error =
    wallet.error && !wallet.data
      ? formatFinanceError(wallet.error, 'Could not load wallet.')
      : null;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        earnings.refetch(),
        daily.refetch(),
        incentivesQuery.refetch(),
        bankQuery.refetch(),
        wallet.refetch(),
        eligibility.refetch(),
        schedule.refetch(),
        codPending.refetch(),
        remittances.refetch(),
        payouts.refetch(),
        ledger.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const breakdown = [
    {
      key: 'base',
      label: 'Base pay',
      value: formatCurrency(selected.baseEarnings, currency),
      icon: Wallet,
    },
    {
      key: 'incentives',
      label: 'Incentives',
      value: formatCurrency(selected.incentives, currency),
      icon: Zap,
    },
    {
      key: 'tips',
      label: 'Tips',
      value: formatCurrency(selected.tips, currency),
      icon: Gift,
    },
    {
      key: 'deductions',
      label: 'Deductions',
      value:
        selected.deductions > 0
          ? `−${formatCurrency(selected.deductions, currency)}`
          : formatCurrency(0, currency),
      icon: TrendingDown,
      negative: selected.deductions > 0,
    },
  ] as const;

  const openInstant = () => {
    if (!eligibility.data?.bankVerified && !isBankVerified(bank)) {
      router.push(DELIVERY_ROUTES.profile);
      return;
    }
    setShowInstant(true);
  };

  return (
    <View style={styles.root}>
      <View style={styles.heroBackground} />

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
        <Pressable
          onPress={() => router.push(DELIVERY_ROUTES.profile)}
          style={styles.backBtn}
        >
          <Settings2 color="#000000" size={20} />
        </Pressable>
      </View>

      <View style={styles.tabRow}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={[styles.tab, active && styles.tabOn]}
            >
              <Text style={[styles.tabText, active && styles.tabTextOn]}>{item.label}</Text>
            </Pressable>
          );
        })}
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
            <Text style={styles.mutedText}>Loading wallet…</Text>
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Couldn’t load wallet</Text>
            <Text style={[styles.mutedText, { marginTop: 6 }]}>{error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {tab === 'wallet' ? (
              <>
                <View style={styles.topRow}>
                  <View style={[styles.walletCard, styles.earningsCard]}>
                    <Text style={styles.walletCardTitle}>Payable earnings</Text>
                    <Text style={styles.walletCardAmount}>
                      {formatCurrency(payable, currency)}
                    </Text>
                    <Pressable onPress={openInstant} style={styles.walletCardBtn}>
                      <Text style={styles.walletCardBtnTextBlack}>Withdraw</Text>
                    </Pressable>
                  </View>

                  <View style={[styles.walletCard, styles.dueCard]}>
                    <Text style={styles.walletCardTitle}>COD in hand</Text>
                    <Text style={styles.walletCardAmount}>
                      {formatCurrency(cashDue, currency)}
                    </Text>
                    <Pressable
                      onPress={() => setShowRemit(true)}
                      style={styles.walletCardBtn}
                    >
                      <Text style={styles.walletCardBtnTextBlack}>Remit</Text>
                    </Pressable>
                  </View>
                </View>

                {wallet.data?.pendingPayouts ? (
                  <Text style={styles.mutedText}>
                    In-flight payouts {formatCurrency(wallet.data.pendingPayouts, currency)} ·
                    lifetime {formatCurrency(wallet.data.lifetimeEarnings, currency)}
                  </Text>
                ) : null}

                <View style={styles.actionRow}>
                  <Pressable onPress={openInstant} style={styles.actionBtn}>
                    <Zap color="#000000" size={20} strokeWidth={1.5} />
                    <Text style={styles.actionText}>Instant</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setTab('ledger')}
                    style={styles.actionBtn}
                  >
                    <Clock color="#000000" size={20} strokeWidth={1.5} />
                    <Text style={styles.actionText}>History</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => router.push(DELIVERY_ROUTES.support)}
                    style={styles.actionBtn}
                  >
                    <HelpCircle color="#000000" size={20} strokeWidth={1.5} />
                    <Text style={styles.actionText}>Support</Text>
                  </Pressable>
                </View>

                {(codPending.data?.blocked ||
                  wallet.data?.cod?.blocked ||
                  wallet.data?.cod?.remitDueToday) ? (
                  <View style={styles.warningBanner}>
                    <View style={styles.warningIconWrap}>
                      <AlertTriangle color="#F59E0B" size={20} />
                    </View>
                    <Text style={styles.warningText}>
                      {codPending.data?.blocked
                        ? `COD cap reached (${formatCurrency(cashDue)} / ${formatCurrency(codPending.data.limit)}). Remit to take new COD orders.`
                        : 'Remit cash today so you stay under the COD cap.'}
                    </Text>
                  </View>
                ) : null}

                {earnings.isError && !summary ? (
                  <View style={styles.warningBanner}>
                    <Text style={styles.warningText}>
                      {formatFinanceError(earnings.error, 'Could not load IST earnings.')}
                    </Text>
                    <Pressable onPress={() => void earnings.refetch()}>
                      <Text style={styles.payoutCta}>Retry</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.mutedText}>
                    {period === 'lifetime' ? 'Lifetime' : period} ·{' '}
                    {formatCurrency(selected.totalEarnings, currency)} ·{' '}
                    {selected.totalDeliveries} trips
                    {selected.from ? ` · ${selected.from}` : ''}
                    {selected.to && selected.to !== selected.from ? `–${selected.to}` : ''}
                  </Text>
                )}

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

                <View style={styles.chartBlock}>
                  <View style={styles.chartHeader}>
                    <Text style={styles.chartTitle}>Statistic report</Text>
                    <View style={styles.chartTabs}>
                      {PERIODS.map((p) => {
                        const active = period === p.key;
                        return (
                          <Pressable
                            key={p.key}
                            onPress={() => setPeriod(p.key)}
                            style={[styles.chartTab, active && styles.chartTabActive]}
                          >
                            <Text
                              style={[
                                styles.chartTabText,
                                active && styles.chartTabActiveText,
                              ]}
                            >
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

                {schedule.isError && !schedule.data ? (
                  <Pressable
                    onPress={() => void schedule.refetch()}
                    style={styles.transactionsContainer}
                  >
                    <Text style={styles.txTitle}>Weekly payout</Text>
                    <Text style={styles.payoutMeta}>
                      {formatFinanceError(schedule.error, 'Could not load schedule. Retry')}
                    </Text>
                  </Pressable>
                ) : schedule.data ? (
                  <View style={styles.transactionsContainer}>
                    <View style={styles.txHeader}>
                      <Text style={styles.txTitle}>Weekly payout</Text>
                    </View>
                    <Text style={styles.payoutMeta}>
                      {schedule.data.weekday ?? 'Tuesday'} IST · next{' '}
                      {schedule.data.nextPayoutDate ?? when(schedule.data.nextPayoutAt) ?? '—'}
                    </Text>
                    <Text style={styles.payoutMeta}>
                      Instant min {formatCurrency(schedule.data.instantMin ?? 200)} · fee{' '}
                      {schedule.data.instantFeePercent ?? 2.5}% (min{' '}
                      {formatCurrency(schedule.data.instantFeeMin ?? 5)}) · daily cap{' '}
                      {formatCurrency(schedule.data.instantDailyCap ?? 5000)}
                    </Text>
                  </View>
                ) : null}

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
                            backgroundColor: isBankVerified(bank) ? '#DCFCE7' : '#FEF3C7',
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
                      <Text style={styles.payoutLine}>
                        A/C {bank?.accountMasked ||
                          (payout?.bankAccountNo
                            ? `····${String(payout.bankAccountNo).slice(-4)}`
                            : '—')}
                      </Text>
                      {bank?.ifsc || payout?.ifscCode ? (
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
            ) : null}

            {tab === 'cod' ? (
              <View style={styles.transactionsContainer}>
                <View style={styles.txHeader}>
                  <Text style={styles.txTitle}>Cash due to platform</Text>
                  <Pressable onPress={() => setShowRemit(true)}>
                    <Text style={styles.payoutCta}>Remit</Text>
                  </Pressable>
                </View>
                {codPending.isError && !codPending.data ? (
                  <Pressable onPress={() => void codPending.refetch()}>
                    <Text style={styles.payoutMeta}>
                      {formatFinanceError(codPending.error, 'Could not load COD pending. Retry')}
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    <Text style={styles.walletCardAmount}>
                      {formatCurrency(codPending.data?.cashInHand ?? 0, currency)}
                    </Text>
                    <Text style={styles.payoutMeta}>
                      Limit {formatCurrency(codPending.data?.limit ?? 0)} · remaining{' '}
                      {formatCurrency(codPending.data?.remainingCapacity ?? 0)}
                    </Text>
                    <Text style={styles.payoutMeta}>
                      Today collected {formatCurrency(codPending.data?.todayCollected ?? 0)} ·{' '}
                      {codPending.data?.todayCount ?? 0} trips · lifetime remitted{' '}
                      {formatCurrency(codPending.data?.remittedLifetime ?? 0)}
                    </Text>
                    {codPending.data?.blocked ? (
                      <Text style={[styles.payoutMeta, { color: '#B91C1C', marginTop: 8 }]}>
                        New COD orders are blocked until you remit.
                      </Text>
                    ) : null}
                  </>
                )}

                <Text style={[styles.txTitle, { marginTop: 20 }]}>Remittance history</Text>
                {remittances.isLoading && !remittances.data ? (
                  <ActivityIndicator color="#EA4B14" style={{ marginTop: 12 }} />
                ) : remittances.isError && !remittanceRows.length ? (
                  <Pressable onPress={() => void remittances.refetch()}>
                    <Text style={styles.payoutMeta}>
                      {formatFinanceError(remittances.error, 'Could not load remittances. Retry')}
                    </Text>
                  </Pressable>
                ) : !remittanceRows.length ? (
                  <Text style={[styles.emptyText, { marginTop: 12 }]}>No remittances yet.</Text>
                ) : (
                  remittanceRows.map((row) => (
                    <View key={row.remittanceId} style={[styles.programRow, styles.rowBorder]}>
                      <View style={styles.programTop}>
                        <Text style={styles.programTitle}>
                          {row.method.replace(/_/g, ' ')} · {row.status}
                        </Text>
                        <Text style={styles.programReward}>
                          {formatCurrency(row.amount, currency)}
                        </Text>
                      </View>
                      <Text style={styles.programDesc}>
                        {[row.reference, when(row.remittedAt)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                  ))
                )}
                {remittances.hasNextPage ? (
                  <Pressable
                    onPress={() => void remittances.fetchNextPage()}
                    style={styles.retryBtn}
                    disabled={remittances.isFetchingNextPage}
                  >
                    <Text style={styles.retryText}>
                      {remittances.isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {tab === 'payouts' ? (
              <>
                <View style={styles.transactionsContainer}>
                  <View style={styles.txHeader}>
                    <Text style={styles.txTitle}>Instant eligibility</Text>
                    <Pressable onPress={openInstant}>
                      <Text style={styles.payoutCta}>Withdraw</Text>
                    </Pressable>
                  </View>
                  {eligibility.isError && !eligibility.data ? (
                    <Pressable onPress={() => void eligibility.refetch()}>
                      <Text style={styles.payoutMeta}>
                        {formatFinanceError(eligibility.error, 'Could not check eligibility. Retry')}
                      </Text>
                    </Pressable>
                  ) : (
                    <>
                      <Text style={styles.payoutMeta}>
                        {eligibility.data?.eligible
                          ? `Ready · max ${formatCurrency(eligibility.data.maxAmount, currency)}`
                          : 'Not eligible for instant payout'}
                      </Text>
                      {(eligibility.data?.reasons ?? []).map((code) => (
                        <Text key={code} style={[styles.payoutMeta, { color: '#B91C1C' }]}>
                          {eligibilityReasonCopy(code)}
                        </Text>
                      ))}
                    </>
                  )}
                </View>

                <View style={styles.transactionsContainer}>
                  <View style={styles.txHeader}>
                    <Text style={styles.txTitle}>Settlements</Text>
                  </View>
                  {payouts.isLoading && !payouts.data ? (
                    <ActivityIndicator color="#EA4B14" />
                  ) : payouts.isError && !payoutRows.length ? (
                    <Pressable onPress={() => void payouts.refetch()}>
                      <Text style={styles.payoutMeta}>
                        {formatFinanceError(payouts.error, 'Could not load payouts. Retry')}
                      </Text>
                    </Pressable>
                  ) : !payoutRows.length ? (
                    <Text style={styles.emptyText}>No payouts yet.</Text>
                  ) : (
                    payoutRows.map((row) => {
                      const paid = row.status.toLowerCase() === 'paid' && Boolean(row.paidAt);
                      return (
                        <Pressable
                          key={row.payoutId}
                          onPress={() => setPayoutId(row.payoutId)}
                          style={[styles.programRow, styles.rowBorder]}
                        >
                          <View style={styles.programTop}>
                            <Text style={styles.programTitle}>
                              {row.kind === 'instant' ? 'Instant' : 'Weekly'} ·{' '}
                              {paid ? 'Paid' : payoutStatusLabel(row.status)}
                            </Text>
                            <Text style={styles.programReward}>
                              {formatCurrency(row.netAmount, currency)}
                            </Text>
                          </View>
                          <Text style={styles.programDesc}>
                            {[row.bankAccountMasked, when(row.requestedAt)]
                              .filter(Boolean)
                              .join(' · ')}
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                  {payouts.hasNextPage ? (
                    <Pressable
                      onPress={() => void payouts.fetchNextPage()}
                      style={styles.retryBtn}
                      disabled={payouts.isFetchingNextPage}
                    >
                      <Text style={styles.retryText}>
                        {payouts.isFetchingNextPage ? 'Loading…' : 'Load more'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : null}

            {tab === 'ledger' ? (
              <View style={styles.transactionsContainer}>
                <View style={styles.txHeader}>
                  <Text style={styles.txTitle}>Ledger</Text>
                </View>
                <View style={styles.chartTabs}>
                  {TXN_TYPES.map((item) => {
                    const active = txnType === item.key;
                    return (
                      <Pressable
                        key={item.key || 'all'}
                        onPress={() => {
                          setTxnType(item.key);
                        }}
                        style={[styles.chartTab, active && styles.chartTabActive]}
                      >
                        <Text
                          style={[styles.chartTabText, active && styles.chartTabActiveText]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {ledger.isLoading && !ledger.data ? (
                  <ActivityIndicator color="#EA4B14" style={{ marginTop: 16 }} />
                ) : ledger.isError && !ledgerRows.length ? (
                  <Pressable onPress={() => void ledger.refetch()}>
                    <Text style={[styles.payoutMeta, { marginTop: 12 }]}>
                      {formatFinanceError(ledger.error, 'Could not load ledger. Retry')}
                    </Text>
                  </Pressable>
                ) : !ledgerRows.length ? (
                  <Text style={[styles.emptyText, { marginTop: 16 }]}>No ledger rows.</Text>
                ) : (
                  ledgerRows.map((row) => {
                    const debit = (row.direction ?? '').toLowerCase() === 'debit';
                    return (
                      <View key={row.id} style={[styles.programRow, styles.rowBorder]}>
                        <View style={styles.programTop}>
                          <Text style={styles.programTitle}>{walletTxnLabel(row.type)}</Text>
                          <Text
                            style={[
                              styles.programReward,
                              debit ? { color: '#B91C1C' } : null,
                            ]}
                          >
                            {debit ? '−' : '+'}
                            {formatCurrency(row.netAmount ?? row.amount, row.currency)}
                          </Text>
                        </View>
                        <Text style={styles.programDesc}>
                          {[row.note, row.status, when(row.createdAt)]
                            .filter(Boolean)
                            .join(' · ')}
                        </Text>
                      </View>
                    );
                  })
                )}
                {ledger.hasNextPage ? (
                  <Pressable
                    onPress={() => void ledger.fetchNextPage()}
                    style={styles.retryBtn}
                    disabled={ledger.isFetchingNextPage}
                  >
                    <Text style={styles.retryText}>
                      {ledger.isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <InstantPayoutSheet visible={showInstant} onClose={() => setShowInstant(false)} />
      <CodRemitSheet visible={showRemit} onClose={() => setShowRemit(false)} />
      <PayoutDetailSheet
        visible={Boolean(payoutId)}
        payoutId={payoutId}
        onClose={() => setPayoutId(null)}
      />
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
  const reward =
    formatIncentiveAmount(incentive.amount, incentive.currency ?? currency) ?? undefined;
  const progress = incentive.progress ?? 0;
  const target = incentive.target ?? 0;
  const pct = target > 0 ? Math.max(0, Math.min(100, (progress / target) * 100)) : 0;

  return (
    <View style={[styles.programRow, bordered && styles.rowBorder]}>
      <View style={styles.programTop}>
        <Text style={styles.programTitle} numberOfLines={2}>
          {incentive.title}
        </Text>
        {reward ? <Text style={styles.programReward}>{reward}</Text> : null}
      </View>
      {incentive.description ? (
        <Text style={styles.programDesc} numberOfLines={2}>
          {incentive.description}
        </Text>
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
    paddingBottom: 12,
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
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: {
    backgroundColor: '#FFFFFF',
  },
  tabText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
  },
  tabTextOn: {
    color: '#111827',
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
    fontSize: 22,
    color: '#EA4B14',
    marginTop: 4,
    marginBottom: 16,
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
    flexWrap: 'wrap',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 4,
    gap: 2,
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
  },
  txHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
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
