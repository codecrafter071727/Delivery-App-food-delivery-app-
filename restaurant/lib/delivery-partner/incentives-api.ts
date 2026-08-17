/**
 * Rider incentives, rewards, quests, challenges, leaderboard — live gateway.
 * Paths: GET/POST /partners/me/{incentives,rewards,quests,challenges}
 *         GET /partners/leaderboard
 */
import axios from 'axios';

import { API_BASE_URL, api, assertApiBaseUrl } from '@/lib/api';
import { PartnerApiError } from '@/lib/errors';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import type {
  IncentiveHistory,
  IncentiveHistoryRow,
  IncentiveList,
  IncentiveProgress,
  IncentiveProgram,
  IncentiveSlab,
  Leaderboard,
  LeaderboardMetric,
  LeaderboardPeriod,
  LeaderboardRow,
  LeaderboardScope,
  RewardBalance,
  RewardCatalog,
  RewardCatalogItem,
  RewardRedemption,
} from './incentives-types';

const ME = '/api/v1/delivery-service/partners/me';
const PARTNERS = '/api/v1/delivery-service/partners';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickString(
  record: Record<string, unknown> | undefined,
  keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(
  record: Record<string, unknown> | undefined,
  keys: string[],
  fallback = 0
): number {
  if (!record) return fallback;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function pickBool(
  record: Record<string, unknown> | undefined,
  keys: string[],
  fallback = false
): boolean {
  if (!record) return fallback;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return fallback;
}

function unwrapData(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload) ?? {};
  const nested = asRecord(root.data);
  if (
    nested &&
    ('items' in nested ||
      'data' in nested ||
      'incentiveId' in nested ||
      'points' in nested ||
      'redemptionId' in nested ||
      'metric' in nested ||
      'timezone' in nested)
  ) {
    return nested;
  }
  return root;
}

function unwrapList(payload: unknown): unknown[] {
  const data = unwrapData(payload);
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  const nested = asRecord(data.data);
  if (nested && Array.isArray(nested.data)) return nested.data;
  const root = asRecord(payload);
  if (Array.isArray(root?.items)) return root.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function readErrorCode(payload: unknown): string | undefined {
  const root = asRecord(payload);
  if (!root) return undefined;
  const nested = asRecord(root.data);
  const errorObj = asRecord(
    typeof root.error === 'object' ? root.error : undefined
  );
  const code =
    pickString(nested, ['code']) ??
    pickString(root, ['code']) ??
    pickString(errorObj, ['code']);
  return code ? code.toUpperCase().replace(/[\s-]+/g, '_') : undefined;
}

function newIdempotencyKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
    idempotencyKey?: string;
  } = {}
): Promise<T> {
  const { method = 'GET', body, params, idempotencyKey } = options;
  assertApiBaseUrl();
  try {
    const response = await api.request<T>({
      url: path,
      method,
      params,
      data: method === 'GET' ? undefined : (body ?? {}),
      headers: idempotencyKey
        ? { 'Idempotency-Key': idempotencyKey }
        : undefined,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      throw new PartnerApiError(
        `Cannot reach ${API_BASE_URL}. Check Wi‑Fi and try again.`,
        'NETWORK_ERROR'
      );
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const code =
        readErrorCode(error.response?.data) ??
        (status === 401 || status === 403
          ? 'UNAUTHORIZED'
          : status === 404
            ? 'NOT_FOUND'
            : status === 409
              ? 'CONFLICT'
              : status === 429
                ? 'RATE_LIMITED'
                : 'REQUEST_FAILED');
      throw new PartnerApiError(
        formatTripError(error, 'Could not complete this request. Try again.'),
        code
      );
    }
    throw error;
  }
}

function mapSlab(raw: unknown): IncentiveSlab {
  const row = asRecord(raw) ?? {};
  return {
    target: pickNumber(row, ['target', 'threshold', 'count']),
    bonusInr: pickNumber(row, ['bonusInr', 'bonus', 'amount', 'payoutInr']),
    label: pickString(row, ['label', 'name']),
    achieved: pickBool(row, ['achieved', 'unlocked']),
    credited: pickBool(row, ['credited', 'paid']),
  };
}

function mapProgress(raw: unknown): IncentiveProgress | undefined {
  const row = asRecord(raw);
  if (!row) return undefined;
  const slabs = asList(row.slabs).map(mapSlab);
  const current = asRecord(row.currentSlab);
  const next = asRecord(row.nextSlab);
  return {
    incentiveId: pickString(row, ['incentiveId', 'id']) ?? '',
    code: pickString(row, ['code']),
    title: pickString(row, ['title', 'name']),
    kind: pickString(row, ['kind', 'type']),
    window: pickString(row, ['window', 'period']),
    periodKey: pickString(row, ['periodKey']),
    periodFrom: pickString(row, ['periodFrom', 'from']),
    periodTo: pickString(row, ['periodTo', 'to']),
    metric: pickNumber(row, ['metric', 'current', 'progress', 'value']),
    metricLabel: pickString(row, ['metricLabel', 'unit']),
    slabs,
    currentSlab: current ? mapSlab(current) : null,
    nextSlab: next ? mapSlab(next) : null,
    bonusEarnedInr: pickNumber(row, ['bonusEarnedInr', 'earnedInr', 'bonusEarned']),
    bonusPendingInr: pickNumber(row, ['bonusPendingInr', 'pendingInr', 'bonusPending']),
    optedIn: pickBool(row, ['optedIn']),
    requiresOptIn: pickBool(row, ['requiresOptIn']),
    eligible: pickBool(row, ['eligible'], true),
    ineligibilityReason: pickString(row, ['ineligibilityReason', 'reason']) ?? null,
    endsAt: pickString(row, ['endsAt', 'endAt']),
  };
}

function mapProgram(raw: unknown): IncentiveProgram | null {
  const row = asRecord(raw);
  if (!row) return null;
  const incentiveId =
    pickString(row, ['incentiveId', 'id', 'code']) ?? '';
  if (!incentiveId) return null;
  const nestedProgress = mapProgress(row.progress);
  return {
    incentiveId,
    code: pickString(row, ['code']),
    title:
      pickString(row, ['title', 'name']) ??
      nestedProgress?.title ??
      'Incentive',
    description: pickString(row, ['description', 'subtitle', 'detail']),
    kind: pickString(row, ['kind', 'type']) ?? nestedProgress?.kind,
    window: pickString(row, ['window', 'period']) ?? nestedProgress?.window,
    requiresOptIn: pickBool(row, ['requiresOptIn'], nestedProgress?.requiresOptIn ?? false),
    optedIn: pickBool(row, ['optedIn'], nestedProgress?.optedIn ?? false),
    status: pickString(row, ['status']),
    startAt: pickString(row, ['startAt', 'startsAt']),
    endAt: pickString(row, ['endAt', 'endsAt']) ?? null,
    slabs: asList(row.slabs).map(mapSlab),
    progress: nestedProgress,
  };
}

function mapList(payload: unknown): IncentiveList {
  const data = unwrapData(payload);
  return {
    timezone: pickString(data, ['timezone']),
    items: unwrapList(payload)
      .map(mapProgram)
      .filter((row): row is IncentiveProgram => Boolean(row)),
  };
}

function mapHistoryRow(raw: unknown): IncentiveHistoryRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  return {
    historyId:
      pickString(row, ['historyId', 'id', 'creditId']) ??
      `${pickString(row, ['incentiveId']) ?? 'bonus'}-${pickString(row, ['creditedAt']) ?? Date.now()}`,
    incentiveId: pickString(row, ['incentiveId']),
    code: pickString(row, ['code']),
    title: pickString(row, ['title', 'name']),
    periodKey: pickString(row, ['periodKey']),
    slabTarget: pickNumber(row, ['slabTarget', 'target']),
    bonusInr: pickNumber(row, ['bonusInr', 'amount', 'bonus']),
    creditedAt: pickString(row, ['creditedAt', 'createdAt']),
  };
}

