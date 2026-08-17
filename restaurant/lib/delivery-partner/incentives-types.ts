/**
 * Rider incentives, rewards, quests, challenges, leaderboard.
 * GET/POST /partners/me/{incentives,rewards,quests,challenges}
 * GET /partners/leaderboard
 */

export type IncentiveKind =
  | 'delivery_count'
  | 'streak'
  | 'earnings'
  | 'peak_hours'
  | string;

export type IncentiveWindow = 'day' | 'week' | 'month' | string;

export type IncentiveSlab = {
  target: number;
  bonusInr: number;
  label?: string;
  achieved?: boolean;
  credited?: boolean;
};

export type IncentiveProgress = {
  incentiveId: string;
  code?: string;
  title?: string;
  kind?: IncentiveKind;
  window?: IncentiveWindow;
  periodKey?: string;
  periodFrom?: string;
  periodTo?: string;
  metric: number;
  metricLabel?: string;
  slabs: IncentiveSlab[];
  currentSlab?: IncentiveSlab | null;
  nextSlab?: IncentiveSlab | null;
  bonusEarnedInr: number;
  bonusPendingInr: number;
  optedIn: boolean;
  requiresOptIn: boolean;
  eligible: boolean;
  ineligibilityReason?: string | null;
  endsAt?: string;
};

export type IncentiveProgram = {
  incentiveId: string;
  code?: string;
  title: string;
  description?: string;
  kind?: IncentiveKind;
  window?: IncentiveWindow;
  requiresOptIn: boolean;
  optedIn: boolean;
  status?: string;
  startAt?: string;
  endAt?: string | null;
  slabs: IncentiveSlab[];
  progress?: IncentiveProgress;
};

export type IncentiveList = {
  timezone?: string;
  items: IncentiveProgram[];
};

export type IncentiveHistoryRow = {
  historyId: string;
  incentiveId?: string;
  code?: string;
  title?: string;
  periodKey?: string;
  slabTarget?: number;
  bonusInr: number;
  creditedAt?: string;
};

export type IncentiveHistory = {
  timezone?: string;
  totalBonusInr: number;
  items: IncentiveHistoryRow[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type RewardBalance = {
  points: number;
  lifetimeEarned: number;
  redeemed: number;
  pointsPerDelivery: number;
  currency: string;
};

export type RewardCatalogItem = {
  itemId: string;
  sku?: string;
  title: string;
  description?: string;
  kind?: string;
  pointsCost: number;
  valueInr?: number;
  stock?: number | null;
  inStock: boolean;
  imageUrl?: string | null;
  terms?: string;
  canRedeem: boolean;
};

export type RewardCatalog = {
  timezone?: string;
  points: number;
  items: RewardCatalogItem[];
};

export type RewardRedemption = {
  redemptionId: string;
  itemId?: string;
  sku?: string;
  title?: string;
  kind?: string;
  pointsSpent: number;
  status: string;
  voucherCode?: string | null;
  valueInr?: number;
  pointsBalanceAfter?: number;
  redeemedAt?: string;
};

export type LeaderboardMetric = 'deliveries' | 'rating' | 'streak';
export type LeaderboardScope = 'zone' | 'city';
export type LeaderboardPeriod = 'today' | 'week' | 'month';

export type LeaderboardRow = {
  rank: number;
  partnerId?: string;
  nameMasked: string;
  score: number;
  avgRating?: number;
  streak?: number;
  deliveries?: number;
  isMe: boolean;
};

export type Leaderboard = {
  metric: LeaderboardMetric;
  scope: LeaderboardScope;
  period: LeaderboardPeriod;
  timezone?: string;
  zoneId?: string;
  city?: string;
  periodFrom?: string;
  periodTo?: string;
  me?: { rank?: number; score?: number; totalRiders?: number };
  items: LeaderboardRow[];
};

export function incentiveKindLabel(kind?: string) {
  const key = (kind ?? '').toLowerCase();
  if (key === 'delivery_count') return 'Trips';
  if (key === 'streak') return 'Streak';
  if (key === 'earnings') return 'Earnings';
  if (key === 'peak_hours') return 'Peak hours';
  return key ? key.replace(/_/g, ' ') : 'Program';
}

export function rewardKindLabel(kind?: string) {
  const key = (kind ?? '').toLowerCase();
  if (key === 'voucher') return 'Voucher';
  if (key === 'fuel' || key === 'fuel_credit') return 'Fuel';
  if (key === 'merchandise') return 'Merchandise';
  return key ? key.replace(/_/g, ' ') : 'Reward';
}

export function metricLabelCopy(label?: string) {
  const key = (label ?? '').toLowerCase();
  if (key === 'deliveries') return 'trips';
  if (key === 'streak_days') return 'streak days';
  if (key === 'earnings_inr') return '₹ earned';
  if (key === 'peak_deliveries') return 'peak trips';
  return key ? key.replace(/_/g, ' ') : 'progress';
}

export function incentiveWindowLabel(window?: string) {
  const key = (window ?? '').toLowerCase();
  if (key === 'day') return 'Today';
  if (key === 'week') return 'This week';
  if (key === 'month') return 'This month';
  return key ? key.replace(/_/g, ' ') : '';
}
