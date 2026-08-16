import axios from 'axios';

import { API_BASE_URL, api } from '@/lib/api';
import { PartnerApiError, getApiErrorCode } from '@/lib/errors';
import { postMultipartFile } from '@/lib/multipart-upload';
import type {
  CreateRestaurantPayload,
  CuisineChip,
  HolidayRow,
  KitchenAppConfig,
  KitchenDutySnapshot,
  KitchenSurgeStatus,
  OutletHygiene,
  OutletRatings,
  OutletTimings,
  PauseReasonCode,
  RestaurantOwnerRestaurant,
  RestaurantServiceHealth,
  SpecialHoursDay,
} from '@/lib/restaurant/types';
import { mapTimings } from '@/lib/restaurant/settings-api';
import { parseListingStatus } from '@/lib/restaurant/listing-status';
import {
  storageGetItem,
  storageSetItem,
} from '@/lib/storage';

const RESTAURANT_SERVICE = '/api/v1/restaurant-service';
const RESTAURANT_BASE = `${RESTAURANT_SERVICE}/restaurants`;
const SELECTED_RESTAURANT_KEY = 'partner_selected_restaurant_id';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${API_BASE_URL}${path}`;
}

function extractOwnerRestaurantList(data: unknown): Record<string, unknown>[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter((row): row is Record<string, unknown> => {
      if (!row || typeof row !== 'object') return false;
      return Boolean(
        String(
          (row as Record<string, unknown>)._id ??
            (row as Record<string, unknown>).id ??
            ''
        ).trim()
      );
    });
  }
  if (typeof data !== 'object') return [];

  const record = data as Record<string, unknown>;
  const nested =
    record.restaurants ??
    record.restaurant ??
    record.items ??
    record.results ??
    record.docs;

  if (Array.isArray(nested)) return extractOwnerRestaurantList(nested);
  if (nested && typeof nested === 'object') {
    return extractOwnerRestaurantList([nested]);
  }
  if (String(record._id ?? record.id ?? '').trim()) return [record];
  return [];
}

function mapDuty(
  raw: Record<string, unknown>,
  restaurantId: string
): KitchenDutySnapshot {
  const dutyRaw = String(
    raw.duty ?? (raw.isOnline === true ? 'online' : 'offline')
  );
  return {
    restaurantId: String(raw.restaurantId ?? restaurantId),
    // Listing lifecycle only — never duty `online` / KYC `uploaded`.
    status: parseListingStatus(
      typeof raw.status === 'string' ? raw.status : undefined
    ),
    isOnline: raw.isOnline === true,
    duty: dutyRaw,
    pausedUntil: typeof raw.pausedUntil === 'string' ? raw.pausedUntil : null,
    pauseReason: typeof raw.pauseReason === 'string' ? raw.pauseReason : null,
    acceptScheduled: raw.acceptScheduled === true,
    autoAccept: raw.autoAccept === true,
    openNow: raw.openNow === true,
  };
}

function mapHolidayRow(row: unknown): HolidayRow | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const date = String(record.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const reason =
    typeof record.reason === 'string' && record.reason.trim()
      ? record.reason.trim()
      : undefined;
  return { date, reason };
}

function mapSpecialHoursDay(row: unknown): SpecialHoursDay | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  const date = String(record.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const slots = Array.isArray(record.slots)
    ? record.slots
        .map((slot) => {
          const item = asRecord(slot);
          const open = String(item.open ?? '').trim();
          const close = String(item.close ?? '').trim();
          return open && close ? { open, close } : null;
        })
        .filter((slot): slot is { open: string; close: string } => Boolean(slot))
    : [];
  const reason =
    typeof record.reason === 'string' && record.reason.trim()
      ? record.reason.trim()
      : undefined;
  return {
    date,
    isOpen: record.isOpen === true,
    slots,
    reason,
  };
}

function listingNotLive(error: unknown) {
  return (
    getApiErrorCode(error) === 'RESTAURANT_NOT_FOUND' ||
    (axios.isAxiosError(error) && error.response?.status === 404)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** GET /restaurants/my may return one restaurant or a list of owned restaurants. */
function extractOwnerRestaurantRecord(data: unknown): Record<string, unknown> | null {
  return extractOwnerRestaurantList(data)[0] ?? null;
}

function mapRestaurant(data: Record<string, unknown>): RestaurantOwnerRestaurant {
  const logoUrl =
    resolveMediaUrl(
      (data.logoUrl as string) ||
        (data.logo as string) ||
        (data.logoImage as string) ||
        (data.logoPath as string)
    ) || undefined;

  const coverUrl =
    resolveMediaUrl(
      (data.coverUrl as string) ||
        (data.coverImage as string) ||
        (data.bannerUrl as string) ||
        (data.banner as string)
    ) || undefined;

  // Listing lifecycle only (pending|active|suspended|…). Unknown values
  // (duty online, bank verified, KYC uploaded) map to pending — never live.
  const listingStatus = parseListingStatus(
    (typeof data.listingStatus === 'string' && data.listingStatus.trim()) ||
      (typeof data.status === 'string' && data.status.trim()) ||
      undefined
  );

  return {
    ...data,
    id: String(data._id ?? data.id ?? ''),
    name: String(data.name ?? data.restaurantName ?? ''),
    description: (data.description as string) || undefined,
    logoUrl,
    coverUrl,
    status: listingStatus,
    listingStatus,
    phone:
      (typeof data.phone === 'string' && data.phone.trim()) || undefined,
    cuisines: Array.isArray(data.cuisines)
      ? data.cuisines
          .map((item) =>
            typeof item === 'string'
              ? item.trim()
              : String(
                  (item as { name?: string })?.name ?? ''
                ).trim()
          )
          .filter(Boolean)
      : undefined,
  };
}

function restaurantRecency(row: Record<string, unknown>): number {
  const stamp = String(
    row.updatedAt ?? row.createdAt ?? row.registeredAt ?? ''
  ).trim();
  const time = stamp ? new Date(stamp).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function pickPreferredRestaurant(
  rows: Record<string, unknown>[],
  preferredId?: string | null
): Record<string, unknown> | null {
  if (!rows.length) return null;
  if (preferredId) {
    const preferred = rows.find(
      (row) => String(row._id ?? row.id ?? '') === preferredId
    );
    if (preferred) return preferred;
  }
  // Prefer the most recently updated/created restaurant (newest outlet).
  return [...rows].sort((a, b) => restaurantRecency(b) - restaurantRecency(a))[0] ?? null;
}

function extractError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Network request failed. Check your internet and try again.';
    const status = error.response.status;
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    if (status === 400) {
      const code = String(data?.code ?? '').toUpperCase();
      if (code === 'ALCOHOL_NOT_ALLOWED_IN_CITY') {
        return (
          data?.message ||
          'Alcohol delivery is not allowed in this city.'
        );
      }
      return data?.message || data?.error || `Request failed (${status})`;
    }
    if (status === 403) {
      if (String(data?.code ?? '').toUpperCase() === 'LISTING_STATUS_ADMIN_ONLY') {
        return (
          data?.message ||
          'Only ops can activate a listing. Submit KYC and wait for admin approval.'
        );
      }
      return data?.message || 'You do not have access to this outlet.';
    }
    if (status === 404) {
      return data?.message || 'Restaurant not found.';
    }
    if (status === 409) {
      const code = String(data?.code ?? '').toUpperCase();
      if (code === 'PARTNER_NOT_ACTIVE') {
        return 'Your listing is not live yet. Admin must approve it before you can go online.';
      }
      if (code === 'ALREADY_OFFLINE') {
        return 'Go online first, then pause for a short break.';
      }
      if (code === 'HOLIDAY_LIMIT') {
        return data?.message || 'You can save up to 90 closed dates.';
      }
      if (code === 'SPECIAL_HOURS_LIMIT') {
        return data?.message || 'You can save up to 60 special-hour days.';
      }
      if (code === 'KYC_INCOMPLETE') {
        return (
          data?.message ||
          'Add your 14-digit FSSAI number and certificate photo to submit.'
        );
      }
      if (code === 'KYC_LOCKED') {
        return (
          data?.message ||
          'KYC is locked while admin reviews your listing.'
        );
      }
      if (code === 'OUTLET_PHOTOS_LIMIT') {
        return data?.message || 'You can upload up to 8 outlet photos.';
      }
      if (code === 'ILLEGAL_TRANSITION') {
        return data?.message || 'This listing cannot be submitted right now.';
      }
      return data?.message || data?.code || 'This outlet cannot do that yet.';
    }
    return data?.message || data?.error || `Request failed (${status})`;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function throwRestaurantError(error: unknown, fallback: string): never {
  throw new PartnerApiError(
    extractError(error, fallback),
    getApiErrorCode(error)
  );
}

/** Strip empty optionals — matches the working PowerShell POST body shape. */
export function buildCreateRestaurantPayload(
  input: CreateRestaurantPayload
): CreateRestaurantPayload {
  const payload: CreateRestaurantPayload = {
    name: input.name.trim(),
    address: {
      street: input.address.street.trim(),
      city: input.address.city.trim(),
      state: input.address.state.trim(),
      country: input.address.country.trim() || 'India',
      pincode: input.address.pincode.trim(),
    },
    location: {
      type: 'Point',
      /** GeoJSON order: [longitude, latitude] — matches PowerShell coordinates @(lng, lat) */
      coordinates: [input.location.coordinates[0], input.location.coordinates[1]],
    },
  };

  const description = input.description?.trim();
  if (description) payload.description = description;

  const fssai = input.fssaiLicense?.trim();
  if (fssai) payload.fssaiLicense = fssai;

  const gstin = input.gstin?.trim();
  if (gstin) payload.gstin = gstin;

  if (input.priceRange) payload.priceRange = input.priceRange;

  if (typeof input.costForTwo === 'number' && input.costForTwo > 0) {
    payload.costForTwo = input.costForTwo;
  }

  const cuisines = (input.cuisines ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
  if (cuisines.length) payload.cuisines = cuisines;

  const area = input.address.area?.trim();
  if (area) payload.address.area = area;

  return payload;
}

async function uploadRestaurantImage(
  restaurantId: string,
  endpoint: 'logo' | 'cover',
  file: { uri: string; fileName: string; mimeType: string }
) {
  const data = await postMultipartFile(
    `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/${endpoint}`,
    'photo',
    {
      uri: file.uri,
      name: file.fileName || `${endpoint}.jpg`,
      type: file.mimeType || 'image/jpeg',
    }
  );
  return mapRestaurant(data);
}

export const restaurantOwnerApi = {
  createRestaurant: async (payload: CreateRestaurantPayload): Promise<RestaurantOwnerRestaurant> => {
    try {
      const body = buildCreateRestaurantPayload(payload);
      const res = await api.post<Envelope<Record<string, unknown>>>(RESTAURANT_BASE, body);
      const raw = res.data?.data ?? res.data;
      const record = extractOwnerRestaurantRecord(raw) ?? (raw as Record<string, unknown>);
      const mapped = mapRestaurant(record);
      if (!mapped.id) throw new Error('Restaurant creation failed (missing id)');
      return mapped;
    } catch (error) {
      throwRestaurantError(error, 'Failed to create restaurant');
    }
  },

  getMyRestaurant: async (): Promise<RestaurantOwnerRestaurant | null> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/my`
      );
      const raw = res.data?.data ?? res.data;
      const rows = extractOwnerRestaurantList(raw);
      if (!rows.length) return null;

      const preferredId = await storageGetItem(SELECTED_RESTAURANT_KEY);
      const record = pickPreferredRestaurant(rows, preferredId);
      if (!record) return null;

      const mapped = mapRestaurant(record);
      if (!mapped.id) return null;

      // Only persist when nothing was saved yet (don't clobber a better selection).
      if (!preferredId) {
        await storageSetItem(SELECTED_RESTAURANT_KEY, mapped.id);
      }

      return mapped;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return null;
      throwRestaurantError(error, 'Failed to load restaurant');
    }
  },

  getMyRestaurants: async (): Promise<RestaurantOwnerRestaurant[]> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/my`
      );
      const raw = res.data?.data ?? res.data;
      return extractOwnerRestaurantList(raw)
        .map(mapRestaurant)
        .filter((row) => Boolean(row.id));
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return [];
      throwRestaurantError(error, 'Failed to load restaurants');
    }
  },

  setSelectedRestaurantId: async (restaurantId: string) => {
    await storageSetItem(SELECTED_RESTAURANT_KEY, restaurantId);
  },

  getSelectedRestaurantId: async () => storageGetItem(SELECTED_RESTAURANT_KEY),

  uploadLogo: async (
    restaurantId: string,
    file: { uri: string; fileName: string; mimeType: string }
  ) => uploadRestaurantImage(restaurantId, 'logo', file),

  uploadCover: async (
    restaurantId: string,
    file: { uri: string; fileName: string; mimeType: string }
  ) => uploadRestaurantImage(restaurantId, 'cover', file),

  /** GET /health + GET /health/ready */
  getServiceHealth: async (): Promise<RestaurantServiceHealth> => {
    try {
      const live = await api.get<Record<string, unknown>>(
        `${RESTAURANT_SERVICE}/health`,
        { timeout: 8000 }
      );
      const liveOk =
        live.status < 400 &&
        String(live.data?.status ?? 'ok').toLowerCase() !== 'down';
      if (!liveOk) {
        return { ok: false, ready: false, message: 'Restaurant service is down' };
      }
      try {
        const ready = await api.get<Record<string, unknown>>(
          `${RESTAURANT_SERVICE}/health/ready`,
          { timeout: 8000, validateStatus: () => true }
        );
        const readyOk = ready.status < 400;
        const checks = ready.data?.checks as
          | { mongo?: string; redis?: string }
          | undefined;
        const message = readyOk
          ? undefined
          : `Kitchen database is not ready (${checks?.mongo ?? 'mongo'} / ${checks?.redis ?? 'redis'}).`;
        return { ok: true, ready: readyOk, message };
      } catch {
        return {
          ok: true,
          ready: false,
          message: 'Restaurant service is up but not ready yet.',
        };
      }
    } catch {
      return {
        ok: false,
        ready: false,
        message: 'Cannot reach restaurant-service. Try again shortly.',
      };
    }
  },

  /** GET /cuisines */
  listCuisines: async (): Promise<CuisineChip[]> => {
    try {
      const res = await api.get<Envelope<unknown>>(`${RESTAURANT_SERVICE}/cuisines`);
      const raw = res.data?.data ?? res.data;
      const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as { cuisines?: unknown })?.cuisines)
          ? ((raw as { cuisines: unknown[] }).cuisines)
          : extractOwnerRestaurantList(raw);
      const chips: CuisineChip[] = [];
      for (const row of list) {
        if (typeof row === 'string') {
          const name = row.trim();
          if (!name) continue;
          chips.push({
            slug: name.toLowerCase().replace(/\s+/g, '-'),
            name,
          });
          continue;
        }
        const record = row as Record<string, unknown>;
        const name = String(record.name ?? record.label ?? '').trim();
        if (!name) continue;
        const slug = String(record.slug ?? name)
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '-');
        const count = Number(record.restaurantCount);
        chips.push({
          slug,
          name,
          restaurantCount: Number.isFinite(count) ? count : undefined,
          imageUrl:
            typeof record.imageUrl === 'string' ? record.imageUrl : null,
        });
      }
      return chips;
    } catch (error) {
      throwRestaurantError(error, 'Failed to load cuisines');
    }
  },

  /** GET /restaurants/:restaurantId */
  getRestaurant: async (restaurantId: string): Promise<RestaurantOwnerRestaurant> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}`
      );
      const raw = res.data?.data ?? res.data;
      const record =
        extractOwnerRestaurantRecord(raw) ?? (raw as Record<string, unknown>);
      const mapped = mapRestaurant(record);
      if (!mapped.id) throw new Error('Restaurant not found');
      return mapped;
    } catch (error) {
      throwRestaurantError(error, 'Failed to load restaurant');
    }
  },

  /** GET /restaurants/:restaurantId/config?appVersion= */
  getConfig: async (
    restaurantId: string,
    appVersion?: string
  ): Promise<KitchenAppConfig> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/config`,
        { params: appVersion ? { appVersion } : undefined }
      );
      const raw = (res.data?.data ?? res.data) as Record<string, unknown>;
      const flags = raw.featureFlags;
      const reasons = Array.isArray(raw.rejectReasons) ? raw.rejectReasons : [];
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        minSupportedAppVersion: String(raw.minSupportedAppVersion ?? '1.0.0'),
        latestAppVersion: String(raw.latestAppVersion ?? '1.0.0'),
        forceUpdate: raw.forceUpdate === true,
        updateAvailable: raw.updateAvailable === true,
        timezone: String(raw.timezone ?? 'Asia/Kolkata'),
        featureFlags:
          flags && typeof flags === 'object'
            ? (flags as Record<string, boolean>)
            : {},
        rejectReasons: reasons
          .map((row) => {
            const record = row as Record<string, unknown>;
            const code = String(record.code ?? '').trim();
            const label = String(record.label ?? '').trim();
            return code && label ? { code, label } : null;
          })
          .filter((row): row is { code: string; label: string } => Boolean(row)),
      };
    } catch (error) {
      throwRestaurantError(error, 'Failed to load kitchen config');
    }
  },

  /** GET /restaurants/:restaurantId/duty */
  getDuty: async (restaurantId: string): Promise<KitchenDutySnapshot> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/duty`
      );
      const raw = asRecord(res.data?.data ?? res.data);
      return mapDuty(raw, restaurantId);
    } catch (error) {
      throwRestaurantError(error, 'Failed to load kitchen duty');
    }
  },

  /** PUT /restaurants/:restaurantId/online — 409 PARTNER_NOT_ACTIVE until admin approve. */
  goOnline: async (restaurantId: string): Promise<KitchenDutySnapshot> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/online`,
        {}
      );
      return mapDuty(asRecord(res.data?.data ?? res.data), restaurantId);
    } catch (error) {
      throwRestaurantError(error, 'Could not go online');
    }
  },

  /** PUT /restaurants/:restaurantId/offline — stop new orders; in-flight continue. */
  goOffline: async (restaurantId: string): Promise<KitchenDutySnapshot> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/offline`,
        {}
      );
      return mapDuty(asRecord(res.data?.data ?? res.data), restaurantId);
    } catch (error) {
      throwRestaurantError(error, 'Could not go offline');
    }
  },

  /**
   * PUT /restaurants/:restaurantId/pause `{ minutes, reason }` 1–120.
   * Requires already online; 409 ALREADY_OFFLINE otherwise.
   */
  pauseDuty: async (
    restaurantId: string,
    input: { minutes: number; reason: PauseReasonCode }
  ): Promise<KitchenDutySnapshot> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/pause`,
        { minutes: input.minutes, reason: input.reason }
      );
      return mapDuty(asRecord(res.data?.data ?? res.data), restaurantId);
    } catch (error) {
      throwRestaurantError(error, 'Could not pause kitchen');
    }
  },

  /**
   * PUT /restaurants/:restaurantId/status — duty `online`/`offline` only.
   * Never sends `active` (admin approve).
   */
  setDutyStatus: async (
    restaurantId: string,
    status: 'online' | 'offline'
  ): Promise<KitchenDutySnapshot> => {
    if (status !== 'online' && status !== 'offline') {
      throw new PartnerApiError(
        'Kitchen can only set online or offline. Listing live is admin-only.',
        'INVALID_STATUS'
      );
    }
    try {
      await api.put(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/status`,
        { status }
      );
      return restaurantOwnerApi.getDuty(restaurantId);
    } catch (error) {
      throwRestaurantError(error, 'Could not update kitchen status');
    }
  },

  /**
   * GET /restaurants/:restaurantId/surge-status.
   * ZONE_NOT_ASSIGNED / DOWNSTREAM_UNAVAILABLE are returned, never invented surge.
   */
  getSurgeStatus: async (
    restaurantId: string
  ): Promise<KitchenSurgeStatus> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/surge-status`
      );
      const raw = asRecord(res.data?.data ?? res.data);
      const multiplier = Number(raw.surgeMultiplier);
      const reason = String(raw.reason ?? 'no_surge');
      const surgeActive =
        raw.surgeActive === true ||
        reason === 'zone_surge' ||
        (Number.isFinite(multiplier) && multiplier > 1);
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        zoneId:
          typeof raw.zoneId === 'string' && raw.zoneId.trim()
            ? raw.zoneId.trim()
            : undefined,
        name:
          typeof raw.name === 'string' && raw.name.trim()
            ? raw.name.trim()
            : undefined,
        city:
          typeof raw.city === 'string' && raw.city.trim()
            ? raw.city.trim()
            : undefined,
        surgeMultiplier: Number.isFinite(multiplier) ? multiplier : 1,
        surgeActive,
        reason,
        assigned: true,
        unavailable: false,
      };
    } catch (error) {
      const code = getApiErrorCode(error);
      if (code === 'ZONE_NOT_ASSIGNED') {
        return {
          restaurantId,
          surgeMultiplier: 1,
          surgeActive: false,
          reason: 'zone_unassigned',
          assigned: false,
          unavailable: false,
          message: 'Zone not assigned yet',
        };
      }
      if (
        code === 'DOWNSTREAM_UNAVAILABLE' ||
        (axios.isAxiosError(error) && error.response?.status === 503)
      ) {
        return {
          restaurantId,
          surgeMultiplier: 1,
          surgeActive: false,
          reason: 'unavailable',
          assigned: true,
          unavailable: true,
          message: 'Surge unavailable right now',
        };
      }
      throwRestaurantError(error, 'Failed to load surge status');
    }
  },

  /** GET /restaurants/:restaurantId/timings — week hours + isOpenNow. */
  getTimings: async (restaurantId: string): Promise<OutletTimings> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/timings`
      );
      const raw = asRecord(res.data?.data ?? res.data);
      const holidays = Array.isArray(raw.holidays)
        ? raw.holidays
            .map(mapHolidayRow)
            .filter((row): row is HolidayRow => Boolean(row))
        : [];
      return {
        timezone: String(raw.timezone ?? 'Asia/Kolkata'),
        isOpenNow: raw.isOpenNow === true,
        nextOpenAt:
          typeof raw.nextOpenAt === 'string' && raw.nextOpenAt.trim()
            ? raw.nextOpenAt
            : null,
        week: mapTimings(raw.week ?? raw) as OutletTimings['week'],
        holidays,
      };
    } catch (error) {
      throwRestaurantError(error, 'Failed to load opening hours');
    }
  },

  /** GET /restaurants/:restaurantId/holidays — closed dates. */
  getHolidays: async (
    restaurantId: string
  ): Promise<{
    restaurantId: string;
    timezone: string;
    holidays: HolidayRow[];
  }> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/holidays`
      );
      const raw = asRecord(res.data?.data ?? res.data);
      const holidays = Array.isArray(raw.holidays)
        ? raw.holidays
            .map(mapHolidayRow)
            .filter((row): row is HolidayRow => Boolean(row))
        : [];
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        timezone: String(raw.timezone ?? 'Asia/Kolkata'),
        holidays,
      };
    } catch (error) {
      throwRestaurantError(error, 'Failed to load holidays');
    }
  },

  /** PUT /restaurants/:restaurantId/holidays — replace closed dates. */
  updateHolidays: async (
    restaurantId: string,
    holidays: HolidayRow[]
  ): Promise<{
    restaurantId: string;
    timezone: string;
    holidays: HolidayRow[];
  }> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/holidays`,
        {
          holidays: holidays.map((row) => ({
            date: row.date,
            reason: row.reason,
          })),
        }
      );
      const raw = asRecord(res.data?.data ?? res.data);
      const next = Array.isArray(raw.holidays)
        ? raw.holidays
            .map(mapHolidayRow)
            .filter((row): row is HolidayRow => Boolean(row))
        : holidays;
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        timezone: String(raw.timezone ?? 'Asia/Kolkata'),
        holidays: next,
      };
    } catch (error) {
      throwRestaurantError(error, 'Could not save closed dates');
    }
  },

  /** GET /restaurants/:restaurantId/special-hours */
  getSpecialHours: async (
    restaurantId: string
  ): Promise<{
    restaurantId: string;
    timezone: string;
    days: SpecialHoursDay[];
  }> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/special-hours`
      );
      const raw = asRecord(res.data?.data ?? res.data);
      const days = Array.isArray(raw.days)
        ? raw.days
            .map(mapSpecialHoursDay)
            .filter((row): row is SpecialHoursDay => Boolean(row))
        : [];
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        timezone: String(raw.timezone ?? 'Asia/Kolkata'),
        days,
      };
    } catch (error) {
      throwRestaurantError(error, 'Failed to load special hours');
    }
  },

  /** PUT /restaurants/:restaurantId/special-hours — set or remove one day. */
  updateSpecialHours: async (
    restaurantId: string,
    input:
      | { date: string; remove: true }
      | {
          date: string;
          isOpen: boolean;
          slots?: { open: string; close: string }[];
          reason?: string;
        }
  ): Promise<{
    restaurantId: string;
    timezone: string;
    days: SpecialHoursDay[];
  }> => {
    try {
      let body: Record<string, unknown>;
      if ('remove' in input && input.remove) {
        body = { date: input.date, remove: true };
      } else {
        const next = input as {
          date: string;
          isOpen: boolean;
          slots?: { open: string; close: string }[];
          reason?: string;
        };
        body = {
          date: next.date,
          isOpen: next.isOpen,
          slots: next.isOpen ? next.slots ?? [] : [],
          reason: next.reason,
        };
      }
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/special-hours`,
        body
      );
      const raw = asRecord(res.data?.data ?? res.data);
      const days = Array.isArray(raw.days)
        ? raw.days
            .map(mapSpecialHoursDay)
            .filter((row): row is SpecialHoursDay => Boolean(row))
        : [];
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        timezone: String(raw.timezone ?? 'Asia/Kolkata'),
        days,
      };
    } catch (error) {
      throwRestaurantError(error, 'Could not save special hours');
    }
  },

  /**
   * GET /restaurants/:restaurantId/hygiene
   * 404 until listing is `active`.
   */
  getHygiene: async (restaurantId: string): Promise<OutletHygiene> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/hygiene`
      );
      const raw = asRecord(res.data?.data ?? res.data);
      return {
        restaurantId,
        available: true,
        fssaiMasked:
          typeof raw.fssaiMasked === 'string' ? raw.fssaiMasked : null,
        hygieneScore: Number(raw.hygieneScore ?? 0) || 0,
        lastAuditAt:
          typeof raw.lastAuditAt === 'string' ? raw.lastAuditAt : null,
      };
    } catch (error) {
      if (listingNotLive(error)) {
        return {
          restaurantId,
          available: false,
          fssaiMasked: null,
          hygieneScore: 0,
          lastAuditAt: null,
          message: 'Hygiene is shown after admin approves your listing.',
        };
      }
      throwRestaurantError(error, 'Failed to load hygiene');
    }
  },

  /**
   * GET /restaurants/:restaurantId/ratings — star histogram.
   * 404 until listing is `active`.
   */
  getRatings: async (restaurantId: string): Promise<OutletRatings> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/ratings`
      );
      const raw = asRecord(res.data?.data ?? res.data);
      const breakdown = asRecord(raw.breakdown);
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        available: true,
        avgRating: Number(raw.avgRating ?? 0) || 0,
        totalRatings: Number(raw.totalRatings ?? 0) || 0,
        breakdown: {
          1: Number(breakdown['1'] ?? 0) || 0,
          2: Number(breakdown['2'] ?? 0) || 0,
          3: Number(breakdown['3'] ?? 0) || 0,
          4: Number(breakdown['4'] ?? 0) || 0,
          5: Number(breakdown['5'] ?? 0) || 0,
        },
      };
    } catch (error) {
      if (listingNotLive(error)) {
        return {
          restaurantId,
          available: false,
          avgRating: 0,
          totalRatings: 0,
          breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          message: 'Ratings appear after admin approves your listing.',
        };
      }
      throwRestaurantError(error, 'Failed to load ratings');
    }
  },
};
