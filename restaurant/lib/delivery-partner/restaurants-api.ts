import axios from 'axios';

import { api, assertApiBaseUrl } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/errors';
import { getMockPartnerRestaurants } from '@/lib/delivery-partner/restaurants-mock';
import type {
  PartnerRestaurant,
  PartnerRestaurantsResult,
  PartnerRestaurantsSummary,
} from '@/lib/delivery-partner/restaurants-types';

/**
 * Set to `false` when GET /partners/me/restaurants (or alias) is live.
 * Until then the screen uses `restaurants-mock.ts`.
 */
export const USE_MOCK_PARTNER_RESTAURANTS = true;

const ME_BASE = '/api/v1/delivery-service/partners/me';
const PARTNERS_BASE = '/api/v1/delivery-service/partners';

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

function pickBool(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const v = value.trim().toLowerCase();
      if (v === 'true' || v === '1' || v === 'yes' || v === 'active') return true;
      if (v === 'false' || v === '0' || v === 'no' || v === 'inactive') return false;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
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

function isAuthError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes('authentication') ||
    m.includes('unauthorized') ||
    m.includes('not authenticated') ||
    m.includes('log in') ||
    m.includes('401')
  );
}

function isNotFound(message: string) {
  const m = message.toLowerCase();
  return m.includes('not found') || m.includes('404');
}

function pickStringList(raw: unknown): string[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    return raw
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const row = asRecord(item);
      return (
        pickString(row, ['name', 'label', 'title', 'tag', 'cuisine']) ?? ''
      );
    })
    .filter(Boolean);
}

function formatLocation(record: Record<string, unknown>): string | undefined {
  const direct = pickString(record, [
    'location',
    'locationLabel',
    'area',
    'locality',
    'addressLine',
    'fullAddress',
    'addressText',
  ]);
  if (direct) return direct;

  const address = asRecord(
    record.address ?? record.location ?? record.restaurantAddress
  );
  const line1 = pickString(address, ['line1', 'street', 'address1', 'label']);
  const area = pickString(address, ['area', 'locality', 'landmark']);
  const city = pickString(address, ['city', 'town']);
  const parts = [line1 || area, city].filter(Boolean);
  if (parts.length) return parts.join(', ');

  const cityOnly = pickString(record, ['city', 'town']);
  return cityOnly;
}

function formatOrderRange(
  min?: number,
  max?: number,
  avg?: number,
  label?: string
): string | undefined {
  if (label?.trim()) return label.trim();
  if (min != null && max != null && Number.isFinite(min) && Number.isFinite(max)) {
    if (min === max) return String(Math.round(min));
    return `${Math.round(min)}-${Math.round(max)}`;
  }
  if (avg != null && Number.isFinite(avg)) return String(Math.round(avg));
  if (min != null && Number.isFinite(min)) return String(Math.round(min));
  if (max != null && Number.isFinite(max)) return String(Math.round(max));
  return undefined;
}

function normalizeStatus(
  record: Record<string, unknown>
): string | undefined {
  const explicit = pickString(record, [
    'status',
    'partnershipStatus',
    'restaurantStatus',
    'availability',
  ]);
  if (explicit) {
    const s = explicit.toLowerCase();
    if (['active', 'online', 'open', 'enabled', 'live'].includes(s)) {
      return 'active';
    }
    if (
      ['inactive', 'offline', 'closed', 'disabled', 'paused'].includes(s)
    ) {
      return 'inactive';
    }
    return explicit;
  }

  const activeFlag = pickBool(record, [
    'isActive',
    'active',
    'isOpen',
    'enabled',
  ]);
  if (activeFlag === true) return 'active';
  if (activeFlag === false) return 'inactive';
  return undefined;
}

