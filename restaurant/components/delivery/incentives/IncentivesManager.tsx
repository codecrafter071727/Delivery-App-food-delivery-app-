import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  Gift,
  Medal,
  Target,
  Trophy,
  Zap,
} from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IncentiveDetailSheet } from '@/components/delivery/incentives/IncentiveDetailSheet';
import { RedeemSheet } from '@/components/delivery/incentives/RedeemSheet';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { formatIncentiveError } from '@/lib/delivery-partner/incentives-api';
import {
  useChallenges,
  useCurrentIncentives,
  useIncentiveHistory,
  useIncentivePrograms,
  useLeaderboard,
  useQuests,
  useRewardBalance,
  useRewardsCatalog,
} from '@/lib/delivery-partner/incentives-hooks';
import {
  incentiveKindLabel,
  incentiveWindowLabel,
  metricLabelCopy,
  rewardKindLabel,
  type IncentiveProgram,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardScope,
  type RewardCatalogItem,
} from '@/lib/delivery-partner/incentives-types';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { getApiErrorCode } from '@/lib/errors';

const TABS = [
  { key: 'now', label: 'Now' },
  { key: 'rewards', label: 'Rewards' },
  { key: 'board', label: 'Board' },
  { key: 'history', label: 'Credits' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const METRICS: { key: LeaderboardMetric; label: string }[] = [
  { key: 'deliveries', label: 'Trips' },
  { key: 'rating', label: 'Rating' },
  { key: 'streak', label: 'Streak' },
];

const SCOPES: { key: LeaderboardScope; label: string }[] = [
  { key: 'zone', label: 'Zone' },
  { key: 'city', label: 'City' },
];

const PERIODS: { key: LeaderboardPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
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

function programPct(item: IncentiveProgram) {
  const progress = item.progress;
  const target =
    progress?.nextSlab?.target ??
    progress?.slabs?.[progress.slabs.length - 1]?.target ??
    item.slabs[item.slabs.length - 1]?.target ??
    0;
  const metric = progress?.metric ?? 0;
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, (metric / target) * 100));
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
        <Target color="#9CA3AF" size={22} />
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }
  return <>{children}</>;
}

function ProgramCard({
  item,
  onPress,
}: {
  item: IncentiveProgram;
  onPress: () => void;
}) {
  const progress = item.progress;
  const metric = progress?.metric ?? 0;
  const next = progress?.nextSlab;
  const pct = programPct(item);
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.cardBonus}>
          {formatCurrency(
            next?.bonusInr ??
              progress?.bonusPendingInr ??
              item.slabs[0]?.bonusInr ??
              0
          )}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <Text style={styles.pill}>{incentiveKindLabel(item.kind)}</Text>
        {incentiveWindowLabel(item.window) ? (
          <Text style={styles.pillMuted}>{incentiveWindowLabel(item.window)}</Text>
        ) : null}
        {item.requiresOptIn && !item.optedIn ? (
          <Text style={styles.pillWarn}>Opt-in</Text>
        ) : (
          <Text style={styles.pillOk}>{item.optedIn ? 'Enrolled' : 'Auto'}</Text>
        )}
      </View>
      {item.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          {metric} {metricLabelCopy(progress?.metricLabel)}
          {next ? ` · next ${next.label ?? next.target}` : ''}
        </Text>
        <Text style={styles.progressText}>{Math.round(pct)}%</Text>
      </View>
    </Pressable>
  );
}

