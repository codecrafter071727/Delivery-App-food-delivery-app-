import axios from 'axios';

import { API_BASE_URL, api, assertApiBaseUrl } from '@/lib/api';
import type {
  CodLimitStatus,
  CodPending,
  CodRemitPayload,
  CodRemittance,
  CodRemittanceHistory,
  CodUpiQr,
  CodUpiSettlement,
  InstantEligibility,
  PartnerPayout,
  PartnerPayoutsResult,
  PartnerWallet,
  PayoutSchedule,
  TripEarnings,
  TripEarningsBreakdown,
  WalletCodSnapshot,
  WalletTransaction,
  WalletTransactionsResult,
} from '@/lib/delivery-partner/finance-types';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import {
  getApiErrorCode,
  PartnerApiError,
} from '@/lib/errors';

const ME_BASE = '/api/v1/delivery-service/partners/me';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unwrap(payload: unknown): unknown {
  const record = asRecord(payload);
  if ('data' in record) return record.data;
  return payload;
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

function pickBool(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return undefined;
}

function pickStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function extractErrorCode(data: unknown): string | undefined {
  const payload = asRecord(data);
  const nested = asRecord(payload.data);
  const errorObj = asRecord(
    typeof payload.error === 'object' ? payload.error : undefined
  );
  const code =
    pickString(nested, ['code']) ??
    pickString(payload, ['code']) ??
    pickString(errorObj, ['code']);
  return code ? code.toUpperCase().replace(/[\s-]+/g, '_') : undefined;
}

export function formatFinanceError(error: unknown, fallback: string): string {
  return formatTripError(error, fallback);
}

function newIdempotencyKey() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
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
        extractErrorCode(error.response?.data) ??
        getApiErrorCode(error) ??
        (status === 404 ? 'NOT_FOUND' : undefined);
      throw new PartnerApiError(
        formatFinanceError(error, `Request failed (${status ?? 0})`),
        code
      );
    }
    throw error;
  }
}

function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  const record = asRecord(data);
  const nested =
    record.items ??
    record.transactions ??
    record.payouts ??
    record.remittances ??
    record.rows ??
    record.results;
  return Array.isArray(nested) ? (nested as Record<string, unknown>[]) : [];
}

function mapPaged<T>(
  payload: unknown,
  mapItem: (row: Record<string, unknown>) => T | null
): {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
} {
  const record = asRecord(payload);
  const data = unwrap(payload);
  const rows = extractRows(data).length ? extractRows(data) : extractRows(payload);
  const meta = asRecord(data);
  const page = pickNumber(record, ['page']) ?? pickNumber(meta, ['page']) ?? 1;
  const limit =
    pickNumber(record, ['limit']) ?? pickNumber(meta, ['limit']) ?? rows.length;
  const total =
    pickNumber(record, ['total']) ??
    pickNumber(meta, ['total']) ??
    pickNumber(record, ['count']) ??
    rows.length;
  const totalPages =
    pickNumber(record, ['totalPages']) ??
    pickNumber(meta, ['totalPages']) ??
    (limit > 0 ? Math.ceil(total / limit) : 1);
  return {
    items: rows.map(mapItem).filter((row): row is T => row != null),
    page,
    limit,
    total,
    hasNext: page < totalPages || (limit > 0 && page * limit < total),
  };
}

function mapCodSnapshot(raw: unknown): WalletCodSnapshot | undefined {
  const record = asRecord(raw);
  if (!Object.keys(record).length) return undefined;
  return {
    cashInHand: pickNumber(record, ['cashInHand']) ?? 0,
    limit: pickNumber(record, ['limit']) ?? 0,
    remainingCapacity: pickNumber(record, ['remainingCapacity']) ?? 0,
    blocked: pickBool(record, ['blocked']) ?? false,
    remitDueToday: pickBool(record, ['remitDueToday']) ?? false,
  };
}

function mapWallet(raw: unknown): PartnerWallet {
  const record = asRecord(unwrap(raw));
  return {
    currency: pickString(record, ['currency']) ?? 'INR',
    earningsBalance: pickNumber(record, ['earningsBalance', 'balance']) ?? 0,
    pendingPayouts: pickNumber(record, ['pendingPayouts']) ?? 0,
    lifetimeEarnings: pickNumber(record, ['lifetimeEarnings']) ?? 0,
    cashInHand: pickNumber(record, ['cashInHand']) ?? 0,
    nextWeeklyPayoutAt: pickString(record, ['nextWeeklyPayoutAt']),
    instantEligible: pickBool(record, ['instantEligible']) ?? false,
    cod: mapCodSnapshot(record.cod),
  };
}