export function mapIncentiveHistory(payload: unknown): IncentiveHistory {
  const data = unwrapData(payload);
  const nested = asRecord(data.data) ?? data;
  const items = (Array.isArray(nested.data) ? nested.data : unwrapList(payload))
    .map(mapHistoryRow)
    .filter((row): row is IncentiveHistoryRow => Boolean(row));
  const page = pickNumber(nested, ['page'], 1);
  const limit = pickNumber(nested, ['limit'], 20);
  const total = pickNumber(nested, ['total'], items.length);
  const totalPages = pickNumber(nested, ['totalPages'], Math.max(1, Math.ceil(total / Math.max(limit, 1))));
  return {
    timezone: pickString(data, ['timezone']) ?? pickString(nested, ['timezone']),
    totalBonusInr: pickNumber(data, ['totalBonusInr', 'totalBonus']) || pickNumber(nested, ['totalBonusInr']),
    items,
    page,
    limit,
    total,
    hasNext: page < totalPages,
  };
}

function mapCatalogItem(raw: unknown, points: number): RewardCatalogItem | null {
  const row = asRecord(raw);
  if (!row) return null;
  const itemId = pickString(row, ['itemId', 'id', 'sku']) ?? '';
  if (!itemId) return null;
  const pointsCost = pickNumber(row, ['pointsCost', 'cost', 'points']);
  const stockRaw = row.stock;
  const stock =
    stockRaw === null || stockRaw === undefined
      ? null
      : pickNumber(row, ['stock']);
  const inStock =
    pickBool(row, ['inStock', 'available'], stock === null || stock > 0);
  return {
    itemId,
    sku: pickString(row, ['sku']),
    title: pickString(row, ['title', 'name']) ?? 'Reward',
    description: pickString(row, ['description', 'subtitle']),
    kind: pickString(row, ['kind', 'type']),
    pointsCost,
    valueInr: pickNumber(row, ['valueInr', 'value']),
    stock,
    inStock,
    imageUrl: pickString(row, ['imageUrl', 'image']) ?? null,
    terms: pickString(row, ['terms', 'tnc']),
    canRedeem:
      typeof row.canRedeem === 'boolean'
        ? row.canRedeem
        : inStock && points >= pointsCost && pointsCost > 0,
  };
}

