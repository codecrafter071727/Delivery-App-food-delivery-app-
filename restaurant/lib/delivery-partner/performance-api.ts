/**
 * Rider performance, ratings, tier, warnings, referrals — live gateway.
 */
import axios from 'axios';

import { API_BASE_URL, api, assertApiBaseUrl } from '@/lib/api';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import { PartnerApiError } from '@/lib/errors';
import type {
  PartnerRating,
  PartnerTier,
  PartnerWarning,
  PerformanceRate,
  RatingSummary,
  RatingsPage,
  ReferralCode,
  ReferralCredit,
  ReferralEarnings,
  ReferralPolicy,
  ReferredPartner,
  ReferralsPage,
  TierCriteria,
  TierRequirement,
  WarningStatus,
  WarningsPage,
} from './performance-types';

const ME = '/api/v1/delivery-service/partners/me';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
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
    ('data' in nested ||
      'items' in nested ||
      'rate' in nested ||
      'avgRating' in nested ||
      'code' in nested ||
      'current' in nested ||
      'warningId' in nested ||
      'shareUrl' in nested ||
      'totalBonusInr' in nested ||
      'timezone' in nested)
  ) {
    return nested;
  }
  return nested ?? root;
}

function unwrapList(payload: unknown): unknown[] {
  const data = unwrapData(payload);
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  const nested = asRecord(data.data);
  if (nested && Array.isArray(nested.data)) return nested.data;
  const root = asRecord(payload);
  if (Array.isArray(root?.data)) return root.data;
  if (Array.isArray(payload)) return payload;
  return [];
}

