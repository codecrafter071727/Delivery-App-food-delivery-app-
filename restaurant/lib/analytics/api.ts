import axios from 'axios';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/errors';
import type {
  AnalyticsCsvExport,
  AnalyticsOverview,
  AnalyticsPeriod,
  AnalyticsRange,
  CancellationsAnalytics,
  OrdersAnalytics,
  RevenueAnalytics,
  RevenuePoint,
  TopSellingItem,
} from '@/lib/analytics/types';

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
  for (const key of ['items', 'topItems', 'data', 'results', 'docs', 'points']) {
    const nested = record[key];
    if (Array.isArray(nested)) return asRows(nested);
  }
  return [];
}

function unwrap(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;
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

function pickNumber(
  record: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const raw = record[key];
    if (raw == null || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function envelopePayload(error: unknown): {
  message?: string;
  code?: string;
  status?: number;
} {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? { message: error.message } : {};
  }
  const status = error.response?.status;
  let data: unknown = error.response?.data;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        data = JSON.parse(trimmed) as unknown;
      } catch {
        return { message: trimmed || undefined, status };
      }
    } else {
      return { message: trimmed || undefined, status };
    }
  }
  const record = asRecord(data);
  const code =
    typeof record?.code === 'string' && record.code.trim()
      ? record.code.trim().toUpperCase().replace(/[\s-]+/g, '_')
      : undefined;
  const message =
    (typeof record?.message === 'string' && record.message.trim()
      ? record.message
      : undefined) ||
    (typeof record?.error === 'string' && record.error.trim()
      ? record.error
      : undefined);
  return { message, code, status };
}

export function analyticsFailureMessage(
  error: unknown,
  fallback: string
): string {
  const payload = envelopePayload(error);
  if (payload.code === 'ORDER_SERVICE_UNAVAILABLE' || payload.status === 503) {
    return 'Insights are temporarily unavailable. Try again in a moment. (ORDER_SERVICE_UNAVAILABLE)';
  }
  if (payload.code === 'DATE_RANGE_TOO_LARGE' || payload.status === 422) {
    if (
      payload.code === 'DATE_RANGE_TOO_LARGE' ||
      (payload.message ?? '').toLowerCase().includes('90')
    ) {
      return 'Pick a date range of 90 days or less. (DATE_RANGE_TOO_LARGE)';
    }
  }
  const message =
    payload.message || getApiErrorMessage(error, fallback) || fallback;
  if (payload.code && !message.includes(payload.code)) {
    return `${message} (${payload.code})`;
  }
  return message;
}

function throwAnalyticsError(error: unknown, fallback: string): never {
  const err = new Error(analyticsFailureMessage(error, fallback)) as Error & {
    status?: number;
    code?: string;
  };
  const payload = envelopePayload(error);
  err.status = payload.status;
  err.code = payload.code;
  throw err;
}

function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const utc = Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days);
  return new Date(utc).toISOString().slice(0, 10);
}

/** IST calendar window for orders / cancellations / CSV. Max span is 30 days here. */
export function resolveAnalyticsRange(
  period: AnalyticsPeriod,
  now = new Date()
): AnalyticsRange {
  const to = todayIst(now);
  if (period === 'day') return { period, from: to, to };
  if (period === 'week') return { period, from: shiftIsoDate(to, -6), to };
  return { period, from: shiftIsoDate(to, -29), to };
}

function formatHourLabel(hour: number): string {
  const safe = ((hour % 24) + 24) % 24;
  const suffix = safe >= 12 ? 'pm' : 'am';
  const twelve = safe % 12 === 0 ? 12 : safe % 12;
  return `${twelve}${suffix}`;
}

