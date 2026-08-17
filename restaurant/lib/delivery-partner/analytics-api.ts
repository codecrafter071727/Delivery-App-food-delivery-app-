import axios from 'axios';

import { api, assertApiBaseUrl } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/errors';
import type {
  EarningsPeriod,
  EarningsPeriodKey,
  PartnerDailyEarning,
  PartnerDailyEarningsResult,
  PartnerEarningsSummary,
  PartnerIncentive,
  PartnerIncentivesResult,
  PartnerPerformance,
  PartnerRatingBucket,
} from '@/lib/delivery-partner/analytics-types';

const ME_BASE = '/api/v1/delivery-service/partners/me';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function unwrap(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!Object.keys(record).length) return payload;
  if ('data' in record) {
    const data = record.data;
    const nested = asRecord(data);
    if (nested && 'data' in nested && !Array.isArray(nested.data)) {
      return nested.data;
    }
    return data;
  }
  return payload;
}

async function getJson<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<Envelope<T>> {
  assertApiBaseUrl();
  try {
    const response = await api.get<Envelope<T> | T>(path, {
      params,
    });
    const payload = response.data as Envelope<T> | T;
    if (
      payload &&
      typeof payload === 'object' &&
      ('data' in (payload as object) || 'success' in (payload as object))
    ) {
      return payload as Envelope<T>;
    }
    return { success: true, data: payload as T };
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      throw new Error(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    throw new Error(getApiErrorMessage(error, 'Request failed'));
  }
}

function mapRatingDistribution(raw: unknown): PartnerRatingBucket[] | undefined {
  if (!raw) return undefined;

  if (Array.isArray(raw)) {
    const buckets = raw
      .map((row) => {
        const record = asRecord(row);
        const count =
          pickNumber(record, ['count', 'total', 'value', 'reviews']) ?? 0;
        const stars = pickNumber(record, ['stars', 'rating', 'star']);
        const label =
          pickString(record, ['label', 'name', 'key']) ??
          (stars != null ? (stars < 3 ? '<3★' : `${stars}★`) : undefined);
        if (!label && stars == null && count <= 0) return null;
        return {
          label: label ?? `${stars ?? 0}★`,
          stars: stars ?? undefined,
          count,
          percent: pickNumber(record, ['percent', 'percentage', 'pct']),
        } satisfies PartnerRatingBucket;
      })
      .filter(Boolean) as PartnerRatingBucket[];
    return buckets.length ? buckets : undefined;
  }

  const record = asRecord(raw);
  const buckets: PartnerRatingBucket[] = [];
  for (const [key, value] of Object.entries(record)) {
    const count = Number(value);
    if (!Number.isFinite(count)) continue;
    const starsMatch = key.match(/([1-5])/);
    const stars = starsMatch ? Number(starsMatch[1]) : undefined;
    buckets.push({
      label: key.includes('<') || key.toLowerCase().includes('below')
        ? '<3★'
        : stars != null
          ? `${stars}★`
          : key,
      stars,
      count,
    });
  }
  return buckets.length ? buckets : undefined;
}

function mapPerformance(raw: unknown): PartnerPerformance {
  const root = asRecord(unwrap(raw));
  const source = asRecord(
    root.performance ?? root.stats ?? root.metrics ?? root
  );
  const rates = asRecord(source.rates ?? source);

  const distribution =
    mapRatingDistribution(
      source.ratingDistribution ??
        source.ratingsBreakdown ??
        source.ratingBreakdown ??
        source.starDistribution ??
        source.ratings
    ) ?? undefined;

  const milestonesRaw =
    source.streakMilestones ?? source.milestones ?? source.streakTargets;
  const streakMilestones = Array.isArray(milestonesRaw)
    ? milestonesRaw
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n > 0)
    : undefined;

  const score = pickNumber(source, [
    'performanceScore',
    'score',
    'partnerScore',
    'ratingScore',
  ]);

  return {
    totalDeliveries:
      pickNumber(source, [
        'totalDeliveries',
        'deliveries',
        'completedDeliveries',
        'totalOrders',
        'ordersCompleted',
      ]) ?? 0,
    avgRating:
      pickNumber(source, [
        'avgRating',
        'averageRating',
        'rating',
        'meanRating',
      ]) ?? 0,
    completionRate:
      pickNumber(source, ['completionRate', 'completeRate']) ??
      pickNumber(rates, ['completion', 'completionRate']) ??
      0,
    acceptanceRate:
      pickNumber(source, ['acceptanceRate', 'acceptRate']) ??
      pickNumber(rates, ['acceptance', 'acceptanceRate']) ??
      0,
    onTimeRate:
      pickNumber(source, ['onTimeRate', 'ontimeRate', 'punctualityRate']) ??
      pickNumber(rates, ['onTime', 'onTimeRate', 'ontime']) ??
      0,
    cancellationRate:
      pickNumber(source, [
        'cancellationRate',
        'cancelRate',
        'notCancelledRate',
      ]) ??
      pickNumber(rates, ['cancellation', 'cancellationRate', 'cancel']) ??
      0,
    currentStreak:
      pickNumber(source, [
        'currentStreak',
        'streak',
        'deliveryStreak',
        'streakDays',
      ]) ?? 0,
    performanceScore: score,
    scoreLabel: pickString(source, [
      'scoreLabel',
      'performanceLabel',
      'ratingLabel',
      'grade',
    ]),
    ratingCount: pickNumber(source, [
      'ratingCount',
      'totalRatings',
      'reviewsCount',
      'reviewCount',
    ]),
    ratingDistribution: distribution,
    streakMilestones:
      streakMilestones && streakMilestones.length
        ? streakMilestones
        : undefined,
    tier: (() => {
      const tier = asRecord(source.tier);
      const code = pickString(tier, ['code', 'tier']);
      const label = pickString(tier, ['label', 'name']);
      if (!code && !label) return undefined;
      return { code: (code ?? 'bronze').toLowerCase(), label: label ?? code ?? 'Bronze' };
    })(),
    zoneRank: (() => {
      const rank = asRecord(source.zoneRank);
      const position = pickNumber(rank, ['rank', 'position']);
      if (position == null) return undefined;
      return {
        metric: pickString(rank, ['metric']) ?? 'deliveries',
        period: pickString(rank, ['period']) ?? 'week',
        rank: position,
        total: pickNumber(rank, ['total', 'totalRiders']) ?? 0,
      };
    })(),
    openWarnings: pickNumber(source, ['openWarnings', 'warnings']),
    atRisk:
      typeof source.atRisk === 'boolean' ? source.atRisk : undefined,
    raw: source,
  };
}

function formatDayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
}

function mapDailyPoint(raw: unknown): PartnerDailyEarning | null {
  const record = asRecord(raw);
  const date =
    pickString(record, ['date', 'day', 'createdAt', 'timestamp']) ?? '';
  if (!date && !Object.keys(record).length) return null;

  const baseEarnings = pickNumber(record, [
    'baseEarnings',
    'base',
    'deliveryFee',
    'tripEarnings',
  ]);
  const incentives = pickNumber(record, [
    'incentives',
    'bonuses',
    'bonus',
    'incentiveEarnings',
  ]);
  const tips = pickNumber(record, ['tips', 'tip', 'customerReceived']);
  const earnings =
    pickNumber(record, [
      'earnings',
      'earning',
      'amount',
      'total',
      'revenue',
      'netEarnings',
      'totalEarnings',
    ]) ??
    (baseEarnings ?? 0) + (incentives ?? 0) + (tips ?? 0);

  return {
    date: date || '—',
    label:
      pickString(record, ['label', 'dayLabel']) ??
      (date ? formatDayLabel(date) : '—'),
    orders:
      pickNumber(record, [
        'orders',
        'orderCount',
        'deliveries',
        'deliveryCount',
        'trips',
        'count',
        'totalOrders',
      ]) ?? 0,
    earnings,
    baseEarnings: baseEarnings ?? undefined,
    incentives: incentives ?? undefined,
    tips: tips ?? undefined,
  };
}