function mapLeaderboardRow(raw: unknown): LeaderboardRow | null {
  const row = asRecord(raw);
  if (!row) return null;
  return {
    rank: pickNumber(row, ['rank', 'position'], 0),
    partnerId: pickString(row, ['partnerId', 'id']),
    nameMasked:
      pickString(row, ['nameMasked', 'name', 'displayName']) ?? 'Rider',
    score: pickNumber(row, ['score', 'value', 'metric']),
    avgRating: pickNumber(row, ['avgRating', 'rating']),
    streak: pickNumber(row, ['streak']),
    deliveries: pickNumber(row, ['deliveries', 'trips']),
    isMe: pickBool(row, ['isMe', 'me', 'isCurrentUser']),
  };
}

export async function getIncentives(): Promise<IncentiveList> {
  return mapList(await request(`${ME}/incentives`));
}

export async function getCurrentIncentives(): Promise<IncentiveList> {
  return mapList(await request(`${ME}/incentives/current`));
}

export async function getIncentiveHistory(input: {
  page?: number;
  limit?: number;
} = {}): Promise<IncentiveHistory> {
  return mapIncentiveHistory(
    await request(`${ME}/incentives/history`, {
      params: {
        page: input.page ?? 1,
        limit: input.limit ?? 20,
      },
    })
  );
}

export async function getIncentive(incentiveId: string): Promise<IncentiveProgram> {
  const id = incentiveId.trim();
  const mapped = mapProgram(unwrapData(await request(`${ME}/incentives/${encodeURIComponent(id)}`)));
  if (!mapped) {
    throw new PartnerApiError('Incentive not found.', 'INCENTIVE_NOT_FOUND');
  }
  return mapped;
}

export async function getIncentiveProgress(
  incentiveId: string
): Promise<IncentiveProgress> {
  const id = incentiveId.trim();
  const mapped = mapProgress(
    unwrapData(await request(`${ME}/incentives/${encodeURIComponent(id)}/progress`))
  );
  if (!mapped) {
    throw new PartnerApiError('Progress not found.', 'INCENTIVE_NOT_FOUND');
  }
  return {
    ...mapped,
    incentiveId: mapped.incentiveId || id,
  };
}

export async function optInIncentive(incentiveId: string): Promise<IncentiveProgram> {
  const id = incentiveId.trim();
  const mapped = mapProgram(
    unwrapData(
      await request(`${ME}/incentives/${encodeURIComponent(id)}/opt-in`, {
        method: 'POST',
        body: {},
      })
    )
  );
  if (!mapped) {
    throw new PartnerApiError('Could not opt in.', 'REQUEST_FAILED');
  }
  return mapped;
}