function ChipRow<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {items.map((item) => {
        const on = value === item.key;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.filterChip, on && styles.filterChipOn]}
          >
            <Text style={[styles.filterText, on && styles.filterTextOn]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PartnerIncentivesManager() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('now');
  const [metric, setMetric] = useState<LeaderboardMetric>('deliveries');
  const [scope, setScope] = useState<LeaderboardScope>('zone');
  const [period, setPeriod] = useState<LeaderboardPeriod>('week');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openSeed, setOpenSeed] = useState<IncentiveProgram | null>(null);
  const [redeemItem, setRedeemItem] = useState<RewardCatalogItem | null>(null);

  const current = useCurrentIncentives(tab === 'now');
  const allPrograms = useIncentivePrograms(tab === 'now');
  const quests = useQuests(tab === 'now');
  const challenges = useChallenges(tab === 'now');
  const rewards = useRewardBalance(true);
  const catalog = useRewardsCatalog(tab === 'rewards');
  const history = useIncentiveHistory(tab === 'history');
  const board = useLeaderboard({ metric, scope, period }, tab === 'board');

  const historyRows = history.data?.pages.flatMap((page) => page.items) ?? [];
  const totalBonus = history.data?.pages[0]?.totalBonusInr ?? 0;
  const points = rewards.data?.points ?? catalog.data?.points ?? 0;
  const catalogItems = catalog.data?.items ?? [];
  const boardZoneError =
    getApiErrorCode(board.error) === 'NO_ZONE' ||
    getApiErrorCode(board.error) === 'ZONE_NOT_FOUND';

  const allItems = allPrograms.data?.items ?? [];
  const currentIds = useMemo(
    () => new Set((current.data?.items ?? []).map((row) => row.incentiveId)),
    [current.data?.items]
  );
  const extraPrograms = allItems.filter((row) => !currentIds.has(row.incentiveId));

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        current.refetch(),
        allPrograms.refetch(),
        quests.refetch(),
        challenges.refetch(),
        rewards.refetch(),
        catalog.refetch(),
        history.refetch(),
        board.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const openProgram = (item: IncentiveProgram) => {
    setOpenSeed(item);
    setOpenId(item.incentiveId || item.code || null);
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
        <Text style={styles.headerTitle}>Incentives</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.hero}>
        <View>
          <Text style={styles.heroLabel}>Reward points</Text>
          <Text style={styles.heroValue}>{points}</Text>
        </View>
        <View style={styles.heroRight}>
          <Gift color="#EA4B14" size={22} />
          <Text style={styles.heroMeta}>
            {rewards.data?.pointsPerDelivery ?? 10} pts / delivered trip
          </Text>
        </View>
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
              <Text style={[styles.tabText, active && styles.tabTextOn]}>
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
        {tab === 'now' ? (
          <>
            <Text style={styles.section}>Running now</Text>
            <StateBlock
              loading={current.isLoading && !current.data}
              error={
                current.isError && !current.data
                  ? formatIncentiveError(current.error, 'Could not load current programs.')
                  : null
              }
              empty={(current.data?.items.length ?? 0) === 0}
              emptyText="No active programs in this IST window."
              onRetry={() => void current.refetch()}
            >
              {(current.data?.items ?? []).map((item) => (
                <ProgramCard
                  key={item.incentiveId}
                  item={item}
                  onPress={() => openProgram(item)}
                />
              ))}
            </StateBlock>

            <Text style={styles.section}>Quests</Text>
            <Text style={styles.sectionHint}>Trip-count and streak slabs</Text>
            <StateBlock
              loading={quests.isLoading && !quests.data}
              error={
                quests.isError && !quests.data
                  ? formatIncentiveError(quests.error, 'Could not load quests.')
                  : null
              }
              empty={(quests.data?.items.length ?? 0) === 0}
              emptyText="No quests right now."
              onRetry={() => void quests.refetch()}
            >
              {(quests.data?.items ?? []).map((item) => (
                <ProgramCard
                  key={`q-${item.incentiveId}`}
                  item={item}
                  onPress={() => openProgram(item)}
                />
              ))}
            </StateBlock>

            <Text style={styles.section}>Peak challenges</Text>
            <Text style={styles.sectionHint}>Dinner peak and weekly earnings</Text>
            <StateBlock
              loading={challenges.isLoading && !challenges.data}
              error={
                challenges.isError && !challenges.data
                  ? formatIncentiveError(challenges.error, 'Could not load challenges.')
                  : null
              }
              empty={(challenges.data?.items.length ?? 0) === 0}
              emptyText="No peak challenges right now."
              onRetry={() => void challenges.refetch()}
            >
              {(challenges.data?.items ?? []).map((item) => (
                <ProgramCard
                  key={`c-${item.incentiveId}`}
                  item={item}
                  onPress={() => openProgram(item)}
                />
              ))}
            </StateBlock>

            {extraPrograms.length > 0 ? (
              <>
                <Text style={styles.section}>All programs</Text>
                {extraPrograms.map((item) => (
                  <ProgramCard
                    key={`all-${item.incentiveId}`}
                    item={item}
                    onPress={() => openProgram(item)}
                  />
                ))}
              </>
            ) : allPrograms.isError && !allPrograms.data ? (
              <Pressable onPress={() => void allPrograms.refetch()} style={styles.retry}>
                <Text style={styles.retryText}>Retry all programs</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {tab === 'rewards' ? (
          <>
            <View style={styles.pointsCard}>
              <View>
                <Text style={styles.heroLabel}>Available</Text>
                <Text style={styles.pointsValue}>{points} pts</Text>
              </View>
              <View>
                <Text style={styles.statLabel}>Lifetime</Text>
                <Text style={styles.statValue}>{rewards.data?.lifetimeEarned ?? 0}</Text>
              </View>
              <View>
                <Text style={styles.statLabel}>Redeemed</Text>
                <Text style={styles.statValue}>{rewards.data?.redeemed ?? 0}</Text>
              </View>
            </View>
            <StateBlock
              loading={catalog.isLoading && !catalog.data}
              error={
                catalog.isError && !catalog.data
                  ? formatIncentiveError(catalog.error, 'Could not load catalog.')
                  : null
              }
              empty={catalogItems.length === 0}
              emptyText="No rewards in the catalog yet."
              onRetry={() => void catalog.refetch()}
            >
              {catalogItems.map((item) => (
                <Pressable
                  key={item.itemId}
                  onPress={() => setRedeemItem(item)}
                  style={styles.card}
                >
                  <View style={styles.cardTop}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.cardBonus}>{item.pointsCost} pts</Text>
                  </View>
                  <View style={styles.metaRow}>
                    <Text style={styles.pill}>{rewardKindLabel(item.kind)}</Text>
                    {item.valueInr ? (
                      <Text style={styles.pillMuted}>{formatCurrency(item.valueInr)}</Text>
                    ) : null}
                    {!item.inStock ? (
                      <Text style={styles.pillWarn}>Out of stock</Text>
                    ) : item.canRedeem ? (
                      <Text style={styles.pillOk}>Redeem</Text>
                    ) : (
                      <Text style={styles.pillMuted}>Need more pts</Text>
                    )}
                  </View>
                  {item.description ? (
                    <Text style={styles.cardDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </StateBlock>
          </>
        ) : null}

        {tab === 'board' ? (
          <>
            <ChipRow items={METRICS} value={metric} onChange={setMetric} />
            <ChipRow items={SCOPES} value={scope} onChange={setScope} />
            <ChipRow items={PERIODS} value={period} onChange={setPeriod} />
            {metric === 'rating' ? (
              <Text style={styles.sectionHint}>
                Rating scores stay 0 until you have 5 ratings.
              </Text>
            ) : null}
            {board.data?.me ? (
              <View style={styles.meCard}>
                <Medal color="#EA4B14" size={20} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.meTitle}>
                    Your rank #{board.data.me.rank ?? '—'}
                  </Text>
                  <Text style={styles.meMeta}>
                    Score {board.data.me.score ?? 0}
                    {board.data.me.totalRiders
                      ? ` · ${board.data.me.totalRiders} riders`
                      : ''}
                    {board.data.city ? ` · ${board.data.city}` : ''}
                  </Text>
                </View>
              </View>
            ) : null}
            <StateBlock
              loading={board.isLoading && !board.data}
              error={
                board.isError && !board.data
                  ? formatIncentiveError(
                      board.error,
                      'Could not load the leaderboard.'
                    )
                  : null
              }
              empty={(board.data?.items.length ?? 0) === 0}
              emptyText="No riders on this board yet."
              onRetry={() => void board.refetch()}
            >
              {(board.data?.items ?? []).map((row) => (
                <View
                  key={`${row.rank}-${row.partnerId ?? row.nameMasked}`}
                  style={[styles.rankRow, row.isMe && styles.rankMe]}
                >
                  <Text style={styles.rank}>#{row.rank}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rankName}>
                      {row.nameMasked}
                      {row.isMe ? ' · you' : ''}
                    </Text>
                    <Text style={styles.rankMeta}>
                      {row.deliveries ?? row.score} trips
                      {row.avgRating ? ` · ${row.avgRating.toFixed(1)}★` : ''}
                      {row.streak ? ` · ${row.streak} streak` : ''}
                    </Text>
                  </View>
                  <Text style={styles.rankScore}>{row.score}</Text>
                </View>
              ))}
            </StateBlock>
            {boardZoneError ? (
              <Pressable
                onPress={() => router.push(DELIVERY_ROUTES.home)}
                style={styles.retry}
              >
                <Text style={styles.retryText}>Set zone on Home</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}

        {tab === 'history' ? (
          <>
            <View style={styles.pointsCard}>
              <View>
                <Text style={styles.heroLabel}>Credited bonuses</Text>
                <Text style={styles.pointsValue}>{formatCurrency(totalBonus)}</Text>
              </View>
              <Trophy color="#EA4B14" size={22} />
            </View>
            <StateBlock
              loading={history.isLoading && !history.data}
              error={
                history.isError && !history.data
                  ? formatIncentiveError(history.error, 'Could not load credits.')
                  : null
              }
              empty={historyRows.length === 0}
              emptyText="No incentive credits yet. Hit a slab to earn one."
              onRetry={() => void history.refetch()}
            >
              {historyRows.map((row) => (
                <Pressable
                  key={row.historyId}
                  onPress={() =>
                    row.incentiveId
                      ? setOpenId(row.incentiveId)
                      : undefined
                  }
                  style={styles.historyRow}
                >
                  <View style={styles.historyIcon}>
                    <Zap color="#EA4B14" size={16} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {row.title ?? 'Bonus'}
                    </Text>
                    <Text style={styles.rankMeta}>
                      {row.periodKey ?? ''}
                      {row.slabTarget ? ` · slab ${row.slabTarget}` : ''}
                      {row.creditedAt ? ` · ${when(row.creditedAt)}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.cardBonus}>{formatCurrency(row.bonusInr)}</Text>
                </Pressable>
              ))}
            </StateBlock>
            {history.hasNextPage ? (
              <Pressable
                onPress={() => void history.fetchNextPage()}
                disabled={history.isFetchingNextPage}
                style={styles.retry}
              >
                {history.isFetchingNextPage ? (
                  <ActivityIndicator color="#EA4B14" />
                ) : (
                  <Text style={styles.retryText}>Load more</Text>
                )}
              </Pressable>
            ) : null}
          </>
        ) : null}
      </ScrollView>

      <IncentiveDetailSheet
        incentiveId={openId}
        seed={openSeed}
        onClose={() => {
          setOpenId(null);
          setOpenSeed(null);
        }}
      />
      <RedeemSheet
        item={redeemItem}
        points={points}
        onClose={() => setRedeemItem(null)}
      />
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#111827',
  },
  hero: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  heroLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  heroValue: {
    fontFamily: fonts.extraBold,
    fontSize: 32,
    color: '#111827',
    marginTop: 2,
  },
  heroRight: { alignItems: 'flex-end', gap: 6 },
  heroMeta: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#9A3412',
    maxWidth: 120,
    textAlign: 'right',
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
  tabOn: { backgroundColor: '#FFFFFF' },
  tabText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
  },
  tabTextOn: { color: '#111827' },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  section: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
    marginTop: 10,
    marginBottom: 4,
  },
  sectionHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  cardTitle: {
    flex: 1,
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#111827',
  },
  cardBonus: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#EA4B14',
  },
  cardDesc: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 10,
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  pill: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#9A3412',
    backgroundColor: '#FFEDD5',
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
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: '#EA4B14', borderRadius: 3 },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  progressText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#6B7280',
  },
  pointsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    gap: 16,
  },
  pointsValue: {
    fontFamily: fonts.extraBold,
    fontSize: 28,
    color: '#111827',
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#6B7280',
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#111827',
    marginTop: 2,
    textAlign: 'right',
  },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
  },
  filterChipOn: { backgroundColor: '#EA4B14' },
  filterText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#4B5563',
  },
  filterTextOn: { color: '#FFFFFF' },
  meCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  meTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#9A3412',
  },
  meMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#C2410C',
    marginTop: 2,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  rankMe: { borderColor: '#EA4B14', backgroundColor: '#FFF7ED' },
  rank: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#6B7280',
    width: 36,
  },
  rankName: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#111827',
  },
  rankMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  rankScore: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#111827',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  historyIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
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
  retry: {
    alignSelf: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
  },
  retryText: {
    fontFamily: fonts.semiBold,
    color: authTheme.brand,
  },
});
