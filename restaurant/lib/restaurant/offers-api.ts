import axios from 'axios';

import { api } from '@/lib/api';
import type {
  CreateOfferPayload,
  OfferDiscountType,
  OfferLifecycleStatus,
  RestaurantOffer,
  UpdateOfferPayload,
} from '@/lib/restaurant/types';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
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
  for (const key of ['offers', 'data', 'results', 'docs', 'items']) {
    const nested = record[key];
    if (Array.isArray(nested)) return asRows(nested);
  }
  return [];
}

function throwApiError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      throw new Error(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const message =
      data?.message || data?.error || `Request failed (${error.response.status})`;
    if (message.toLowerCase().includes('csrf')) {
      throw new Error(
        'Security token expired. Close and reopen the app, then try again.'
      );
    }
    const suffix = data?.code
      ? ` (${data.code})`
      : ` (${error.response.status})`;
    const err = new Error(`${message}${suffix}`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = error.response.status;
    err.code = data?.code;
    throw err;
  }
  if (error instanceof Error) throw error;
  throw new Error(fallback);
}

function unwrapEntity(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;
  if ('data' in record) {
    const data = record.data;
    if (Array.isArray(data)) return data;
    const dataRec = asRecord(data);
    if (dataRec?.offer && !Array.isArray(dataRec.offer)) return dataRec.offer;
    return data;
  }
  return payload;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toIsoString(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function toDateOnly(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return undefined;
}

function normalizeDiscountType(value: unknown): OfferDiscountType | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const lower = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['percentage', 'percent', '%', 'pct'].includes(lower)) return 'percentage';
  if (['flat', 'fixed', 'amount', 'absolute', 'flat_amount'].includes(lower)) {
    return 'flat';
  }
  if (
    ['free_delivery', 'freedelivery', 'delivery', 'free_shipping'].includes(
      lower
    )
  ) {
    return 'free_delivery';
  }
  if (
    ['bogo', 'buy1get1', 'buy_1_get_1', 'buy_one_get_one', 'bxgy'].includes(
      lower
    )
  ) {
    return 'bogo';
  }
  return undefined;
}

/** Backend: letters, numbers, underscore, hyphen. Max 30. */
export function sanitizePromoCode(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase().slice(0, 30);
}

function localDayStartMs(value: string | Date): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  ).getTime();
}

/**
 * Live = on, start day arrived, end day not passed
 * Upcoming = start day still in the future
 * Ended / paused = turned off or end day passed
 */
function deriveLifecycle(offer: {
  isActive?: boolean;
  validFrom?: string;
  validUntil?: string;
}): OfferLifecycleStatus {
  if (offer.isActive === false) return 'inactive';

  const today = localDayStartMs(new Date());
  if (today == null) return 'active';

  const untilDay = offer.validUntil ? localDayStartMs(offer.validUntil) : null;
  if (untilDay != null && untilDay < today) return 'inactive';

  const fromDay = offer.validFrom ? localDayStartMs(offer.validFrom) : null;
  if (fromDay != null && fromDay > today) return 'scheduled';

  return 'active';
}

export function mapOffer(row: Record<string, unknown>): RestaurantOffer {
  const id = String(row._id ?? row.id ?? '');
  const discountType = normalizeDiscountType(
    row.type ?? row.discountType ?? row.offerType
  );
  const validFrom =
    toIsoString(row.startDate ?? row.validFrom ?? row.startsAt) ?? undefined;
  const validUntil =
    toIsoString(row.endDate ?? row.validUntil ?? row.expiresAt ?? row.validTo) ??
    undefined;

  const isActive =
    row.isActive !== undefined
      ? Boolean(row.isActive)
      : row.active !== undefined
        ? Boolean(row.active)
        : undefined;

  const mapped: RestaurantOffer = {
    id,
    restaurantId: row.restaurantId != null ? String(row.restaurantId) : undefined,
    title: String(row.title ?? row.name ?? 'Offer'),
    description: (row.description as string) || undefined,
    code:
      (row.code as string) ||
      (row.promoCode as string) ||
      (row.couponCode as string) ||
      undefined,
    discountType,
    discountValue: toNumber(row.value ?? row.discountValue ?? row.discount),
    minOrderAmount: toNumber(
      row.minOrderValue ?? row.minOrderAmount ?? row.minOrder
    ),
    maxDiscountAmount: toNumber(
      row.maxDiscount ?? row.maxDiscountAmount ?? row.maxCap
    ),
    validFrom,
    validUntil,
    isActive,
    usageCount: toNumber(row.usageCount ?? row.usedCount ?? row.totalUsage),
    usageLimit: toNumber(row.usageLimit),
    perUserLimit: toNumber(row.perUserLimit),
  };

  mapped.status = deriveLifecycle(mapped);
  return mapped;
}

function toIsoDateTime(value: unknown, endOfDay = false): string | undefined {
  const dateOnly = toDateOnly(value);
  if (!dateOnly) return undefined;
  const [year, month, day] = dateOnly.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const local = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  return local.toISOString();
}