function mapRestaurant(raw: unknown, index: number): PartnerRestaurant | null {
  const record = asRecord(raw);
  const nested = asRecord(
    record.restaurant ?? record.outlet ?? record.store ?? record.partner
  );
  const source = {
    ...nested,
    ...record,
  };

  const id =
    pickString(source, [
      '_id',
      'id',
      'restaurantId',
      'outletId',
      'storeId',
      'partnerRestaurantId',
    ]) ?? `restaurant-${index}`;

  const name =
    pickString(source, [
      'name',
      'restaurantName',
      'outletName',
      'storeName',
      'title',
    ]) ?? '';
  if (!name) return null;

  const dailyOrdersMin = pickNumber(source, [
    'dailyOrdersMin',
    'minDailyOrders',
    'ordersMin',
    'dailyOrderMin',
  ]);
  const dailyOrdersMax = pickNumber(source, [
    'dailyOrdersMax',
    'maxDailyOrders',
    'ordersMax',
    'dailyOrderMax',
  ]);
  const dailyOrdersAvg = pickNumber(source, [
    'dailyOrdersAvg',
    'avgDailyOrders',
    'averageDailyOrders',
    'dailyOrders',
    'ordersPerDay',
  ]);
  const dailyOrdersLabel = pickString(source, [
    'dailyOrdersLabel',
    'dailyOrderRange',
    'orderRange',
    'ordersRange',
  ]);

  const tags = pickStringList(
    source.tags ?? source.categories ?? source.labels
  );
  const cuisine = pickStringList(
    source.cuisine ?? source.cuisines ?? source.cuisineTypes
  );

  return {
    id,
    name,
    status: normalizeStatus(source),
    location: formatLocation(source),
    city: pickString(source, ['city', 'town']),
    phone: pickString(source, [
      'phone',
      'mobile',
      'contactPhone',
      'restaurantPhone',
      'phoneNumber',
      'contact',
    ]),
    distanceKm: pickNumber(source, [
      'distanceKm',
      'distance',
      'distanceInKm',
      'partnerDistance',
    ]),
    dailyOrdersLabel: formatOrderRange(
      dailyOrdersMin,
      dailyOrdersMax,
      dailyOrdersAvg,
      dailyOrdersLabel
    ),
    dailyOrdersMin,
    dailyOrdersMax,
    dailyOrdersAvg,
    rating: pickNumber(source, [
      'rating',
      'avgRating',
      'averageRating',
      'restaurantRating',
      'partnerRating',
    ]),
    lastOrderAt: pickString(source, [
      'lastOrderAt',
      'lastOrderTime',
      'lastDeliveryAt',
      'recentOrderAt',
    ]),
    lastOrderLabel: pickString(source, [
      'lastOrderLabel',
      'lastOrderText',
      'lastOrderDisplay',
    ]),
    tags: tags.length ? tags : undefined,
    cuisine: cuisine.length ? cuisine : undefined,
    menuUrl: pickString(source, ['menuUrl', 'menuLink', 'menu']),
    restaurantId: pickString(source, ['restaurantId', 'outletId', 'storeId']),
    isTopPerformer: pickBool(source, [
      'isTopPerformer',
      'topPerformer',
      'isTop',
      'featured',
    ]),
    ordersCount: pickNumber(source, [
      'ordersCount',
      'totalOrders',
      'orderCount',
      'deliveriesCount',
    ]),
    raw: source,
  };
}

