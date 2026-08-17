import { useRouter } from 'expo-router';
import {
  AlertTriangle,
  Award,
  ChevronLeft,
  Share2,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatCurrency,
  formatPercent,
  formatRating,
} from '@/lib/delivery-partner/analytics-api';
import { usePartnerPerformance } from '@/lib/delivery-partner/analytics-hooks';
import { usePartnerAttendanceStreak } from '@/lib/delivery-partner/availability-hooks';
import { resolveDisplayStreak } from '@/lib/delivery-partner/availability-types';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { formatPerformanceError } from '@/lib/delivery-partner/performance-api';
import {
  useAcceptanceRate,
  useCancellationRate,
  useCustomerReviews,
  usePartnerTier,
  usePartnerWarnings,
  usePerformanceMutations,
  useRatingSummary,
  useRatingsHistory,
  useReferralCode,
  useReferralEarnings,
  useReferredPartners,
  useTierCriteria,
} from '@/lib/delivery-partner/performance-hooks';
import {
  earningStatusLabel,
  onboardingLabel,
  ratingTrendLabel,
  tierTone,
  warningSeverityLabel,
  type PartnerRating,
  type PartnerWarning,
  type PerformanceRate,
  type WarningStatus,
} from '@/lib/delivery-partner/performance-types';

const TABS = [
  { key: 'stats', label: 'Stats' },
  { key: 'ratings', label: 'Ratings' },
  { key: 'tier', label: 'Tier' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'refer', label: 'Refer' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const WARNING_FILTERS: { key: WarningStatus | ''; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'acknowledged', label: 'Acked' },
  { key: 'expired', label: 'Expired' },
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

function StateBlock({
  loading,
  error,
  empty,
  emptyText,
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string | null;
  empty: boolean;
  emptyText: string;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return <ActivityIndicator color="#EA4B14" style={{ marginVertical: 28 }} />;
  }
  if (error) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{error}</Text>
        {onRetry ? (
          <Pressable onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
  if (empty) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }
  return <>{children}</>;
}

function RateCard({
  title,
  data,
  loading,
  error,
  onRetry,
}: {
  title: string;
  data?: PerformanceRate;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
}) {
  const better = (data?.direction ?? '').includes('higher');
  const atRisk = Boolean(data?.atRisk);
  return (
    <View style={[styles.card, atRisk && styles.cardRisk]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>{title}</Text>
        {atRisk ? <Text style={styles.pillWarn}>At risk</Text> : null}
      </View>
      {loading && !data ? (
        <ActivityIndicator color="#EA4B14" />
      ) : error && !data ? (
        <Pressable onPress={onRetry}>
          <Text style={styles.retryText}>{error} · Retry</Text>
        </Pressable>
      ) : (
        <>
          <Text style={[styles.heroValue, atRisk && { color: '#B45309' }]}>
            {formatPercent(data?.rate ?? 0)}
          </Text>
          <Text style={styles.meta}>
            Threshold {formatPercent(data?.threshold ?? 0)} ·{' '}
            {better ? 'higher is better' : 'keep this low'}
          </Text>
          {data?.note ? <Text style={styles.note}>{data.note}</Text> : null}
        </>
      )}
    </View>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          color="#D97706"
          fill={n <= Math.round(value) ? '#FBBF24' : 'transparent'}
        />
      ))}
    </View>
  );
}

function RatingRow({ item }: { item: PartnerRating }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.reviewerMasked ?? 'Customer'}
        </Text>
        <Stars value={item.stars} />
      </View>
      {item.comment ? <Text style={styles.note}>{item.comment}</Text> : null}
      <Text style={styles.meta}>
        {item.source === 'restaurant' ? 'Restaurant' : 'Customer'}
        {item.createdAt ? ` · ${when(item.createdAt)}` : ''}
      </Text>
    </View>
  );
}