function mapTxn(row: Record<string, unknown>): WalletTransaction | null {
  const id =
    pickString(row, ['txnId', 'id', 'transactionId']) ??
    pickString(row, ['deliveryId', 'payoutId', 'remittanceId']);
  if (!id) return null;
  const direction = pickString(row, ['direction']);
  return {
    id,
    type: pickString(row, ['type']) ?? 'ledger',
    direction,
    amount: pickNumber(row, ['amount']) ?? 0,
    feeAmount: pickNumber(row, ['feeAmount']),
    netAmount: pickNumber(row, ['netAmount']),
    currency: pickString(row, ['currency']) ?? 'INR',
    status: pickString(row, ['status']),
    deliveryId: pickString(row, ['deliveryId']),
    orderId: pickString(row, ['orderId']),
    payoutId: pickString(row, ['payoutId']),
    remittanceId: pickString(row, ['remittanceId']),
    note: pickString(row, ['note', 'description']),
    createdAt: pickString(row, ['occurredAt', 'createdAt', 'at']),
  };
}

function mapPayout(raw: unknown): PartnerPayout | null {
  const row = asRecord(unwrap(raw));
  const payoutId = pickString(row, ['payoutId', 'id']);
  if (!payoutId) return null;
  return {
    payoutId,
    kind: pickString(row, ['kind', 'type']) ?? 'weekly',
    status: pickString(row, ['status']) ?? 'pending',
    period: pickString(row, ['period']),
    grossAmount: pickNumber(row, ['grossAmount', 'amount']) ?? 0,
    feeAmount: pickNumber(row, ['feeAmount']) ?? 0,
    tdsAmount: pickNumber(row, ['tdsAmount']) ?? 0,
    netAmount: pickNumber(row, ['netAmount']) ?? 0,
    bankAccountMasked: pickString(row, ['bankAccountMasked', 'accountMasked']),
    ifscCode: pickString(row, ['ifscCode', 'ifsc']),
    gatewayPayoutId: pickString(row, ['gatewayPayoutId']) ?? null,
    failureReason: pickString(row, ['failureReason']) ?? null,
    gatewayAvailable: pickBool(row, ['gatewayAvailable']),
    requestedAt: pickString(row, ['requestedAt', 'createdAt']),
    paidAt: pickString(row, ['paidAt']) ?? null,
  };
}

function mapEligibility(raw: unknown): InstantEligibility {
  const record = asRecord(unwrap(raw));
  return {
    eligible: pickBool(record, ['eligible']) ?? false,
    reasons: pickStringList(record.reasons),
    availableBalance: pickNumber(record, ['availableBalance']) ?? 0,
    minAmount: pickNumber(record, ['minAmount']) ?? 200,
    maxAmount: pickNumber(record, ['maxAmount']) ?? 0,
    feePercent: pickNumber(record, ['feePercent']) ?? 0,
    feeMin: pickNumber(record, ['feeMin']) ?? 0,
    estimatedFee: pickNumber(record, ['estimatedFee']) ?? 0,
    estimatedNet: pickNumber(record, ['estimatedNet']) ?? 0,
    dailyRemainingAmount: pickNumber(record, ['dailyRemainingAmount']),
    dailyRemainingCount: pickNumber(record, ['dailyRemainingCount']),
    bankOnFile: pickBool(record, ['bankOnFile']) ?? false,
    bankVerified: pickBool(record, ['bankVerified']) ?? false,
    kycActive: pickBool(record, ['kycActive']) ?? false,
    nextWeeklyPayoutAt: pickString(record, ['nextWeeklyPayoutAt']),
  };
}

function mapSchedule(raw: unknown): PayoutSchedule {
  const record = asRecord(unwrap(raw));
  const instant = asRecord(record.instant);
  const period = asRecord(record.currentPeriod);
  return {
    cycle: pickString(record, ['cycle']) ?? 'weekly',
    weekday: pickString(record, ['weekday']),
    timezone: pickString(record, ['timezone']),
    nextPayoutDate: pickString(record, ['nextPayoutDate']),
    nextPayoutAt: pickString(record, ['nextPayoutAt']),
    cutoff: pickString(record, ['cutoff']),
    currentPeriodLabel: pickString(period, ['label']),
    instantMin: pickNumber(instant, ['minAmount']),
    instantFeePercent: pickNumber(instant, ['feePercent']),
    instantFeeMin: pickNumber(instant, ['feeMin']),
    instantDailyCap: pickNumber(instant, ['dailyCapAmount']),
    instantDailyCount: pickNumber(instant, ['dailyCapCount']),
  };
}