function extractDailyList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  for (const key of [
    'days',
    'daily',
    'items',
    'points',
    'series',
    'results',
    'earnings',
    'data',
  ]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function emptyPeriod(): EarningsPeriod {
  return {
    totalEarnings: 0,
    baseEarnings: 0,
    incentives: 0,
    tips: 0,
    deductions: 0,
    totalDeliveries: 0,
    onlineHours: 0,
  };
}

function mapPeriod(raw: unknown): EarningsPeriod {
  const record = asRecord(raw);
  if (!Object.keys(record).length) return emptyPeriod();
  return {
    from: pickString(record, ['from', 'start', 'dateFrom']),
    to: pickString(record, ['to', 'end', 'dateTo']),
    totalEarnings:
      pickNumber(record, ['totalEarnings', 'earnings', 'total', 'netEarnings']) ??
      0,
    baseEarnings:
      pickNumber(record, ['baseEarnings', 'base', 'deliveryEarnings']) ?? 0,
    incentives: pickNumber(record, ['incentives', 'bonuses', 'bonus']) ?? 0,
    tips: pickNumber(record, ['tips', 'tip']) ?? 0,
    deductions: pickNumber(record, ['deductions', 'penalties', 'charges']) ?? 0,
    totalDeliveries:
      pickNumber(record, [
        'totalDeliveries',
        'deliveries',
        'orders',
        'totalOrders',
      ]) ?? 0,
    onlineHours:
      pickNumber(record, ['onlineHours', 'hoursOnline', 'activeHours']) ?? 0,
  };
}

function mapEarningsSummary(raw: unknown): PartnerEarningsSummary {
  const root = asRecord(unwrap(raw));
  const payoutSource = asRecord(
    root.payout ?? root.payoutAccount ?? root.bankAccount ?? root.bank
  );
  const bankAccountNo = pickString(payoutSource, [
    'bankAccountNo',
    'accountNumber',
    'accountNo',
  ]);
  const ifscCode = pickString(payoutSource, ['ifscCode', 'ifsc', 'IFSC']);
  const upiId = pickString(payoutSource, ['upiId', 'upi', 'vpa']);
  const lifetimeRaw = asRecord(root.lifetime);
  const hasPeriods = Boolean(root.today || root.week || root.month);
  const flat = hasPeriods ? emptyPeriod() : mapPeriod(root);

  return {
    timezone: pickString(root, ['timezone']) ?? 'Asia/Kolkata',
    today: hasPeriods ? mapPeriod(root.today) : flat,
    week: hasPeriods ? mapPeriod(root.week) : flat,
    month: hasPeriods ? mapPeriod(root.month) : flat,
    lifetime: {
      totalEarnings:
        pickNumber(lifetimeRaw, ['totalEarnings', 'earnings', 'total']) ??
        (hasPeriods ? 0 : flat.totalEarnings),
      totalDeliveries:
        pickNumber(lifetimeRaw, ['totalDeliveries', 'deliveries', 'orders']) ??
        (hasPeriods ? 0 : flat.totalDeliveries),
    },
    currency: pickString(root, ['currency']) ?? 'INR',
    payout:
      bankAccountNo || ifscCode || upiId
        ? {
            bankAccountNo,
            ifscCode,
            upiId,
            accountHolderName: pickString(payoutSource, [
              'accountHolderName',
              'holderName',
              'name',
            ]),
            bankName: pickString(payoutSource, ['bankName', 'bank']),
          }
        : undefined,
    raw: root,
  };
}

export function selectEarningsPeriod(
  summary: PartnerEarningsSummary | undefined,
  key: EarningsPeriodKey
): EarningsPeriod {
  if (!summary) return emptyPeriod();
  if (key === 'lifetime') {
    return {
      ...emptyPeriod(),
      totalEarnings: summary.lifetime.totalEarnings,
      totalDeliveries: summary.lifetime.totalDeliveries,
    };
  }
  return summary[key] ?? emptyPeriod();
}

function formatMoney(amount?: number, currency = 'INR') {
  if (amount == null || !Number.isFinite(amount)) return undefined;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${Math.round(amount)}`;
  }
}

function mapIncentive(raw: unknown, index: number): PartnerIncentive | null {
  const record = asRecord(raw);
  if (!Object.keys(record).length) return null;

  const nested = asRecord(record.progress);
  const nextSlab = asRecord(nested.nextSlab);
  const slabs = Array.isArray(record.slabs) ? record.slabs : [];
  const lastSlab = asRecord(slabs[slabs.length - 1]);

  const id =
    pickString(record, ['_id', 'id', 'incentiveId', 'programId', 'code']) ??
    `incentive-${index}`;
  const title =
    pickString(record, [
      'title',
      'name',
      'programName',
      'incentiveName',
      'label',
    ]) ??
    pickString(nested, ['title', 'name']) ??
    'Incentive';

  const progress =
    pickNumber(nested, ['metric', 'current', 'progress', 'value']) ??
    pickNumber(record, [
      'progress',
      'current',
      'completed',
      'achieved',
      'currentValue',
    ]);
  const target =
    pickNumber(nextSlab, ['target', 'threshold']) ??
    pickNumber(lastSlab, ['target', 'threshold']) ??
    pickNumber(record, [
      'target',
      'goal',
      'required',
      'threshold',
      'targetValue',
    ]);

  let progressLabel = pickString(record, [
    'progressLabel',
    'progressText',
    'statusText',
  ]);
  if (!progressLabel && progress != null && target != null && target > 0) {
    progressLabel = `${progress} / ${target}`;
  }

  const amount =
    pickNumber(nested, ['bonusPendingInr', 'bonusEarnedInr']) ??
    pickNumber(nextSlab, ['bonusInr', 'bonus']) ??
    pickNumber(lastSlab, ['bonusInr', 'bonus']) ??
    pickNumber(record, [
      'amount',
      'bonus',
      'bonusAmount',
      'reward',
      'rewardAmount',
      'incentiveAmount',
    ]);
  const currency = pickString(record, ['currency']) ?? 'INR';

  return {
    id,
    title,
    description: pickString(record, [
      'description',
      'details',
      'subtitle',
      'info',
      'message',
    ]),
    status: pickString(record, ['status', 'state', 'eligibility']),
    type: pickString(record, ['type', 'category', 'incentiveType', 'kind']),
    amount,
    currency,
    progress,
    target,
    progressLabel,
    startsAt: pickString(record, ['startsAt', 'startDate', 'from', 'startAt']),
    endsAt: pickString(record, [
      'endsAt',
      'endDate',
      'to',
      'expiresAt',
      'endAt',
    ]),
    raw: record,
  };
}

function extractIncentiveList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  for (const key of [
    'incentives',
    'programs',
    'bonuses',
    'items',
    'results',
    'list',
    'data',
  ]) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function mapIncentives(raw: unknown): PartnerIncentivesResult {
  const root = unwrap(raw);
  const list = extractIncentiveList(root)
    .map((row, index) => mapIncentive(row, index))
    .filter(Boolean) as PartnerIncentive[];
  return { incentives: list };
}

export const partnerAnalyticsApi = {
  /** GET /partners/me/performance */
  getPerformance: async (): Promise<PartnerPerformance> => {
    const res = await getJson<unknown>(`${ME_BASE}/performance`);
    return mapPerformance(res.data ?? res);
  },

  /** GET /partners/me/earnings — IST today / week / month / lifetime (no query). */
  getEarnings: async (): Promise<PartnerEarningsSummary> => {
    const res = await getJson<unknown>(`${ME_BASE}/earnings`);
    return mapEarningsSummary(res.data ?? res);
  },

  /** GET /partners/me/earnings/daily?days= */
  getDailyEarnings: async (
    days = 30
  ): Promise<PartnerDailyEarningsResult> => {
    const res = await getJson<unknown>(`${ME_BASE}/earnings/daily`, { days });
    const root = unwrap(res.data ?? res);
    const points = extractDailyList(root)
      .map(mapDailyPoint)
      .filter(Boolean) as PartnerDailyEarning[];
    return { days, points };
  },

  /** GET /partners/me/incentives */
  getIncentives: async (): Promise<PartnerIncentivesResult> => {
    const res = await getJson<unknown>(`${ME_BASE}/incentives`);
    return mapIncentives(res.data ?? res);
  },
};

export function formatIncentiveAmount(
  amount?: number,
  currency = 'INR'
): string | undefined {
  return formatMoney(amount, currency);
}

export function formatCurrency(amount?: number, currency = 'INR') {
  if (amount == null || !Number.isFinite(amount)) {
    return formatMoney(0, currency) ?? '₹0';
  }
  return formatMoney(amount, currency) ?? `₹${Math.round(amount)}`;
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return '0%';
  const n = value > 0 && value <= 1 ? value * 100 : value;
  return `${n.toFixed(1)}%`;
}

export function formatRating(value: number) {
  if (!Number.isFinite(value)) return '0.0';
  return value.toFixed(1);
}

export function formatHours(value: number) {
  if (!Number.isFinite(value)) return '0.0h';
  return `${value.toFixed(1)}h`;
}

export function lastNDays(
  points: PartnerDailyEarning[],
  n: number
): PartnerDailyEarning[] {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );
  return sorted.slice(-n);
}
