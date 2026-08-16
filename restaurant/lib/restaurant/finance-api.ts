import axios from 'axios';

import { api } from '@/lib/api';
import type {
  FinancePage,
  RestaurantCommission,
  RestaurantInvoice,
  RestaurantPayout,
} from '@/lib/restaurant/finance-types';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  code?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === 'object') as Record<
      string,
      unknown
    >[];
  }
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['data', 'payouts', 'invoices', 'items', 'results', 'docs']) {
    const nested = record[key];
    if (Array.isArray(nested)) return asRows(nested);
  }
  return [];
}

function throwFinanceError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      throw new Error(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const code = data?.code;
    if (code === 'PAYMENT_SERVICE_UNAVAILABLE' || error.response.status === 503) {
      const err = new Error(
        'Settlements are temporarily unavailable. Try again in a moment. (PAYMENT_SERVICE_UNAVAILABLE)'
      ) as Error & { status?: number; code?: string };
      err.status = error.response.status;
      err.code = 'PAYMENT_SERVICE_UNAVAILABLE';
      throw err;
    }
    if (code === 'PAYOUT_NOT_FOUND') {
      const err = new Error(
        'This settlement was not found. (PAYOUT_NOT_FOUND)'
      ) as Error & { status?: number; code?: string };
      err.status = 404;
      err.code = 'PAYOUT_NOT_FOUND';
      throw err;
    }
    const message =
      data?.message || data?.error || `Request failed (${error.response.status})`;
    const suffix = code ? ` (${code})` : ` (${error.response.status})`;
    const err = new Error(`${message}${suffix}`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = error.response.status;
    err.code = code;
    throw err;
  }
  if (error instanceof Error) throw error;
  throw new Error(fallback);
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function last4(account?: unknown): string | undefined {
  if (typeof account !== 'string' || !account.trim()) return undefined;
  const digits = account.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return digits.slice(-4);
}

function mapPayout(raw: Record<string, unknown>): RestaurantPayout | null {
  const id = String(raw._id ?? raw.id ?? raw.payoutId ?? '').trim();
  if (!id) return null;
  const paidAt = raw.paidAt ? String(raw.paidAt) : null;
  return {
    id,
    period: String(raw.period ?? ''),
    kind: String(raw.kind ?? 'weekly'),
    ordersCount: pickNumber(raw, ['ordersCount']),
    grossAmount: pickNumber(raw, ['grossAmount']),
    commissionRate: pickNumber(raw, ['commissionRate']),
    commissionAmount: pickNumber(raw, ['commissionAmount']),
    tdsAmount: pickNumber(raw, ['tdsAmount']),
    feeAmount: pickNumber(raw, ['feeAmount']),
    netAmount: pickNumber(raw, ['netAmount']),
    status: String(raw.status ?? 'pending'),
    bankLast4: last4(raw.bankAccountNo ?? raw.accountNumber),
    ifscCode: typeof raw.ifscCode === 'string' ? raw.ifscCode : undefined,
    paidAt,
    failureReason:
      typeof raw.failureReason === 'string' && raw.failureReason.trim()
        ? raw.failureReason
        : null,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
  };
}

function mapInvoice(raw: Record<string, unknown>): RestaurantInvoice | null {
  const invoiceId = String(raw.invoiceId ?? raw.id ?? '').trim();
  const payoutId = String(raw.payoutId ?? '').trim();
  if (!invoiceId && !payoutId) return null;
  return {
    invoiceId: invoiceId || `INV-${payoutId.slice(-8).toUpperCase()}`,
    payoutId,
    restaurantId: raw.restaurantId ? String(raw.restaurantId) : undefined,
    period: String(raw.period ?? ''),
    invoiceType: String(raw.invoiceType ?? 'settlement'),
    currency: String(raw.currency ?? 'INR'),
    grossAmount: pickNumber(raw, ['grossAmount']),
    commissionAmount: pickNumber(raw, ['commissionAmount']),
    tdsAmount: pickNumber(raw, ['tdsAmount']),
    netAmount: pickNumber(raw, ['netAmount']),
    gstOnCommission: pickNumber(raw, ['gstOnCommission']),
    status: String(raw.status ?? ''),
    issuedAt: raw.issuedAt ? String(raw.issuedAt) : undefined,
    paidAt: raw.paidAt ? String(raw.paidAt) : null,
  };
}

function unwrapPaged<T>(
  payload: unknown,
  mapRow: (row: Record<string, unknown>) => T | null
): FinancePage<T> {
  const envelope = asRecord(payload);
  const inner = envelope && 'data' in envelope ? envelope.data : payload;
  const pageRoot = asRecord(inner) ?? envelope;
  const rows = asRows(inner);
  const total = pageRoot ? Number(pageRoot.total) : rows.length;
  const page = pageRoot ? Number(pageRoot.page) || 1 : 1;
  const limit = pageRoot ? Number(pageRoot.limit) || 20 : 20;
  const totalPages =
    pageRoot && Number(pageRoot.totalPages)
      ? Number(pageRoot.totalPages)
      : Math.max(1, Math.ceil((Number.isFinite(total) ? total : rows.length) / limit));
  return {
    items: rows.map(mapRow).filter(Boolean) as T[],
    total: Number.isFinite(total) ? total : rows.length,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
  };
}

export const restaurantFinanceApi = {
  listPayouts: async (
    restaurantId: string,
    params?: { page?: number; limit?: number }
  ): Promise<FinancePage<RestaurantPayout>> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/payouts`,
        { params: { page: params?.page ?? 1, limit: params?.limit ?? 20 } }
      );
      return unwrapPaged(res.data, mapPayout);
    } catch (error) {
      throwFinanceError(error, 'Failed to load payouts');
    }
  },

  getPayout: async (
    restaurantId: string,
    payoutId: string
  ): Promise<RestaurantPayout> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/payouts/${payoutId}`
      );
      const raw = asRecord(res.data?.data) ?? asRecord(res.data) ?? {};
      const mapped = mapPayout(raw);
      if (!mapped) throw new Error('Settlement details were empty.');
      return mapped;
    } catch (error) {
      throwFinanceError(error, 'Failed to load settlement');
    }
  },

  listInvoices: async (
    restaurantId: string,
    params?: { page?: number; limit?: number }
  ): Promise<FinancePage<RestaurantInvoice>> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/invoices`,
        { params: { page: params?.page ?? 1, limit: params?.limit ?? 20 } }
      );
      return unwrapPaged(res.data, mapInvoice);
    } catch (error) {
      throwFinanceError(error, 'Failed to load invoices');
    }
  },

  getCommission: async (
    restaurantId: string
  ): Promise<RestaurantCommission> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/commission`
      );
      const raw = asRecord(res.data?.data) ?? {};
      const scheduleRaw = Array.isArray(raw.feeSchedule) ? raw.feeSchedule : [];
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        commissionRate: pickNumber(raw, ['commissionRate']),
        commissionPercent: pickNumber(raw, ['commissionPercent']),
        tdsRate: pickNumber(raw, ['tdsRate']),
        tdsPercent: pickNumber(raw, ['tdsPercent']),
        currency: String(raw.currency ?? 'INR'),
        effectiveFrom: raw.effectiveFrom ? String(raw.effectiveFrom) : null,
        source: String(raw.source ?? 'platform_default'),
        feeSchedule: scheduleRaw
          .map((row) => {
            const item = asRecord(row);
            if (!item) return null;
            return {
              id: String(item.id ?? ''),
              label: String(item.label ?? 'Fee'),
              type: String(item.type ?? 'percent'),
              value: pickNumber(item, ['value']),
              description: String(item.description ?? ''),
            };
          })
          .filter(Boolean) as RestaurantCommission['feeSchedule'],
      };
    } catch (error) {
      throwFinanceError(error, 'Failed to load commission');
    }
  },
};