function offersPath(restaurantId: string, offerId?: string) {
  const root = `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/offers`;
  return offerId ? `${root}/${encodeURIComponent(offerId)}` : root;
}

/**
 * Exact CreateOfferSchema / UpdateOfferSchema fields.
 * Zod strips unknown keys — do not send minOrderAmount / discountType aliases.
 */
function buildOfferBody(payload: CreateOfferPayload | UpdateOfferPayload) {
  const body: Record<string, unknown> = {};

  if (payload.title !== undefined) body.title = payload.title.trim();
  if (payload.code !== undefined) {
    const code = sanitizePromoCode(payload.code);
    if (code) body.code = code;
  }
  if (payload.discountType !== undefined) body.type = payload.discountType;
  if (payload.discountValue !== undefined) body.value = payload.discountValue;
  if (payload.minOrderAmount !== undefined) {
    body.minOrderValue = payload.minOrderAmount;
  }
  if (payload.maxDiscountAmount !== undefined) {
    body.maxDiscount = payload.maxDiscountAmount;
  }
  if (payload.description !== undefined) {
    const description = payload.description.trim();
    if (description) body.description = description;
  }
  if (payload.validFrom !== undefined) {
    const startDate = toIsoDateTime(payload.validFrom, false);
    if (startDate) body.startDate = startDate;
  }
  if (payload.validUntil !== undefined) {
    const endDate = toIsoDateTime(payload.validUntil, true);
    if (endDate) body.endDate = endDate;
  }
  if (payload.usageLimit !== undefined) body.usageLimit = payload.usageLimit;
  if (payload.perUserLimit !== undefined) {
    body.perUserLimit = payload.perUserLimit;
  }
  if (payload.isActive !== undefined) body.isActive = payload.isActive;

  return body;
}

function requireMappedOffer(
  data: Record<string, unknown>,
  fallbackId?: string
): RestaurantOffer {
  const mapped = mapOffer({
    ...data,
    _id: data._id ?? fallbackId,
    id: data.id ?? fallbackId,
  });
  if (!mapped.id) {
    throw new Error('Offer was not saved. Pull to refresh.');
  }
  return mapped;
}

export const restaurantOffersApi = {
  /** GET /restaurants/:id/offers — owner sees all (not customer active-only). */
  getOffers: async (restaurantId: string): Promise<RestaurantOffer[]> => {
    try {
      const res = await api.get<Envelope<unknown>>(offersPath(restaurantId));
      return asRows(unwrapEntity(res.data) ?? res.data?.data)
        .map(mapOffer)
        .filter((offer) => Boolean(offer.id));
    } catch (error) {
      throwApiError(error, 'Failed to load offers');
    }
  },

  /** GET /restaurants/:id/offers/:offerId */
  getOffer: async (
    restaurantId: string,
    offerId: string
  ): Promise<RestaurantOffer> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        offersPath(restaurantId, offerId)
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return requireMappedOffer(data, offerId);
    } catch (error) {
      throwApiError(error, 'Failed to load offer');
    }
  },

  /** POST /restaurants/:id/offers */
  createOffer: async (
    restaurantId: string,
    payload: CreateOfferPayload
  ): Promise<RestaurantOffer> => {
    const code = sanitizePromoCode(payload.code);
    if (code.length < 2) {
      throw new Error('Promo code must be at least 2 letters or numbers.');
    }

    const start = toIsoDateTime(payload.validFrom, false);
    const end = toIsoDateTime(payload.validUntil, true);
    if (!start || !end) {
      throw new Error('Enter valid from and until dates (dd-mm-yyyy).');
    }
    if (new Date(end) <= new Date(start)) {
      throw new Error('End date must be after the start date.');
    }

    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        offersPath(restaurantId),
        buildOfferBody({ ...payload, code })
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      let created = requireMappedOffer(data);

      if (payload.isActive === false && created.isActive !== false) {
        created = await restaurantOffersApi.updateOffer(
          restaurantId,
          created.id,
          { isActive: false }
        );
      }
      return created;
    } catch (error) {
      throwApiError(error, 'Failed to create offer');
    }
  },

  /** PUT /restaurants/:id/offers/:offerId */
  updateOffer: async (
    restaurantId: string,
    offerId: string,
    payload: UpdateOfferPayload
  ): Promise<RestaurantOffer> => {
    try {
      let next = payload;
      if (payload.code !== undefined) {
        const code = sanitizePromoCode(payload.code);
        if (code.length < 2) {
          throw new Error('Promo code must be at least 2 letters or numbers.');
        }
        next = { ...payload, code };
      }
      const res = await api.put<Envelope<Record<string, unknown>>>(
        offersPath(restaurantId, offerId),
        buildOfferBody(next)
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return requireMappedOffer(data, offerId);
    } catch (error) {
      throwApiError(error, 'Failed to update offer');
    }
  },

  /** DELETE /restaurants/:id/offers/:offerId */
  deleteOffer: async (restaurantId: string, offerId: string): Promise<void> => {
    try {
      await api.delete(offersPath(restaurantId, offerId));
    } catch (error) {
      throwApiError(error, 'Failed to delete offer');
    }
  },
};