function formatPointLabel(value: string, period: AnalyticsPeriod): string {
  const trimmed = value.trim();
  if (!trimmed) return '—';
  if (period === 'day') {
    const hourMatch = trimmed.match(/(\d{1,2}):00/);
    if (hourMatch) return formatHourLabel(Number(hourMatch[1]));
  }
  const date = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`);
  if (Number.isNaN(date.getTime())) return trimmed;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function mapOverview(raw: unknown): AnalyticsOverview {
  const root = asRecord(unwrap(raw)) ?? {};
  const ordersToday = pickNumber(root, ['ordersToday']) ?? 0;
  const revenueToday = pickNumber(root, ['revenueToday']) ?? 0;
  const totalOrders = pickNumber(root, ['totalOrders']) ?? 0;
  const totalRevenue = pickNumber(root, ['totalRevenue']) ?? 0;
  const avgRating = pickNumber(root, ['avgRating']) ?? 0;
  const totalRatings = pickNumber(root, ['totalRatings']) ?? 0;
  const activeItems = pickNumber(root, ['activeItems']) ?? 0;
  const totalCategories = pickNumber(root, ['totalCategories']) ?? 0;
  return {
    ordersToday,
    revenueToday,
    totalOrders,
    totalRevenue,
    avgRating,
    totalRatings,
    activeItems,
    totalCategories,
    avgOrderValue:
      totalOrders > 0 && Number.isFinite(totalRevenue)
        ? totalRevenue / totalOrders
        : null,
  };
}

function mapRevenue(raw: unknown, period: AnalyticsPeriod): RevenueAnalytics {
  const unwrapped = unwrap(raw);
  const root = asRecord(unwrapped);
  const rows = Array.isArray(unwrapped)
    ? asRows(unwrapped)
    : asRows(root?.points ?? root?.series ?? unwrapped);
  const points: RevenuePoint[] = rows
    .map((row) => {
      const date = String(row.date ?? row.day ?? row.label ?? '').trim();
      const revenue = pickNumber(row, ['revenue', 'totalRevenue']) ?? 0;
      const orders = pickNumber(row, ['orders', 'orderCount', 'count']) ?? 0;
      if (!date && revenue <= 0 && orders <= 0) return null;
      return {
        label: formatPointLabel(date, period),
        date: date || undefined,
        revenue,
        orders,
      };
    })
    .filter(Boolean) as RevenuePoint[];

  const totalRevenue =
    (root && pickNumber(root, ['totalRevenue', 'revenue'])) ??
    (points.length
      ? points.reduce((sum, point) => sum + point.revenue, 0)
      : null);
  const totalOrders =
    (root && pickNumber(root, ['totalOrders', 'orders'])) ??
    (points.length
      ? points.reduce((sum, point) => sum + point.orders, 0)
      : null);

  return { points, totalRevenue, totalOrders };
}

function mapTopItems(raw: unknown): TopSellingItem[] {
  const rows = asRows(unwrap(raw));
  return rows
    .map((row) => {
      const name = String(row.name ?? '').trim();
      if (!name) return null;
      const orders =
        pickNumber(row, ['totalOrdered', 'orders', 'orderCount', 'sold']) ?? 0;
      const revenue = pickNumber(row, ['revenue', 'totalRevenue']) ?? undefined;
      const id = String(row.itemId ?? row._id ?? row.id ?? '').trim() || undefined;
      const image =
        typeof row.image === 'string' && row.image.trim()
          ? row.image.trim()
          : undefined;
      return { id, name, orders, revenue, image };
    })
    .filter(Boolean) as TopSellingItem[];
}

function mapHour(row: Record<string, unknown>) {
  const hour = pickNumber(row, ['hour']) ?? 0;
  return {
    hour: Math.min(23, Math.max(0, Math.round(hour))),
    count: pickNumber(row, ['count', 'orders']) ?? 0,
    revenue: pickNumber(row, ['revenue']) ?? 0,
  };
}

function padHours(
  rows: Array<{ hour: number; count: number; revenue: number }>
) {
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => {
    return byHour.get(hour) ?? { hour, count: 0, revenue: 0 };
  });
}

function mapOrders(raw: unknown): OrdersAnalytics {
  const root = asRecord(unwrap(raw)) ?? {};
  const totals = asRecord(root.totals) ?? {};
  return {
    restaurantId: String(root.restaurantId ?? ''),
    from: String(root.from ?? ''),
    to: String(root.to ?? ''),
    timezone: String(root.timezone ?? 'Asia/Kolkata'),
    byHour: padHours(asRows(root.byHour).map(mapHour)),
    byStatus: asRows(root.byStatus).map((row) => ({
      status: String(row.status ?? 'unknown'),
      count: pickNumber(row, ['count', 'orders']) ?? 0,
      revenue: pickNumber(row, ['revenue']) ?? 0,
    })),
    totals: {
      orders: pickNumber(totals, ['orders']) ?? 0,
      revenue: pickNumber(totals, ['revenue']) ?? 0,
    },
  };
}

function mapCancellations(raw: unknown): CancellationsAnalytics {
  const root = asRecord(unwrap(raw)) ?? {};
  const totals = asRecord(root.totals) ?? {};
  return {
    restaurantId: String(root.restaurantId ?? ''),
    from: String(root.from ?? ''),
    to: String(root.to ?? ''),
    timezone: String(root.timezone ?? 'Asia/Kolkata'),
    totals: {
      orders: pickNumber(totals, ['orders']) ?? 0,
      rejected: pickNumber(totals, ['rejected']) ?? 0,
      cancelled: pickNumber(totals, ['cancelled']) ?? 0,
      cancelledByCustomer: pickNumber(totals, ['cancelledByCustomer']) ?? 0,
      cancelledByRestaurant: pickNumber(totals, ['cancelledByRestaurant']) ?? 0,
      cancelledBySystem: pickNumber(totals, ['cancelledBySystem']) ?? 0,
      rejectRate: pickNumber(totals, ['rejectRate']) ?? 0,
      customerCancelRate: pickNumber(totals, ['customerCancelRate']) ?? 0,
      cancelRate: pickNumber(totals, ['cancelRate']) ?? 0,
    },
    byRejectReason: asRows(root.byRejectReason).map((row) => ({
      code: String(row.code ?? row._id ?? 'unknown'),
      count: pickNumber(row, ['count']) ?? 0,
    })),
    byCancelledBy: asRows(root.byCancelledBy).map((row) => ({
      by: String(row.by ?? row._id ?? 'unknown'),
      count: pickNumber(row, ['count']) ?? 0,
    })),
    daily: asRows(root.daily).map((row) => ({
      date: String(row.date ?? row._id ?? ''),
      orders: pickNumber(row, ['orders']) ?? 0,
      rejected: pickNumber(row, ['rejected']) ?? 0,
      cancelled: pickNumber(row, ['cancelled']) ?? 0,
    })),
  };
}

function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string
): string {
  if (!headers) return '';
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
    }
  }
  return '';
}

function filenameFromDisposition(disposition: string, fallback: string) {
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  return match?.[1]?.trim() || fallback;
}

export async function shareAnalyticsCsv(csv: string, filename: string) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    return;
  }
  const { Share } = await import('react-native');
  await Share.share({ title: filename, message: csv });
}

export const restaurantAnalyticsApi = {
  getOverview: async (restaurantId: string): Promise<AnalyticsOverview> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/analytics`
      );
      return mapOverview(res.data);
    } catch (error) {
      throwAnalyticsError(error, 'Failed to load analytics overview');
    }
  },

  getRevenue: async (
    restaurantId: string,
    period: AnalyticsPeriod
  ): Promise<RevenueAnalytics> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/analytics/revenue`,
        { params: { period } }
      );
      return mapRevenue(res.data, period);
    } catch (error) {
      throwAnalyticsError(error, 'Failed to load revenue analytics');
    }
  },

  getTopItems: async (
    restaurantId: string,
    limit = 10
  ): Promise<TopSellingItem[]> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/analytics/top-items`,
        { params: { limit: Math.min(50, Math.max(1, limit)) } }
      );
      return mapTopItems(res.data);
    } catch (error) {
      throwAnalyticsError(error, 'Failed to load top-selling items');
    }
  },

  getOrders: async (
    restaurantId: string,
    range: Pick<AnalyticsRange, 'from' | 'to'>
  ): Promise<OrdersAnalytics> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/analytics/orders`,
        { params: { from: range.from, to: range.to } }
      );
      return mapOrders(res.data);
    } catch (error) {
      throwAnalyticsError(error, 'Failed to load order analytics');
    }
  },

  getCancellations: async (
    restaurantId: string,
    range: Pick<AnalyticsRange, 'from' | 'to'>
  ): Promise<CancellationsAnalytics> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/analytics/cancellations`,
        { params: { from: range.from, to: range.to } }
      );
      return mapCancellations(res.data);
    } catch (error) {
      throwAnalyticsError(error, 'Failed to load cancellation analytics');
    }
  },

  exportOrdersCsv: async (
    restaurantId: string,
    range: Pick<AnalyticsRange, 'from' | 'to'>
  ): Promise<AnalyticsCsvExport> => {
    try {
      const res = await api.get<string>(
        `${RESTAURANT_BASE}/${restaurantId}/analytics/export`,
        {
          params: { from: range.from, to: range.to },
          responseType: 'text',
          transformResponse: [(data) => data],
          headers: { Accept: 'text/csv, application/json' },
          timeout: 35000,
        }
      );
      const csv = typeof res.data === 'string' ? res.data : String(res.data ?? '');
      const trimmed = csv.trim();
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed) as Envelope<unknown> & {
            code?: string;
          };
          if (
            parsed &&
            typeof parsed === 'object' &&
            (parsed.success === false || typeof parsed.code === 'string')
          ) {
            const err = new Error(
              parsed.message || 'Failed to export orders'
            ) as Error & { code?: string };
            err.code = parsed.code;
            throw err;
          }
        } catch (inner) {
          if (inner instanceof SyntaxError) {
            // Real CSV that happens to start with `{`.
          } else {
            throw inner;
          }
        }
      }
      const filename = filenameFromDisposition(
        headerValue(res.headers as Record<string, unknown>, 'content-disposition'),
        `orders-${range.from}-to-${range.to}.csv`
      );
      const rowCount = Number(
        headerValue(res.headers as Record<string, unknown>, 'x-row-count')
      );
      return {
        csv,
        filename,
        rowCount: Number.isFinite(rowCount) ? rowCount : Math.max(0, csv.split('\n').length - 1),
      };
    } catch (error) {
      throwAnalyticsError(error, 'Failed to export orders CSV');
    }
  },
};