function mapBreakdown(raw: unknown): TripEarningsBreakdown {
  const record = asRecord(raw);
  return {
    baseFare: pickNumber(record, ['baseFare']),
    distanceFare: pickNumber(record, ['distanceFare']),
    surge: pickNumber(record, ['surge']),
    waitTime: pickNumber(record, ['waitTime']),
    tip: pickNumber(record, ['tip']),
    incentive: pickNumber(record, ['incentive']),
    platformFee: pickNumber(record, ['platformFee']),
    tds: pickNumber(record, ['tds']),
  };
}

function mapTripEarnings(raw: unknown): TripEarnings {
  const record = asRecord(unwrap(raw));
  return {
    deliveryId: pickString(record, ['deliveryId', 'id']) ?? '',
    orderId: pickString(record, ['orderId']),
    status: pickString(record, ['status']),
    deliveredAt: pickString(record, ['deliveredAt']),
    actualDistanceKm: pickNumber(record, ['actualDistanceKm']),
    waitMinutes: pickNumber(record, ['waitMinutes']),
    currency: pickString(record, ['currency']) ?? 'INR',
    breakdown: mapBreakdown(record.breakdown),
    gross: pickNumber(record, ['gross']) ?? 0,
    net: pickNumber(record, ['net']) ?? 0,
  };
}

function mapCodPending(raw: unknown): CodPending {
  const record = asRecord(unwrap(raw));
  const today = asRecord(record.today);
  return {
    currency: pickString(record, ['currency']) ?? 'INR',
    cashInHand: pickNumber(record, ['cashInHand']) ?? 0,
    limit: pickNumber(record, ['limit']) ?? 0,
    remainingCapacity: pickNumber(record, ['remainingCapacity']) ?? 0,
    blocked: pickBool(record, ['blocked']) ?? false,
    remitDueToday: pickBool(record, ['remitDueToday']) ?? false,
    remittedLifetime: pickNumber(record, ['remittedLifetime']) ?? 0,
    minRemit: pickNumber(record, ['minRemit']) ?? 1,
    maxRemit: pickNumber(record, ['maxRemit']) ?? 0,
    todayCollected: pickNumber(today, ['collected']),
    todayCount: pickNumber(today, ['count']),
  };
}

function mapCodLimit(raw: unknown): CodLimitStatus {
  const record = asRecord(unwrap(raw));
  return {
    cashInHand: pickNumber(record, ['cashInHand']) ?? 0,
    limit: pickNumber(record, ['limit']) ?? 0,
    remainingCapacity: pickNumber(record, ['remainingCapacity']) ?? 0,
    usedPercent: pickNumber(record, ['usedPercent']) ?? 0,
    blocked: pickBool(record, ['blocked']) ?? false,
    remitDueToday: pickBool(record, ['remitDueToday']) ?? false,
    blocksNewCodOrders: pickBool(record, ['blocksNewCodOrders']) ?? false,
    code: pickString(record, ['code']),
    message: pickString(record, ['message']),
  };
}

function mapRemittance(raw: unknown): CodRemittance | null {
  const row = asRecord(unwrap(raw));
  const remittanceId = pickString(row, ['remittanceId', 'id']);
  if (!remittanceId) return null;
  return {
    remittanceId,
    amount: pickNumber(row, ['amount']) ?? 0,
    method: pickString(row, ['method']) ?? 'hub_cash',
    reference: pickString(row, ['reference']),
    note: pickString(row, ['note']),
    status: pickString(row, ['status']) ?? 'recorded',
    cashBefore: pickNumber(row, ['cashBefore']),
    cashAfter: pickNumber(row, ['cashAfter']),
    remittedAt: pickString(row, ['remittedAt', 'createdAt']),
  };
}

function mapUpiQr(raw: unknown): CodUpiQr {
  const record = asRecord(unwrap(raw));
  return {
    deliveryId: pickString(record, ['deliveryId']) ?? '',
    orderId: pickString(record, ['orderId']),
    amount: pickNumber(record, ['amount']) ?? 0,
    currency: pickString(record, ['currency']) ?? 'INR',
    upiIntent: pickString(record, ['upiIntent']),
    qrImageUrl: pickString(record, ['qrImageUrl']) ?? null,
    qrId: pickString(record, ['qrId']) ?? null,
    expiresAt: pickString(record, ['expiresAt']),
    source: pickString(record, ['source']),
    settledVia: pickString(record, ['settledVia']) ?? null,
  };
}