function extractList(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  for (const key of keys) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function mapSummary(
  raw: unknown,
  restaurants: PartnerRestaurant[]
): PartnerRestaurantsSummary {
  const record = asRecord(raw);
  const summaryNode = asRecord(
    record.summary ?? record.stats ?? record.metrics ?? record
  );

  const totalFromApi = pickNumber(summaryNode, [
    'totalRestaurants',
    'total',
    'count',
    'restaurantsCount',
    'partnersCount',
  ]);
  const activeFromApi = pickNumber(summaryNode, [
    'activeRestaurants',
    'active',
    'activeCount',
    'openCount',
  ]);

  const avgDailyOrdersMin = pickNumber(summaryNode, [
    'avgDailyOrdersMin',
    'dailyOrdersMin',
    'minDailyOrders',
  ]);
  const avgDailyOrdersMax = pickNumber(summaryNode, [
    'avgDailyOrdersMax',
    'dailyOrdersMax',
    'maxDailyOrders',
  ]);
  const avgDailyOrders = pickNumber(summaryNode, [
    'avgDailyOrders',
    'averageDailyOrders',
    'dailyOrdersAvg',
  ]);
  const avgDailyOrdersLabel = pickString(summaryNode, [
    'avgDailyOrdersLabel',
    'dailyOrderRange',
    'orderRange',
  ]);

  const avgRatingFromApi = pickNumber(summaryNode, [
    'avgRating',
    'averageRating',
    'avgRestaurantRating',
    'rating',
  ]);

  const totalRestaurants = totalFromApi ?? restaurants.length;
  const activeRestaurants =
    activeFromApi ??
    restaurants.filter((r) => {
      const s = (r.status ?? '').toLowerCase();
      return !s || s === 'active' || s === 'online' || s === 'open';
    }).length;

  const ratings = restaurants
    .map((r) => r.rating)
    .filter((n): n is number => n != null && Number.isFinite(n));
  const avgRating =
    avgRatingFromApi ??
    (ratings.length
      ? ratings.reduce((a, b) => a + b, 0) / ratings.length
      : undefined);

  return {
    totalRestaurants,
    activeRestaurants,
    avgDailyOrdersLabel: formatOrderRange(
      avgDailyOrdersMin,
      avgDailyOrdersMax,
      avgDailyOrders,
      avgDailyOrdersLabel
    ),
    avgDailyOrdersMin,
    avgDailyOrdersMax,
    avgDailyOrders,
    avgRating,
  };
}

function deriveTopPerformers(
  restaurants: PartnerRestaurant[],
  raw: unknown
): PartnerRestaurant[] {
  const record = asRecord(raw);
  const listed = extractList(record, [
    'topPerformers',
    'topPartners',
    'topRestaurants',
    'featured',
    'trending',
  ])
    .map((row, index) => mapRestaurant(row, index))
    .filter(Boolean) as PartnerRestaurant[];

  if (listed.length) return listed;

  const flagged = restaurants.filter((r) => r.isTopPerformer);
  if (flagged.length) return flagged;

  return [...restaurants]
    .filter((r) => r.rating != null || r.dailyOrdersAvg != null || r.ordersCount != null)
    .sort((a, b) => {
      const scoreA =
        (a.rating ?? 0) * 10 +
        (a.dailyOrdersAvg ?? a.dailyOrdersMax ?? a.ordersCount ?? 0);
      const scoreB =
        (b.rating ?? 0) * 10 +
        (b.dailyOrdersAvg ?? b.dailyOrdersMax ?? b.ordersCount ?? 0);
      return scoreB - scoreA;
    })
    .slice(0, 5);
}

function mapRestaurantsPayload(raw: unknown): PartnerRestaurantsResult {
  const root = unwrap(raw);
  const record = asRecord(root);

  const restaurants = extractList(root, [
    'restaurants',
    'outlets',
    'stores',
    'partners',
    'partnerships',
    'items',
    'results',
    'list',
    'data',
  ])
    .map((row, index) => mapRestaurant(row, index))
    .filter(Boolean) as PartnerRestaurant[];

  // Bare array already handled by extractList; if still empty and root is object with id/name, treat as single
  if (!restaurants.length && pickString(record, ['name', 'restaurantName'])) {
    const single = mapRestaurant(root, 0);
    if (single) restaurants.push(single);
  }

  return {
    restaurants,
    summary: mapSummary(root, restaurants),
    topPerformers: deriveTopPerformers(restaurants, root),
  };
}

const RESTAURANT_PATHS = [
  `${ME_BASE}/restaurants`,
  `${ME_BASE}/partner-restaurants`,
  `${ME_BASE}/assigned-restaurants`,
  `${ME_BASE}/outlets`,
  `${PARTNERS_BASE}/restaurants`,
];

async function fetchRestaurantsFromApi(): Promise<PartnerRestaurantsResult> {
  let lastError: Error | null = null;

  for (const path of RESTAURANT_PATHS) {
    try {
      const res = await getJson<unknown>(path);
      return mapRestaurantsPayload(res.data ?? res);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Request failed';
      if (isAuthError(message)) {
        throw error instanceof Error ? error : new Error(message);
      }
      lastError = error instanceof Error ? error : new Error(message);
      if (!isNotFound(message)) {
        // Keep trying aliases for other failures too
      }
    }
  }

  throw (
    lastError ?? new Error('Could not load partner restaurants.')
  );
}

export const partnerRestaurantsApi = {
  /**
   * Partner restaurants list.
   * Mocked until the delivery-service restaurants endpoint ships —
   * flip `USE_MOCK_PARTNER_RESTAURANTS` to wire live data.
   */
  getRestaurants: async (): Promise<PartnerRestaurantsResult> => {
    if (USE_MOCK_PARTNER_RESTAURANTS) {
      // Tiny delay so loading state matches real network UX
      await new Promise((resolve) => setTimeout(resolve, 350));
      return getMockPartnerRestaurants();
    }
    return fetchRestaurantsFromApi();
  },
};

export function formatDistanceKm(km?: number): string | undefined {
  if (km == null || !Number.isFinite(km)) return undefined;
  return `${km.toFixed(km >= 10 ? 0 : 1)} km`;
}

export function formatRestaurantRating(value?: number): string | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return value.toFixed(1);
}

export function formatLastOrder(
  iso?: string,
  label?: string
): string | undefined {
  if (label?.trim()) return label.trim();
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;

  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startToday.getTime() - startThat.getTime()) / 86_400_000
  );
  const time = d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago`;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isRestaurantActive(status?: string): boolean {
  const s = (status ?? '').toLowerCase();
  if (!s) return true;
  return ['active', 'online', 'open', 'enabled', 'live'].includes(s);
}
