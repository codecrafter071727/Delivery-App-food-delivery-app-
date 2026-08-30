import axios from 'axios';

import { api } from '@/lib/api';
import type {
  FinancePage,
  RestaurantCommission,
  RestaurantInvoice,
  RestaurantPayout,
  RestaurantSettlement,
  RestaurantSettlementOrder,
  RestaurantWallet,
  RestaurantWalletTxn,
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

function mapSettlementOrder(raw: Record<string, unknown>): RestaurantSettlementOrder | null {
  const orderId = String(raw.orderId ?? '').trim();
  if (!orderId) return null;
  return {
    orderId,
    orderNumber: raw.orderNumber ? String(raw.orderNumber) : null,
    orderDate: raw.orderDate ? String(raw.orderDate) : undefined,
    grossAmount: pickNumber(raw, ['grossAmount']),
    commissionAmount: pickNumber(raw, ['commissionAmount']),
    refundImpact: pickNumber(raw, ['refundImpact']),
    restaurantNetAmount: pickNumber(raw, ['restaurantNetAmount']),
  };
}

function mapSettlement(raw: Record<string, unknown>): RestaurantSettlement | null {
  const settlement = asRecord(raw.settlement) ?? raw;
  const id = String(settlement._id ?? settlement.id ?? '').trim();
  if (!id) return null;
  const payout = asRecord(raw.payout);
  const ordersRaw = Array.isArray(raw.orders) ? raw.orders : [];
  return {
    id,
    settlementNumber: String(settlement.settlementNumber ?? id.slice(-8)),
    periodStart: String(settlement.periodStart ?? ''),
    periodEnd: String(settlement.periodEnd ?? ''),
    totalOrders: pickNumber(settlement, ['totalOrders']),
    grossSales: pickNumber(settlement, ['grossSales']),
    commissionAmount: pickNumber(settlement, ['commissionAmount']),
    refundImpact: pickNumber(settlement, ['refundImpact']),
    finalPayable: pickNumber(settlement, ['finalPayable']),
    status: String(settlement.status ?? 'pending'),
    createdAt: settlement.createdAt ? String(settlement.createdAt) : undefined,
    payoutStatus: payout ? String(payout.status ?? '') : null,
    payoutReference: payout?.gatewayPayoutId ? String(payout.gatewayPayoutId) : null,
    paidAt: payout?.paidAt ? String(payout.paidAt) : null,
    failureReason:
      payout?.failureReason && String(payout.failureReason).trim()
        ? String(payout.failureReason)
        : null,
    orders: ordersRaw
      .map((row) => mapSettlementOrder(asRecord(row) ?? {}))
      .filter(Boolean) as RestaurantSettlementOrder[],
  };
}

function mapSettlementListRow(raw: Record<string, unknown>): RestaurantSettlement | null {
  const id = String(raw._id ?? raw.id ?? '').trim();
  if (!id) return null;
  return {
    id,
    settlementNumber: String(raw.settlementNumber ?? id.slice(-8)),
    periodStart: String(raw.periodStart ?? ''),
    periodEnd: String(raw.periodEnd ?? ''),
    totalOrders: pickNumber(raw, ['totalOrders']),
    grossSales: pickNumber(raw, ['grossSales']),
    commissionAmount: pickNumber(raw, ['commissionAmount']),
    refundImpact: pickNumber(raw, ['refundImpact']),
    finalPayable: pickNumber(raw, ['finalPayable']),
    status: String(raw.status ?? 'pending'),
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

  listSettlements: async (
    restaurantId: string,
    params?: { page?: number; limit?: number; status?: string }
  ): Promise<FinancePage<RestaurantSettlement>> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/settlements`,
        {
          params: {
            page: params?.page ?? 1,
            limit: params?.limit ?? 20,
            ...(params?.status ? { status: params.status } : {}),
          },
        }
      );
      return unwrapPaged(res.data, mapSettlementListRow);
    } catch (error) {
      throwFinanceError(error, 'Failed to load settlements');
    }
  },

  getSettlement: async (
    restaurantId: string,
    settlementId: string
  ): Promise<RestaurantSettlement> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/settlements/${settlementId}`
      );
      const raw = asRecord(res.data?.data) ?? asRecord(res.data) ?? {};
      const mapped = mapSettlement(raw);
      if (!mapped) throw new Error('Settlement details were empty.');
      return mapped;
    } catch (error) {
      throwFinanceError(error, 'Failed to load settlement details');
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

  getWallet: async (restaurantId: string): Promise<RestaurantWallet> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/wallet`
      );
      const raw = asRecord(res.data?.data) ?? asRecord(res.data) ?? {};
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        balance: pickNumber(raw, ['balance']),
        currency: String(raw.currency ?? 'INR'),
        lifetimeCredited: pickNumber(raw, ['lifetimeCredited']),
        lifetimeDebited: pickNumber(raw, ['lifetimeDebited']),
        lastCreditedAt: raw.lastCreditedAt ? String(raw.lastCreditedAt) : null,
        lastDebitedAt: raw.lastDebitedAt ? String(raw.lastDebitedAt) : null,
        commissionPercent: pickNumber(raw, ['commissionPercent']) || 12,
      };
    } catch (error) {
      throwFinanceError(error, 'Failed to load wallet');
    }
  },

  listWalletTransactions: async (
    restaurantId: string,
    params?: {
      page?: number;
      limit?: number;
      type?: string;
      from?: string;
      to?: string;
    }
  ): Promise<FinancePage<RestaurantWalletTxn>> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/wallet/transactions`,
        {
          params: {
            page: params?.page ?? 1,
            limit: params?.limit ?? 20,
            type: params?.type || undefined,
            from: params?.from || undefined,
            to: params?.to || undefined,
          },
        }
      );
      return unwrapPaged(res.data, (raw) => {
        const id = String(raw.id ?? raw._id ?? '').trim();
        if (!id) return null;
        return {
          id,
          orderId: raw.orderId ? String(raw.orderId) : null,
          orderNumber: raw.orderNumber ? String(raw.orderNumber) : null,
          payoutId: raw.payoutId ? String(raw.payoutId) : null,
          type: String(raw.type ?? 'order_credit'),
          amount: pickNumber(raw, ['amount']),
          balanceAfter: pickNumber(raw, ['balanceAfter']),
          grossAmount:
            raw.grossAmount != null ? pickNumber(raw, ['grossAmount']) : null,
          commissionAmount:
            raw.commissionAmount != null
              ? pickNumber(raw, ['commissionAmount'])
              : null,
          commissionRate:
            raw.commissionRate != null
              ? pickNumber(raw, ['commissionRate'])
              : null,
          description: String(raw.description ?? ''),
          createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
        };
      });
    } catch (error) {
      throwFinanceError(error, 'Failed to load wallet ledger');
    }
  },

  exportWalletTransactions: async (
    restaurantId: string,
    params?: { type?: string; from?: string; to?: string }
  ): Promise<{ csv: string; filename: string; rowCount: number }> => {
    try {
      const res = await api.get<string>(
        `${RESTAURANT_BASE}/${restaurantId}/wallet/transactions/export`,
        {
          params: {
            type: params?.type || undefined,
            from: params?.from || undefined,
            to: params?.to || undefined,
          },
          responseType: 'text',
          headers: { Accept: 'text/csv, text/plain, */*' },
          transformResponse: [(data) => data],
        }
      );
      const csv = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      const disposition = String(
        res.headers?.['content-disposition']
          ?? res.headers?.['Content-Disposition']
          ?? ''
      );
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename =
        match?.[1]
        || `restaurant-wallet-passbook-${new Date().toISOString().slice(0, 10)}.csv`;
      const rowCountHeader = Number(res.headers?.['x-row-count'] ?? 0);
      return {
        csv,
        filename,
        rowCount: Number.isFinite(rowCountHeader) && rowCountHeader > 0
          ? rowCountHeader
          : Math.max(0, csv.split('\n').length - 1),
      };
    } catch (error) {
      throwFinanceError(error, 'Failed to export wallet passbook');
    }
  },
};