function pageMeta(data: Record<string, unknown>, items: unknown[]) {
  const nested = asRecord(data.data) ?? data;
  const page = pickNumber(nested, ['page'], 1) || pickNumber(data, ['page'], 1);
  const limit = pickNumber(nested, ['limit'], 20) || pickNumber(data, ['limit'], 20);
  const total =
    pickNumber(nested, ['total'], items.length) ||
    pickNumber(data, ['total'], items.length);
  const totalPages =
    pickNumber(nested, ['totalPages']) ||
    pickNumber(data, ['totalPages'], Math.max(1, Math.ceil(total / Math.max(limit, 1))));
  return {
    page,
    limit,
    total,
    hasNext: page < totalPages,
  };
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

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  const { method = 'GET', body, params } = options;
  assertApiBaseUrl();
  try {
    const response = await api.request<T>({
      url: path,
      method,
      params,
      data: method === 'GET' ? undefined : (body ?? {}),
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
          ? status === 403
            ? 'FORBIDDEN'
            : 'UNAUTHORIZED'
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

function mapRate(payload: unknown, fallbackMetric: string): PerformanceRate {
  const data = unwrapData(payload);
  return {
    metric: pickString(data, ['metric']) ?? fallbackMetric,
    rate: pickNumber(data, ['rate', 'value', 'percent']),
    threshold: pickNumber(data, ['threshold']),
    atRisk: pickBool(data, ['atRisk']),
    direction: pickString(data, ['direction']) ?? 'higher_is_better',
    timezone: pickString(data, ['timezone']),
    note: pickString(data, ['note', 'message']),
  };
}

function mapRating(raw: unknown): PartnerRating | null {
  const row = asRecord(raw);
  if (!row) return null;
  const ratingId = pickString(row, ['ratingId', 'id', 'reviewId']) ?? '';
  if (!ratingId) return null;
  return {
    ratingId,
    deliveryId: pickString(row, ['deliveryId']),
    orderId: pickString(row, ['orderId']),
    stars: pickNumber(row, ['stars', 'rating']),
    comment: pickString(row, ['comment', 'text', 'review']),
    source: pickString(row, ['source']),
    reviewerMasked: pickString(row, ['reviewerMasked', 'nameMasked', 'name']),
    createdAt: pickString(row, ['createdAt', 'ratedAt']),
  };
}

function mapRatingsPage(payload: unknown): RatingsPage {
  const data = unwrapData(payload);
  const items = unwrapList(payload)
    .map(mapRating)
    .filter((row): row is PartnerRating => Boolean(row));
  return { items, ...pageMeta(data, items) };
}

function mapWindow(raw: unknown): { count: number; avg: number } | undefined {
  const row = asRecord(raw);
  if (!row) return undefined;
  return {
    count: pickNumber(row, ['count']),
    avg: pickNumber(row, ['avg', 'average', 'avgRating']),
  };
}

function mapDistribution(raw: unknown): RatingSummary['distribution'] {
  const row = asRecord(raw) ?? {};
  const fromKey = (key: string) => pickNumber(row, [key, `star${key}`]);
  return {
    '1': fromKey('1'),
    '2': fromKey('2'),
    '3': fromKey('3'),
    '4': fromKey('4'),
    '5': fromKey('5'),
  };
}

function mapTier(raw: unknown): PartnerTier | null {
  const row = asRecord(raw);
  if (!row) return null;
  const code = (pickString(row, ['code', 'tier', 'tierCode']) ?? '').toLowerCase();
  const label = pickString(row, ['label', 'name']) ?? (code ? code : 'Bronze');
  const perksRaw = row.perks;
  return {
    code: code || 'bronze',
    label,
    perks: Array.isArray(perksRaw)
      ? perksRaw.filter((p): p is string => typeof p === 'string' && Boolean(p.trim()))
      : [],
    overridden: pickBool(row, ['overridden']),
    ratingCount: pickNumber(row, ['ratingCount']),
    totalDeliveries: pickNumber(row, ['totalDeliveries', 'deliveries']),
  };
}

function mapRequirement(raw: unknown): TierRequirement | null {
  const row = asRecord(raw);
  if (!row) return null;
  return {
    key: pickString(row, ['key', 'id']) ?? pickString(row, ['label']) ?? 'req',
    label: pickString(row, ['label', 'name']) ?? 'Requirement',
    current: pickNumber(row, ['current', 'value']),
    required: pickNumber(row, ['required', 'target']),
    met: pickBool(row, ['met', 'done']),
  };
}

function mapWarning(raw: unknown): PartnerWarning | null {
  const row = asRecord(raw);
  if (!row) return null;
  const warningId = pickString(row, ['warningId', 'id']) ?? '';
  if (!warningId) return null;
  return {
    warningId,
    code: pickString(row, ['code']),
    severity: pickString(row, ['severity']),
    status: (pickString(row, ['status']) ?? 'open').toLowerCase(),
    title: pickString(row, ['title', 'name']) ?? 'Warning',
    message: pickString(row, ['message', 'detail']),
    strikePoints: pickNumber(row, ['strikePoints', 'strikes', 'points']),
    autoIssued: pickBool(row, ['autoIssued']),
    issuedAt: pickString(row, ['issuedAt', 'createdAt']),
    expiresAt: pickString(row, ['expiresAt']) ?? null,
    acknowledgedAt: pickString(row, ['acknowledgedAt']) ?? null,
  };
}

function mapPolicy(raw: unknown): ReferralPolicy | undefined {
  const row = asRecord(raw);
  if (!row) return undefined;
  return {
    kycActivateInr: pickNumber(row, ['kycActivateInr', 'kycBonus']),
    firstTripsInr: pickNumber(row, ['firstTripsInr', 'tripsBonus']),
    firstTripsTarget: pickNumber(row, ['firstTripsTarget'], 10),
  };
}

function mapReferee(raw: unknown): ReferredPartner | null {
  const row = asRecord(raw);
  if (!row) return null;
  const refereeId = pickString(row, ['refereeId', 'partnerId', 'id']) ?? '';
  if (!refereeId) return null;
  return {
    refereeId,
    name: pickString(row, ['name', 'nameMasked']) ?? 'Rider',
    phoneMasked: pickString(row, ['phoneMasked', 'phone']),
    onboarding: pickString(row, ['onboarding', 'status']),
    earningStatus: pickString(row, ['earningStatus']),
    deliveries: pickNumber(row, ['deliveries', 'trips']),
    tripsTarget: pickNumber(row, ['tripsTarget'], 10),
    kycBonusInr: pickNumber(row, ['kycBonusInr']),
    tripsBonusInr: pickNumber(row, ['tripsBonusInr']),
    totalBonusInr: pickNumber(row, ['totalBonusInr', 'bonusInr']),
    referredAt: pickString(row, ['referredAt', 'createdAt']),
    activatedAt: pickString(row, ['activatedAt']),
  };
}

function mapCredit(raw: unknown): ReferralCredit | null {
  const row = asRecord(raw);
  if (!row) return null;
  return {
    refereeId: pickString(row, ['refereeId']),
    name: pickString(row, ['name']),
    kind: pickString(row, ['kind', 'type']),
    bonusInr: pickNumber(row, ['bonusInr', 'amount']),
    creditedAt: pickString(row, ['creditedAt', 'createdAt']),
  };
}

export async function getAcceptanceRate(): Promise<PerformanceRate> {
  return mapRate(await request(`${ME}/acceptance-rate`), 'acceptance');
}

export async function getCancellationRate(): Promise<PerformanceRate> {
  return mapRate(await request(`${ME}/cancellation-rate`), 'cancellation');
}

export async function getRatings(input: {
  page?: number;
  limit?: number;
} = {}): Promise<RatingsPage> {
  return mapRatingsPage(
    await request(`${ME}/ratings`, {
      params: { page: input.page ?? 1, limit: input.limit ?? 20 },
    })
  );
}

export async function getReviews(input: {
  page?: number;
  limit?: number;
} = {}): Promise<RatingsPage> {
  return mapRatingsPage(
    await request(`${ME}/reviews`, {
      params: { page: input.page ?? 1, limit: input.limit ?? 20 },
    })
  );
}

export async function getRatingSummary(): Promise<RatingSummary> {
  const data = unwrapData(await request(`${ME}/ratings/summary`));
  return {
    avgRating: pickNumber(data, ['avgRating', 'average', 'rating']),
    ratingCount: pickNumber(data, ['ratingCount', 'count', 'total']),
    distribution: mapDistribution(data.distribution),
    last30Days: mapWindow(data.last30Days),
    previous30Days: mapWindow(data.previous30Days),
    trend: pickString(data, ['trend']) ?? 'insufficient',
  };
}

export async function getTier(): Promise<PartnerTier> {
  const mapped = mapTier(unwrapData(await request(`${ME}/tier`)));
  if (!mapped) {
    throw new PartnerApiError('Could not load tier.', 'NOT_FOUND');
  }
  return mapped;
}

export async function getTierCriteria(): Promise<TierCriteria> {
  const data = unwrapData(await request(`${ME}/tier/criteria`));
  const current =
    mapTier(data.current) ??
    mapTier(data) ?? {
      code: 'bronze',
      label: 'Bronze',
      perks: [],
      overridden: false,
    };
  const nextRaw = data.next;
  const next =
    nextRaw === null || nextRaw === undefined ? null : mapTier(nextRaw);
  const requirements = (Array.isArray(data.requirements) ? data.requirements : [])
    .map(mapRequirement)
    .filter((row): row is TierRequirement => Boolean(row));
  return {
    timezone: pickString(data, ['timezone']),
    current,
    next: next
      ? { code: next.code, label: next.label, perks: next.perks }
      : null,
    requirements,
    progressPercent: pickNumber(data, ['progressPercent', 'progress']),
  };
}

export async function getWarnings(input: {
  page?: number;
  limit?: number;
  status?: WarningStatus;
} = {}): Promise<WarningsPage> {
  const payload = await request(`${ME}/warnings`, {
    params: {
      page: input.page ?? 1,
      limit: input.limit ?? 20,
      status: input.status || undefined,
    },
  });
  const data = unwrapData(payload);
  const items = unwrapList(payload)
    .map(mapWarning)
    .filter((row): row is PartnerWarning => Boolean(row));
  return { items, ...pageMeta(data, items) };
}

export async function acknowledgeWarning(
  warningId: string
): Promise<PartnerWarning> {
  const id = warningId.trim();
  const mapped = mapWarning(
    unwrapData(
      await request(`${ME}/warnings/${encodeURIComponent(id)}/acknowledge`, {
        method: 'POST',
        body: {},
      })
    )
  );
  if (!mapped) {
    throw new PartnerApiError('Could not acknowledge warning.', 'REQUEST_FAILED');
  }
  return mapped;
}

export async function getReferralCode(): Promise<ReferralCode> {
  const data = unwrapData(await request(`${ME}/referrals/code`));
  const code = pickString(data, ['code', 'referralCode']) ?? '';
  if (!code) {
    throw new PartnerApiError('Referral code is not ready yet.', 'NOT_FOUND');
  }
  return {
    code,
    shareUrl: pickString(data, ['shareUrl', 'url']),
    shareText: pickString(data, ['shareText', 'message']),
    referredCount: pickNumber(data, ['referredCount', 'count']),
    timezone: pickString(data, ['timezone']),
    policy: mapPolicy(data.policy),
  };
}

export async function getReferrals(input: {
  page?: number;
  limit?: number;
} = {}): Promise<ReferralsPage> {
  const payload = await request(`${ME}/referrals`, {
    params: { page: input.page ?? 1, limit: input.limit ?? 20 },
  });
  const data = unwrapData(payload);
  const items = unwrapList(payload)
    .map(mapReferee)
    .filter((row): row is ReferredPartner => Boolean(row));
  return {
    timezone: pickString(data, ['timezone']),
    referredCount: pickNumber(data, ['referredCount'], items.length),
    items,
    ...pageMeta(data, items),
  };
}

export async function getReferralEarnings(): Promise<ReferralEarnings> {
  const payload = await request(`${ME}/referrals/earnings`);
  const data = unwrapData(payload);
  const recentRaw = Array.isArray(data.recent) ? data.recent : [];
  return {
    timezone: pickString(data, ['timezone']),
    currency: pickString(data, ['currency']) ?? 'INR',
    totalBonusInr: pickNumber(data, ['totalBonusInr', 'total']),
    kycBonusInr: pickNumber(data, ['kycBonusInr']),
    tripsBonusInr: pickNumber(data, ['tripsBonusInr']),
    pendingBonusInr: pickNumber(data, ['pendingBonusInr', 'pending']),
    referredCount: pickNumber(data, ['referredCount']),
    activeCount: pickNumber(data, ['activeCount']),
    kycCreditedCount: pickNumber(data, ['kycCreditedCount']),
    tripsCreditedCount: pickNumber(data, ['tripsCreditedCount']),
    policy: mapPolicy(data.policy),
    recent: recentRaw
      .map(mapCredit)
      .filter((row): row is ReferralCredit => Boolean(row)),
  };
}

export function formatPerformanceError(error: unknown, fallback: string): string {
  return formatTripError(error, fallback);
}

export const partnerPerformanceApi = {
  getAcceptanceRate,
  getCancellationRate,
  getRatings,
  getReviews,
  getRatingSummary,
  getTier,
  getTierCriteria,
  getWarnings,
  acknowledgeWarning,
  getReferralCode,
  getReferrals,
  getReferralEarnings,
};