function mapUpiSettlement(raw: unknown): CodUpiSettlement {
  const record = asRecord(unwrap(raw));
  return {
    deliveryId: pickString(record, ['deliveryId']) ?? '',
    orderId: pickString(record, ['orderId']),
    amount: pickNumber(record, ['amount']) ?? 0,
    settledVia: pickString(record, ['settledVia']) ?? 'upi',
    cashInHandDelta: pickNumber(record, ['cashInHandDelta']) ?? 0,
    cashInHand: pickNumber(record, ['cashInHand']) ?? 0,
    txnRef: pickString(record, ['txnRef']),
    collectedAt: pickString(record, ['collectedAt']),
  };
}

export const partnerFinanceApi = {
  getWallet() {
    return request<unknown>(`${ME_BASE}/wallet`).then(mapWallet);
  },

  getWalletTransactions(params: {
    page?: number;
    limit?: number;
    type?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}): Promise<WalletTransactionsResult> {
    return request<unknown>(`${ME_BASE}/wallet/transactions`, {
      params: {
        page: params.page ?? 1,
        limit: params.limit ?? 20,
        type: params.type || undefined,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      },
    }).then((payload) => mapPaged(payload, mapTxn));
  },

  getTripEarnings(deliveryId: string) {
    return request<unknown>(
      `${ME_BASE}/earnings/${encodeURIComponent(deliveryId)}`
    ).then(mapTripEarnings);
  },

  getPayouts(page = 1, limit = 20): Promise<PartnerPayoutsResult> {
    return request<unknown>(`${ME_BASE}/payouts`, {
      params: { page, limit },
    }).then((payload) => mapPaged(payload, mapPayout));
  },

  getPayout(payoutId: string) {
    return request<unknown>(
      `${ME_BASE}/payouts/${encodeURIComponent(payoutId)}`
    ).then((payload) => {
      const mapped = mapPayout(payload);
      if (!mapped) {
        throw new PartnerApiError('Payout not found.', 'PAYOUT_NOT_FOUND');
      }
      return mapped;
    });
  },

  getInstantEligibility() {
    return request<unknown>(`${ME_BASE}/payouts/instant/eligibility`).then(
      mapEligibility
    );
  },

  getPayoutSchedule() {
    return request<unknown>(`${ME_BASE}/payouts/schedule`).then(mapSchedule);
  },

  requestInstantPayout(amount?: number) {
    const body: { amount?: number; idempotencyKey?: string } = {};
    if (amount != null && Number.isFinite(amount)) body.amount = amount;
    const key = newIdempotencyKey();
    body.idempotencyKey = key;
    return request<unknown>(`${ME_BASE}/payouts/instant`, {
      method: 'POST',
      body,
      idempotencyKey: key,
    }).then((payload) => {
      const mapped = mapPayout(payload);
      if (!mapped) {
        throw new PartnerApiError('Payout was not created.', 'PAYOUT_NOT_FOUND');
      }
      return mapped;
    });
  },

  getCodPending() {
    return request<unknown>(`${ME_BASE}/cod/pending`).then(mapCodPending);
  },

  getCodLimitStatus() {
    return request<unknown>(`${ME_BASE}/cod/limit-status`).then(mapCodLimit);
  },

  remitCod(payload: CodRemitPayload) {
    const key = newIdempotencyKey();
    const body: Record<string, unknown> = {
      method: payload.method,
      idempotencyKey: key,
    };
    if (payload.amount != null && Number.isFinite(payload.amount)) {
      body.amount = payload.amount;
    }
    if (payload.reference?.trim()) body.reference = payload.reference.trim();
    if (payload.note?.trim()) body.note = payload.note.trim();
    return request<unknown>(`${ME_BASE}/cod/remit`, {
      method: 'POST',
      body,
      idempotencyKey: key,
    }).then((raw) => {
      const mapped = mapRemittance(raw);
      if (!mapped) {
        throw new PartnerApiError('Remittance was not recorded.', 'NO_COD_DUE');
      }
      return mapped;
    });
  },

  getCodRemittanceHistory(
    page = 1,
    limit = 20
  ): Promise<CodRemittanceHistory> {
    return request<unknown>(`${ME_BASE}/cod/remittance-history`, {
      params: { page, limit },
    }).then((payload) => mapPaged(payload, mapRemittance));
  },

  createCodUpiQr(deliveryId: string) {
    return request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(deliveryId)}/cod/upi-qr`,
      { method: 'POST', body: {} }
    ).then(mapUpiQr);
  },

  markCodUpi(deliveryId: string, txnRef: string, note?: string) {
    return request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(deliveryId)}/cod/mark-upi`,
      {
        method: 'POST',
        body: {
          txnRef: txnRef.trim(),
          note: note?.trim() || undefined,
        },
      }
    ).then(mapUpiSettlement);
  },
};