function WarningCard({
  item,
  onAck,
  pending,
}: {
  item: PartnerWarning;
  onAck: () => void;
  pending: boolean;
}) {
  const open = item.status === 'open';
  return (
    <View style={[styles.card, open && styles.cardRisk]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={open ? styles.pillWarn : styles.pillMuted}>
          {item.status}
        </Text>
      </View>
      {item.message ? <Text style={styles.note}>{item.message}</Text> : null}
      <Text style={styles.meta}>
        {warningSeverityLabel(item.severity)}
        {item.strikePoints ? ` · ${item.strikePoints} strike` : ''}
        {item.autoIssued ? ' · auto' : ''}
        {item.issuedAt ? ` · ${when(item.issuedAt)}` : ''}
      </Text>
      {open ? (
        <Pressable
          onPress={onAck}
          disabled={pending}
          style={[styles.ackBtn, pending && { opacity: 0.55 }]}
        >
          {pending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.ackText}>Acknowledge</Text>
          )}
        </Pressable>
      ) : item.acknowledgedAt ? (
        <Text style={styles.meta}>Acked {when(item.acknowledgedAt)}</Text>
      ) : null}
    </View>
  );
}

export function PartnerPerformanceManager() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('stats');
  const [ratingSource, setRatingSource] = useState<'reviews' | 'all'>('reviews');
  const [warnStatus, setWarnStatus] = useState<WarningStatus | ''>('open');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  const performance = usePartnerPerformance(tab === 'stats');
  const attendanceStreak = usePartnerAttendanceStreak(tab === 'stats');
  const acceptance = useAcceptanceRate(tab === 'stats');
  const cancellation = useCancellationRate(tab === 'stats');
  const summary = useRatingSummary(tab === 'ratings' || tab === 'stats');
  const reviews = useCustomerReviews(tab === 'ratings' && ratingSource === 'reviews');
  const ratings = useRatingsHistory(tab === 'ratings' && ratingSource === 'all');
  const tier = usePartnerTier(tab === 'tier' || tab === 'stats');
  const criteria = useTierCriteria(tab === 'tier');
  const warnings = usePartnerWarnings(warnStatus || undefined, tab === 'alerts');
  const referralCode = useReferralCode(tab === 'refer');
  const referees = useReferredPartners(tab === 'refer');
  const referralEarn = useReferralEarnings(tab === 'refer');
  const { acknowledgeWarning } = usePerformanceMutations();

  const perf = performance.data;
  const streakDays = resolveDisplayStreak(
    attendanceStreak.data,
    perf?.currentStreak
  );
  const reviewRows = reviews.data?.pages.flatMap((p) => p.items) ?? [];
  const ratingRows = ratings.data?.pages.flatMap((p) => p.items) ?? [];
  const warningRows = warnings.data?.pages.flatMap((p) => p.items) ?? [];
  const refereeRows = referees.data?.pages.flatMap((p) => p.items) ?? [];
  const tone = tierTone(tier.data?.code ?? criteria.data?.current.code);
  const list = ratingSource === 'reviews' ? reviews : ratings;
  const listRows = ratingSource === 'reviews' ? reviewRows : ratingRows;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        performance.refetch(),
        attendanceStreak.refetch(),
        acceptance.refetch(),
        cancellation.refetch(),
        summary.refetch(),
        reviews.refetch(),
        ratings.refetch(),
        tier.refetch(),
        criteria.refetch(),
        warnings.refetch(),
        referralCode.refetch(),
        referees.refetch(),
        referralEarn.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const shareReferral = async () => {
    const code = referralCode.data;
    if (!code) return;
    const message = [code.shareText, code.shareUrl, code.code]
      .filter(Boolean)
      .join('\n');
    await Share.share({ message });
  };

  const onAck = async (id: string) => {
    setAckError(null);
    try {
      await acknowledgeWarning.mutateAsync(id);
    } catch (error) {
      setAckError(
        formatPerformanceError(error, 'Could not acknowledge this warning.')
      );
    }
  };

  return (
    <View style={styles.root}>
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
        <Text style={styles.headerTitle}>Performance</Text>
        <View style={styles.backBtn} />
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
              <Text style={[styles.tabText, active && styles.tabTextOn]} numberOfLines={1}>
                {item.label}
              </Text>
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
        {tab === 'stats' ? (
          <>
            <StateBlock
              loading={performance.isLoading && !perf}
              error={
                performance.isError && !perf
                  ? formatPerformanceError(performance.error, 'Could not load performance.')
                  : null
              }
              empty={false}
              emptyText=""
              onRetry={() => void performance.refetch()}
            >
              <View style={styles.hero}>
                <View>
                  <Text style={styles.heroLabel}>
                    {tier.data?.label ?? perf?.scoreLabel ?? 'Rider score'}
                  </Text>
                  <Text style={styles.heroValue}>
                    {formatRating(perf?.avgRating ?? 0)}
                    <Text style={styles.heroUnit}>
                      {' '}
                      · {perf?.ratingCount ?? 0} ratings
                    </Text>
                  </Text>
                </View>
                {perf?.atRisk || acceptance.data?.atRisk || cancellation.data?.atRisk ? (
                  <Text style={styles.pillWarn}>At risk</Text>
                ) : (
                  <Award color="#EA4B14" size={22} />
                )}
              </View>
              <View style={styles.grid}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridValue}>{perf?.totalDeliveries ?? 0}</Text>
                  <Text style={styles.gridLabel}>Trips</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridValue}>{formatPercent(perf?.onTimeRate ?? 0)}</Text>
                  <Text style={styles.gridLabel}>On-time</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridValue}>{formatPercent(perf?.completionRate ?? 0)}</Text>
                  <Text style={styles.gridLabel}>Complete</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridValue}>{streakDays}d</Text>
                  <Text style={styles.gridLabel}>Streak</Text>
                </View>
              </View>
              {perf?.zoneRank ? (
                <Text style={styles.meta}>
                  Zone rank #{perf.zoneRank.rank} of {perf.zoneRank.total} ·{' '}
                  {perf.zoneRank.period} {perf.zoneRank.metric}
                </Text>
              ) : null}
              {typeof perf?.openWarnings === 'number' && perf.openWarnings > 0 ? (
                <Pressable onPress={() => setTab('alerts')} style={styles.warnBanner}>
                  <AlertTriangle color="#B45309" size={16} />
                  <Text style={styles.warnBannerText}>
                    {perf.openWarnings} open warning{perf.openWarnings === 1 ? '' : 's'}
                  </Text>
                </Pressable>
              ) : null}
            </StateBlock>

            <RateCard
              title="Acceptance"
              data={acceptance.data}
              loading={acceptance.isLoading}
              error={
                acceptance.isError
                  ? formatPerformanceError(acceptance.error, 'Could not load acceptance.')
                  : null
              }
              onRetry={() => void acceptance.refetch()}
            />
            <RateCard
              title="Cancellations"
              data={cancellation.data}
              loading={cancellation.isLoading}
              error={
                cancellation.isError
                  ? formatPerformanceError(cancellation.error, 'Could not load cancellations.')
                  : null
              }
              onRetry={() => void cancellation.refetch()}
            />
          </>
        ) : null}

        {tab === 'ratings' ? (
          <>
            <StateBlock
              loading={summary.isLoading && !summary.data}
              error={
                summary.isError && !summary.data
                  ? formatPerformanceError(summary.error, 'Could not load rating summary.')
                  : null
              }
              empty={false}
              emptyText=""
              onRetry={() => void summary.refetch()}
            >
              <View style={styles.hero}>
                <View>
                  <Text style={styles.heroLabel}>Average rating</Text>
                  <Text style={styles.heroValue}>
                    {formatRating(summary.data?.avgRating ?? 0)}
                  </Text>
                  <Text style={styles.meta}>
                    {summary.data?.ratingCount ?? 0} ratings ·{' '}
                    {ratingTrendLabel(summary.data?.trend)}
                  </Text>
                </View>
                {(summary.data?.trend ?? '') === 'up' ? (
                  <TrendingUp color="#16A34A" size={22} />
                ) : (summary.data?.trend ?? '') === 'down' ? (
                  <TrendingDown color="#DC2626" size={22} />
                ) : (
                  <Star color="#D97706" size={22} fill="#FBBF24" />
                )}
              </View>
              {(['5', '4', '3', '2', '1'] as const).map((star) => {
                const count = summary.data?.distribution[star] ?? 0;
                const total = summary.data?.ratingCount || 1;
                const pct = Math.max(0, Math.min(100, (count / total) * 100));
                return (
                  <View key={star} style={styles.distRow}>
                    <Text style={styles.distLabel}>{star}★</Text>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.distCount}>{count}</Text>
                  </View>
                );
              })}
              {summary.data?.last30Days ? (
                <Text style={styles.meta}>
                  Last 30 days {formatRating(summary.data.last30Days.avg)} (
                  {summary.data.last30Days.count}) · prev{' '}
                  {formatRating(summary.data.previous30Days?.avg ?? 0)} (
                  {summary.data.previous30Days?.count ?? 0})
                </Text>
              ) : null}
            </StateBlock>

            <View style={styles.chipRow}>
              {([
                { key: 'reviews', label: 'Customers' },
                { key: 'all', label: 'All ratings' },
              ] as const).map((item) => {
                const on = ratingSource === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setRatingSource(item.key)}
                    style={[styles.filterChip, on && styles.filterChipOn]}
                  >
                    <Text style={[styles.filterText, on && styles.filterTextOn]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <StateBlock
              loading={list.isLoading && !list.data}
              error={
                list.isError && !list.data
                  ? formatPerformanceError(list.error, 'Could not load ratings.')
                  : null
              }
              empty={listRows.length === 0}
              emptyText={
                ratingSource === 'reviews'
                  ? 'No customer reviews yet.'
                  : 'No ratings yet.'
              }
              onRetry={() => void list.refetch()}
            >
              {listRows.map((item) => (
                <RatingRow key={item.ratingId} item={item} />
              ))}
            </StateBlock>
            {list.hasNextPage ? (
              <Pressable
                onPress={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                style={styles.retry}
              >
                {list.isFetchingNextPage ? (
                  <ActivityIndicator color="#EA4B14" />
                ) : (
                  <Text style={styles.retryText}>Load more</Text>
                )}
              </Pressable>
            ) : null}
          </>
        ) : null}

        {tab === 'tier' ? (
          <StateBlock
            loading={(tier.isLoading || criteria.isLoading) && !criteria.data && !tier.data}
            error={
              (criteria.isError || tier.isError) && !criteria.data && !tier.data
                ? formatPerformanceError(
                    criteria.error ?? tier.error,
                    'Could not load tier.'
                  )
                : null
            }
            empty={false}
            emptyText=""
            onRetry={() => {
              void tier.refetch();
              void criteria.refetch();
            }}
          >
            <View style={[styles.hero, { backgroundColor: tone.bg }]}>
              <View>
                <Text style={[styles.heroLabel, { color: tone.fg }]}>
                  Current tier
                  {criteria.data?.current.overridden || tier.data?.overridden
                    ? ' · override'
                    : ''}
                </Text>
                <Text style={[styles.heroValue, { color: tone.fg }]}>
                  {criteria.data?.current.label ?? tier.data?.label ?? 'Bronze'}
                </Text>
              </View>
              <Award color={tone.fg} size={28} />
            </View>
            {(criteria.data?.current.perks ?? tier.data?.perks ?? []).map((perk) => (
              <Text key={perk} style={styles.perk}>
                · {perk}
              </Text>
            ))}
            <View style={styles.trackBig}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${Math.max(0, Math.min(100, criteria.data?.progressPercent ?? 0))}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.meta}>
              {criteria.data?.next
                ? `${Math.round(criteria.data.progressPercent)}% to ${criteria.data.next.label}`
                : 'Top tier reached'}
            </Text>
            {(criteria.data?.requirements ?? []).map((req) => {
              const pct =
                req.required > 0
                  ? Math.max(0, Math.min(100, (req.current / req.required) * 100))
                  : req.met
                    ? 100
                    : 0;
              return (
                <View key={req.key} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle}>{req.label}</Text>
                    <Text style={req.met ? styles.pillOk : styles.pillMuted}>
                      {req.met ? 'Met' : `${req.current} / ${req.required}`}
                    </Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${pct}%` }]} />
                  </View>
                </View>
              );
            })}
            {criteria.data?.next?.perks?.length ? (
              <>
                <Text style={styles.section}>Next: {criteria.data.next.label}</Text>
                {criteria.data.next.perks.map((perk) => (
                  <Text key={perk} style={styles.perk}>
                    · {perk}
                  </Text>
                ))}
              </>
            ) : null}
          </StateBlock>
        ) : null}

        {tab === 'alerts' ? (
          <>
            <View style={styles.chipRow}>
              {WARNING_FILTERS.map((item) => {
                const on = warnStatus === item.key;
                return (
                  <Pressable
                    key={item.label}
                    onPress={() => setWarnStatus(item.key)}
                    style={[styles.filterChip, on && styles.filterChipOn]}
                  >
                    <Text style={[styles.filterText, on && styles.filterTextOn]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {ackError ? <Text style={styles.warnText}>{ackError}</Text> : null}
            <StateBlock
              loading={warnings.isLoading && !warnings.data}
              error={
                warnings.isError && !warnings.data
                  ? formatPerformanceError(warnings.error, 'Could not load warnings.')
                  : null
              }
              empty={warningRows.length === 0}
              emptyText="No warnings in this filter."
              onRetry={() => void warnings.refetch()}
            >
              {warningRows.map((item) => (
                <WarningCard
                  key={item.warningId}
                  item={item}
                  pending={
                    acknowledgeWarning.isPending &&
                    acknowledgeWarning.variables === item.warningId
                  }
                  onAck={() => void onAck(item.warningId)}
                />
              ))}
            </StateBlock>
            {warnings.hasNextPage ? (
              <Pressable
                onPress={() => void warnings.fetchNextPage()}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Load more</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {tab === 'refer' ? (
          <>
            <StateBlock
              loading={referralCode.isLoading && !referralCode.data}
              error={
                referralCode.isError && !referralCode.data
                  ? formatPerformanceError(
                      referralCode.error,
                      'Could not load your referral code.'
                    )
                  : null
              }
              empty={false}
              emptyText=""
              onRetry={() => void referralCode.refetch()}
            >
              <View style={styles.codeBox}>
                <Text style={styles.heroLabel}>Your code</Text>
                <Text style={styles.code}>{referralCode.data?.code}</Text>
                <Text style={styles.meta}>
                  {referralCode.data?.referredCount ?? 0} riders joined with this code
                </Text>
                <Pressable onPress={() => void shareReferral()} style={styles.shareBtn}>
                  <Share2 color="#FFFFFF" size={16} />
                  <Text style={styles.ackText}>Share invite</Text>
                </Pressable>
              </View>
            </StateBlock>

            <StateBlock
              loading={referralEarn.isLoading && !referralEarn.data}
              error={
                referralEarn.isError && !referralEarn.data
                  ? formatPerformanceError(
                      referralEarn.error,
                      'Could not load referral earnings.'
                    )
                  : null
              }
              empty={false}
              emptyText=""
              onRetry={() => void referralEarn.refetch()}
            >
              <View style={styles.grid}>
                <View style={styles.gridItem}>
                  <Text style={styles.gridValue}>
                    {formatCurrency(referralEarn.data?.totalBonusInr ?? 0)}
                  </Text>
                  <Text style={styles.gridLabel}>Earned</Text>
                </View>
                <View style={styles.gridItem}>
                  <Text style={styles.gridValue}>
                    {formatCurrency(referralEarn.data?.pendingBonusInr ?? 0)}
                  </Text>
                  <Text style={styles.gridLabel}>Pending</Text>
                </View>
              </View>
              <Text style={styles.note}>
                KYC bonus {formatCurrency(referralEarn.data?.policy?.kycActivateInr ?? 100)} ·{' '}
                {referralEarn.data?.policy?.firstTripsTarget ?? 10} trips{' '}
                {formatCurrency(referralEarn.data?.policy?.firstTripsInr ?? 250)}
              </Text>
            </StateBlock>

            <Text style={styles.section}>Referred riders</Text>
            <StateBlock
              loading={referees.isLoading && !referees.data}
              error={
                referees.isError && !referees.data
                  ? formatPerformanceError(referees.error, 'Could not load referrals.')
                  : null
              }
              empty={refereeRows.length === 0}
              emptyText="No referred riders yet. Share your code."
              onRetry={() => void referees.refetch()}
            >
              {refereeRows.map((row) => (
                <View key={row.refereeId} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{row.name}</Text>
                      <Text style={styles.meta}>
                        {onboardingLabel(row.onboarding)}
                        {row.phoneMasked ? ` · ${row.phoneMasked}` : ''}
                      </Text>
                    </View>
                    <Users color="#6B7280" size={16} />
                  </View>
                  <Text style={styles.note}>
                    {earningStatusLabel(row.earningStatus)} · {row.deliveries}/
                    {row.tripsTarget} trips · {formatCurrency(row.totalBonusInr)}
                  </Text>
                </View>
              ))}
            </StateBlock>
            {(referralEarn.data?.recent ?? []).length > 0 ? (
              <>
                <Text style={styles.section}>Recent credits</Text>
                {referralEarn.data!.recent.map((row, index) => (
                  <View
                    key={`${row.refereeId ?? 'c'}-${row.creditedAt ?? index}`}
                    style={styles.historyRow}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{row.name ?? 'Bonus'}</Text>
                      <Text style={styles.meta}>
                        {(row.kind ?? '').replace(/_/g, ' ')}
                        {row.creditedAt ? ` · ${when(row.creditedAt)}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.bonus}>{formatCurrency(row.bonusInr)}</Text>
                  </View>
                ))}
              </>
            ) : null}
            {referees.hasNextPage ? (
              <Pressable onPress={() => void referees.fetchNextPage()} style={styles.retry}>
                <Text style={styles.retryText}>Load more</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAFA' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: '#111827' },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    gap: 3,
  },
  tab: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  tabOn: { backgroundColor: '#FFFFFF' },
  tabText: { fontFamily: fonts.semiBold, fontSize: 11, color: '#6B7280' },
  tabTextOn: { color: '#111827' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  hero: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  heroLabel: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280' },
  heroValue: {
    fontFamily: fonts.extraBold,
    fontSize: 32,
    color: '#111827',
    marginTop: 2,
  },
  heroUnit: { fontFamily: fonts.medium, fontSize: 14, color: '#6B7280' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  gridItem: {
    flexGrow: 1,
    minWidth: '45%',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  gridValue: { fontFamily: fonts.bold, fontSize: 18, color: '#111827' },
  gridLabel: { fontFamily: fonts.medium, fontSize: 11, color: '#6B7280', marginTop: 2 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  cardRisk: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cardTitle: { flex: 1, fontFamily: fonts.semiBold, fontSize: 15, color: '#111827' },
  meta: { fontFamily: fonts.regular, fontSize: 12, color: '#6B7280', marginTop: 4 },
  note: { fontFamily: fonts.regular, fontSize: 13, color: '#4B5563', marginTop: 6, lineHeight: 19 },
  pillWarn: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: 'hidden',
  },
  pillMuted: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: 'hidden',
  },
  pillOk: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#166534',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    overflow: 'hidden',
  },
  warnBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  warnBannerText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#92400E' },
  warnText: { fontFamily: fonts.medium, fontSize: 13, color: '#B45309', marginBottom: 8 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  distLabel: { width: 28, fontFamily: fonts.semiBold, fontSize: 12, color: '#6B7280' },
  distCount: { width: 24, textAlign: 'right', fontFamily: fonts.medium, fontSize: 12, color: '#6B7280' },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  trackBig: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
    marginTop: 10,
  },
  fill: { height: '100%', backgroundColor: '#EA4B14', borderRadius: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  filterChipOn: { backgroundColor: '#EA4B14' },
  filterText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#4B5563' },
  filterTextOn: { color: '#FFFFFF' },
  stars: { flexDirection: 'row', gap: 2 },
  ackBtn: {
    marginTop: 10,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: '#EA4B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ackText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
  perk: { fontFamily: fonts.regular, fontSize: 13, color: '#4B5563', marginBottom: 4 },
  section: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
    marginTop: 8,
    marginBottom: 8,
  },
  codeBox: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  code: {
    fontFamily: fonts.extraBold,
    fontSize: 32,
    color: '#FFFFFF',
    letterSpacing: 2,
    marginVertical: 6,
  },
  shareBtn: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#EA4B14',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  bonus: { fontFamily: fonts.bold, fontSize: 14, color: '#EA4B14' },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  retry: {
    alignSelf: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
  },
  retryText: { fontFamily: fonts.semiBold, color: authTheme.brand },
});