export async function getRewards(): Promise<RewardBalance> {
  const data = unwrapData(await request(`${ME}/rewards`));
  return {
    points: pickNumber(data, ['points', 'balance', 'availablePoints']),
    lifetimeEarned: pickNumber(data, ['lifetimeEarned', 'earned', 'totalEarned']),
    redeemed: pickNumber(data, ['redeemed', 'spent', 'totalRedeemed']),
    pointsPerDelivery: pickNumber(data, ['pointsPerDelivery'], 10),
    currency: pickString(data, ['currency']) ?? 'INR',
  };
}

export async function getRewardsCatalog(): Promise<RewardCatalog> {
  const payload = await request(`${ME}/rewards/catalog`);
  const data = unwrapData(payload);
  const points = pickNumber(data, ['points', 'balance']);
  return {
    timezone: pickString(data, ['timezone']),
    points,
    items: unwrapList(payload)
      .map((row) => mapCatalogItem(row, points))
      .filter((row): row is RewardCatalogItem => Boolean(row)),
  };
}

export async function redeemReward(input: {
  itemId?: string;
  sku?: string;
}): Promise<RewardRedemption> {
  const sku = input.sku?.trim();
  const itemId = input.itemId?.trim();
  if (!sku && !itemId) {
    throw new PartnerApiError('Choose a reward to redeem.', 'VALIDATION_ERROR');
  }
  const idempotencyKey = newIdempotencyKey();
  const body = sku
    ? { sku, idempotencyKey }
    : { itemId, idempotencyKey };
  const data = unwrapData(
    await request(`${ME}/rewards/redeem`, {
      method: 'POST',
      body,
      idempotencyKey,
    })
  );
  return {
    redemptionId: pickString(data, ['redemptionId', 'id']) ?? '',
    itemId: pickString(data, ['itemId']),
    sku: pickString(data, ['sku']),
    title: pickString(data, ['title', 'name']),
    kind: pickString(data, ['kind', 'type']),
    pointsSpent: pickNumber(data, ['pointsSpent', 'points', 'cost']),
    status: (pickString(data, ['status']) ?? 'pending').toLowerCase(),
    voucherCode: pickString(data, ['voucherCode', 'code']) ?? null,
    valueInr: pickNumber(data, ['valueInr', 'value']),
    pointsBalanceAfter: pickNumber(data, ['pointsBalanceAfter', 'pointsAfter']),
    redeemedAt: pickString(data, ['redeemedAt', 'createdAt']),
  };
}

export async function getQuests(): Promise<IncentiveList> {
  return mapList(await request(`${ME}/quests`));
}

export async function getChallenges(): Promise<IncentiveList> {
  return mapList(await request(`${ME}/challenges`));
}

export async function getLeaderboard(input: {
  metric?: LeaderboardMetric;
  scope?: LeaderboardScope;
  period?: LeaderboardPeriod;
  limit?: number;
} = {}): Promise<Leaderboard> {
  const metric = input.metric ?? 'deliveries';
  const scope = input.scope ?? 'zone';
  const period = input.period ?? 'week';
  const payload = await request(`${PARTNERS}/leaderboard`, {
    params: {
      metric,
      scope,
      period,
      limit: input.limit ?? 20,
    },
  });
  const data = unwrapData(payload);
  const me = asRecord(data.me);
  return {
    metric: (pickString(data, ['metric']) as LeaderboardMetric) ?? metric,
    scope: (pickString(data, ['scope']) as LeaderboardScope) ?? scope,
    period: (pickString(data, ['period']) as LeaderboardPeriod) ?? period,
    timezone: pickString(data, ['timezone']),
    zoneId: pickString(data, ['zoneId']),
    city: pickString(data, ['city', 'cityName']),
    periodFrom: pickString(data, ['periodFrom']),
    periodTo: pickString(data, ['periodTo']),
    me: me
      ? {
          rank: pickNumber(me, ['rank']),
          score: pickNumber(me, ['score']),
          totalRiders: pickNumber(me, ['totalRiders', 'total']),
        }
      : undefined,
    items: unwrapList(payload)
      .map(mapLeaderboardRow)
      .filter((row): row is LeaderboardRow => Boolean(row)),
  };
}

export function formatIncentiveError(error: unknown, fallback: string): string {
  return formatTripError(error, fallback);
}

export const partnerIncentivesApi = {
  getIncentives,
  getCurrentIncentives,
  getIncentiveHistory,
  getIncentive,
  getIncentiveProgress,
  optInIncentive,
  getRewards,
  getRewardsCatalog,
  redeemReward,
  getQuests,
  getChallenges,
  getLeaderboard,
};
