import axios from 'axios';

import { API_BASE_URL, api } from '@/lib/api';
import { postMultipartFile, postMultipartFiles } from '@/lib/multipart-upload';
import { isListingLive } from '@/lib/restaurant/listing-status';
import type { RestaurantOwnerRestaurant } from '@/lib/restaurant/types';
import {
  DEFAULT_STAFF_PERMISSIONS,
  emptyTimings,
  type AddStaffPayload,
  type DayKey,
  type DayTiming,
  type InviteStaffPayload,
  type RestaurantDetail,
  type RestaurantGalleryImage,
  type RestaurantSettings,
  type RestaurantStaffMember,
  type RestaurantTimings,
  type StaffInvite,
  type StaffPermission,
  type StaffRole,
  type StaffRoster,
  type TimeSlot,
  type UpdateRestaurantPayload,
  type UpdateRestaurantStatusPayload,
  type UpdateSettingsPayload,
  type UpdateStaffPayload,
  type UpdateTimingsPayload,
  WEEK_DAYS,
} from '@/lib/restaurant/settings-types';

const RESTAURANT_SERVICE = '/api/v1/restaurant-service';
const RESTAURANT_BASE = `${RESTAURANT_SERVICE}/restaurants`;

const STAFF_ROLES = new Set<StaffRole>(['manager', 'kitchen', 'cashier']);

export function normalizeStaffRole(value?: string | null): StaffRole {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (raw === 'manager' || raw === 'admin') return 'manager';
  if (raw === 'cashier' || raw === 'counter') return 'cashier';
  if (
    raw === 'kitchen_staff' ||
    raw === 'kitchen' ||
    raw === 'staff' ||
    raw === 'cook'
  ) {
    return 'kitchen';
  }
  if (STAFF_ROLES.has(raw as StaffRole)) return raw as StaffRole;
  return 'kitchen';
}

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
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
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return undefined;
}

function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${API_BASE_URL}${path}`;
}

function extractError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'Network request failed. Check your internet and try again.';
    }
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    if (String(data?.code ?? '').toUpperCase() === 'ALCOHOL_NOT_ALLOWED_IN_CITY') {
      return (
        data?.message ||
        'Alcohol delivery is not allowed in this city.'
      );
    }
    return (
      [data?.message, data?.error].filter(Boolean).join(' ') ||
      `Request failed (${error.response.status})`
    ) + (data?.code ? ` (${data.code})` : '');
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function toGeoJsonPoint(
  location?: { type?: string; coordinates?: [number, number] | number[] } | null
): { type: 'Point'; coordinates: [number, number] } | undefined {
  if (!location?.coordinates || location.coordinates.length < 2) return undefined;
  const lng = Number(location.coordinates[0]);
  const lat = Number(location.coordinates[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  // MongoDB 2dsphere requires GeoJSON Point — coordinates are [longitude, latitude]
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return undefined;
  return {
    type: 'Point',
    coordinates: [lng, lat],
  };
}

function isGeoKeyError(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'isGeoKeyError' in error &&
    (error as { isGeoKeyError?: boolean }).isGeoKeyError
  ) {
    return true;
  }
  const message = extractError(error, '').toLowerCase();
  return (
    message.includes("can't extract geo keys") ||
    message.includes('cannot extract geo keys') ||
    message.includes('geo keys') ||
    message.includes('2dsphere') ||
    message.includes('geojson type "point"')
  );
}

function friendlyApiError(error: unknown, fallback: string) {
  const message = extractError(error, fallback);
  if (isGeoKeyError(error)) {
    return 'Saved map data on the server is missing GeoJSON type "Point". Saving profile once will repair it automatically.';
  }
  if (message.length > 180) {
    return `${message.slice(0, 160).trim()}…`;
  }
  return message;
}

async function putRestaurantBody(
  restaurantId: string,
  body: Record<string, unknown>
): Promise<RestaurantDetail> {
  const res = await request<Record<string, unknown>>(
    `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}`,
    { method: 'PUT', body }
  );
  return mapRestaurantDetail(unwrapRestaurant(res));
}

async function repairBrokenLocation(restaurantId: string) {
  const current = await restaurantSettingsApi.getRestaurant(restaurantId);
  const point = toGeoJsonPoint(current.location);
  if (!point) {
    throw new Error(
      'Location data is invalid and no coordinates are available to repair it. Open Profile → Change on Map, then save.'
    );
  }
  // Low-level PUT so we don't recurse through updateRestaurant.
  await putRestaurantBody(restaurantId, {
    location: {
      type: 'Point',
      coordinates: [point.coordinates[0], point.coordinates[1]],
    },
  });
}

async function withGeoRepair<T>(
  restaurantId: string,
  action: () => Promise<T>
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isGeoKeyError(error)) throw error;
    await repairBrokenLocation(restaurantId);
    return action();
  }
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<Envelope<T>> {
  const { method = 'GET', body, params } = options;
  const isMutating = method !== 'GET';

  try {
    const response = await api.request<Envelope<T> | T>({
      url: path,
      method,
      data: isMutating ? (body ?? {}) : body,
      params,
      headers: isMutating
        ? {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          }
        : { Accept: 'application/json' },
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
    const err = new Error(
      friendlyApiError(error, 'Request failed')
    ) as Error & { isGeoKeyError?: boolean };
    err.isGeoKeyError = isGeoKeyError(error);
    throw err;
  }
}

function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const nested =
    record.restaurants ??
    record.staff ??
    record.members ??
    record.users ??
    record.images ??
    record.gallery ??
    record.items ??
    record.results ??
    record.docs ??
    record.list ??
    record.data;
  if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  if (nested && typeof nested === 'object') return extractList(nested);
  return [];
}

function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return fallback;
  const hh = String(Math.min(23, Number(match[1]))).padStart(2, '0');
  const mm = String(Math.min(59, Number(match[2]))).padStart(2, '0');
  return `${hh}:${mm}`;
}

function mapSlot(raw: unknown): TimeSlot {
  const record = asRecord(raw);
  return {
    open: normalizeTime(
      record.open ?? record.openTime ?? record.from ?? record.start,
      '09:00'
    ),
    close: normalizeTime(
      record.close ?? record.closeTime ?? record.to ?? record.end,
      '22:00'
    ),
  };
}

function mapDayTiming(raw: unknown): DayTiming {
  if (Array.isArray(raw)) {
    const slots = raw.map(mapSlot);
    return {
      isOpen: slots.length > 0,
      slots: slots.length ? slots : [{ open: '09:00', close: '22:00' }],
    };
  }
  const record = asRecord(raw);
  const slotsRaw = record.slots ?? record.timings ?? record.hours;
  const slots = Array.isArray(slotsRaw)
    ? slotsRaw.map(mapSlot)
    : [
        {
          open: normalizeTime(
            record.open ?? record.openTime ?? record.from,
            '09:00'
          ),
          close: normalizeTime(
            record.close ?? record.closeTime ?? record.to,
            '22:00'
          ),
        },
      ];
  const isOpen =
    pickBool(record, ['isOpen', 'open', 'enabled', 'active']) ??
    slots.length > 0;
  return {
    isOpen: Boolean(isOpen),
    slots: slots.slice(0, 3),
  };
}

export function mapTimings(raw: unknown): RestaurantTimings {
  const base = emptyTimings();
  const record = asRecord(raw);
  const nested = asRecord(record.timings ?? record.operatingHours ?? record.hours);
  const source = Object.keys(nested).length ? nested : record;

  for (const day of WEEK_DAYS) {
    const value =
      source[day.key] ??
      source[day.label] ??
      source[day.label.toLowerCase()] ??
      source[day.key.slice(0, 3)];
    if (value != null) {
      base[day.key] = mapDayTiming(value);
    }
  }
  return base;
}

function mapSettings(raw: unknown): RestaurantSettings {
  const record = asRecord(raw);
  const nested = asRecord(record.settings ?? record);
  return {
    taxRate: pickNumber(nested, ['taxRate', 'tax', 'gstRate']),
    packagingCharge: pickNumber(nested, [
      'packagingCharge',
      'packagingFee',
      'packingCharge',
    ]),
    minOrderValue: pickNumber(nested, [
      'minimumOrderValue',
      'minOrderValue',
      'minimumOrder',
      'minOrder',
    ]),
    freeDeliveryThreshold: pickNumber(nested, [
      'freeDeliveryThreshold',
      'freeDeliveryAbove',
      'freeDeliveryMin',
    ]),
    maxDeliveryRadius: pickNumber(nested, [
      'maxDeliveryRadius',
      'deliveryRadius',
      'radiusKm',
      'deliveryRadiusKm',
    ]),
    avgPreparationTime: pickNumber(nested, [
      'avgPrepTime',
      'avgPreparationTime',
      'preparationTime',
      'prepTime',
    ]),
    autoAcceptOrders: pickBool(nested, ['autoAcceptOrders', 'autoAccept']),
    acceptScheduledOrders: pickBool(nested, [
      'acceptScheduledOrders',
      'scheduledOrders',
    ]),
    acceptPreOrders: pickBool(nested, [
      'acceptsPreOrders',
      'acceptPreOrders',
      'preOrders',
    ]),
    pureVegetarian: pickBool(nested, [
      'isPureVeg',
      'pureVegetarian',
      'pureVeg',
    ]),
    cashOnDelivery: pickBool(nested, [
      'isCashOnDelivery',
      'cashOnDelivery',
      'cod',
      'acceptCod',
    ]),
    onlinePayments: pickBool(nested, [
      'isOnlinePayment',
      'onlinePayments',
      'acceptOnlinePayment',
      'onlinePayment',
    ]),
    sellsAlcohol: pickBool(nested, ['sellsAlcohol', 'alcohol']),
  };
}

/** Backend Zod schema keys for PUT .../settings (do not nest under `settings`). */
function toApiSettingsBody(payload: UpdateSettingsPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (payload.taxRate !== undefined) body.taxRate = payload.taxRate;
  if (payload.packagingCharge !== undefined) {
    body.packagingCharge = payload.packagingCharge;
  }
  if (payload.minOrderValue !== undefined) {
    body.minimumOrderValue = payload.minOrderValue;
  }
  if (payload.freeDeliveryThreshold !== undefined) {
    body.freeDeliveryThreshold = payload.freeDeliveryThreshold;
  }
  if (payload.maxDeliveryRadius !== undefined) {
    body.maxDeliveryRadius = payload.maxDeliveryRadius;
  }
  if (payload.avgPreparationTime !== undefined) {
    body.avgPrepTime = payload.avgPreparationTime;
  }
  if (payload.autoAcceptOrders !== undefined) {
    body.autoAcceptOrders = payload.autoAcceptOrders;
  }
  if (payload.acceptScheduledOrders !== undefined) {
    body.acceptScheduledOrders = payload.acceptScheduledOrders;
  }
  if (payload.pureVegetarian !== undefined) {
    body.isPureVeg = payload.pureVegetarian;
  }
  if (payload.cashOnDelivery !== undefined) {
    body.isCashOnDelivery = payload.cashOnDelivery;
  }
  if (payload.onlinePayments !== undefined) {
    body.isOnlinePayment = payload.onlinePayments;
  }
  if (payload.acceptPreOrders !== undefined) {
    body.acceptsPreOrders = payload.acceptPreOrders;
  }
  if (payload.sellsAlcohol !== undefined) {
    body.sellsAlcohol = payload.sellsAlcohol;
  }

  return body;
}

function mapGalleryImages(raw: unknown): RestaurantGalleryImage[] {
  const rows = Array.isArray(raw) ? raw : extractList(raw);
  return rows
    .map((item): RestaurantGalleryImage | null => {
      if (typeof item === 'string' && item.trim()) {
        const url = resolveMediaUrl(item.trim()) ?? item.trim();
        return { id: url, url };
      }
      const record = asRecord(item);
      const url =
        resolveMediaUrl(
          pickString(record, ['url', 'imageUrl', 'src', 'path', 'image'])
        ) ?? '';
      if (!url) return null;
      const id = pickString(record, ['_id', 'id', 'imageId']) || url;
      return { id, url };
    })
    .filter((row): row is RestaurantGalleryImage => Boolean(row?.id && row.url));
}

function galleryPathId(imageUrl: string) {
  try {
    const parsed = new URL(imageUrl);
    const last = parsed.pathname.split('/').filter(Boolean).pop() ?? 'image';
    return last.replace(/\.[a-z0-9]+$/i, '') || last;
  } catch {
    return 'gallery';
  }
}

async function detailFromUpload(
  restaurantId: string,
  data: Record<string, unknown>
): Promise<RestaurantDetail> {
  const mapped = mapRestaurantDetail(asRecord(data));
  if (!mapped.id) {
    return restaurantSettingsApi.getRestaurant(restaurantId);
  }
  return mapped;
}

function mapCuisines(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        const record = asRecord(item);
        return pickString(record, ['name', 'label', 'cuisine']) ?? '';
      })
      .filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function mapAddress(raw: unknown): RestaurantDetail['address'] {
  const record = asRecord(raw);
  if (!Object.keys(record).length) return undefined;
  return {
    street: pickString(record, ['street', 'addressLine1', 'line1']) ?? '',
    area: pickString(record, ['area', 'locality', 'addressLine2', 'line2']),
    city: pickString(record, ['city']) ?? '',
    state: pickString(record, ['state']) ?? '',
    country: pickString(record, ['country']) ?? 'India',
    pincode: pickString(record, ['pincode', 'pin', 'zip', 'postalCode']) ?? '',
  };
}

function mapLocation(raw: unknown): {
  location?: RestaurantDetail['location'];
  locationGeoValid: boolean;
} {
  const record = asRecord(raw);
  const coords = Array.isArray(record.coordinates)
    ? (record.coordinates as number[])
    : null;
  const lng =
    pickNumber(record, ['lng', 'longitude', 'lon']) ??
    (coords ? Number(coords[0]) : undefined);
  const lat =
    pickNumber(record, ['lat', 'latitude']) ??
    (coords ? Number(coords[1]) : undefined);
  if (lat == null || lng == null) {
    return { locationGeoValid: true };
  }
  const type = String(record.type ?? '').trim().toLowerCase();
  const locationGeoValid = type === 'point';
  return {
    location: {
      type: 'Point',
      coordinates: [lng, lat],
    },
    locationGeoValid,
  };
}

export function mapRestaurantDetail(
  raw: Record<string, unknown>
): RestaurantDetail {
  const address = mapAddress(raw.address ?? raw.locationAddress);
  const mappedLocation = mapLocation(raw.location);
  const fallbackLocation =
    mappedLocation.location == null
      ? mapLocation({
          lat: raw.lat ?? raw.latitude,
          lng: raw.lng ?? raw.longitude ?? raw.lon,
          type: raw.locationType,
        })
      : mappedLocation;

  const images = mapGalleryImages(
    raw.images ?? raw.gallery ?? raw.galleryImages ?? raw.photos
  );

  const isOnline = pickBool(raw, ['isOnline', 'online']) ?? false;

  const isOpen =
    pickBool(raw, ['isOpen', 'open']) ??
    isOnline ??
    (String(raw.status ?? '').toLowerCase() === 'open'
      ? true
      : String(raw.status ?? '').toLowerCase() === 'closed'
        ? false
        : undefined);

  return {
    ...raw,
    id: pickString(raw, ['_id', 'id', 'restaurantId']) ?? '',
    name: pickString(raw, ['name', 'restaurantName']) ?? '',
    description: pickString(raw, ['description', 'about']),
    logoUrl: resolveMediaUrl(
      pickString(raw, ['logoUrl', 'logo', 'logoImage', 'logoPath'])
    ),
    coverUrl: resolveMediaUrl(
      pickString(raw, ['coverUrl', 'cover', 'coverImage', 'bannerUrl', 'banner'])
    ),
    // Listing status only — do not use bank/KYC verificationStatus or duty here.
    status: pickString(raw, ['listingStatus', 'status']),
    isOpen,
    isOnline,
    isActive: isListingLive(pickString(raw, ['listingStatus', 'status'])),
    fssaiLicense: pickString(raw, ['fssaiLicense', 'fssai', 'fssaiNo']),
    gstin: pickString(raw, ['gstin', 'gst', 'gstNumber']),
    phone: pickString(raw, ['phone', 'contactPhone', 'mobile']),
    priceRange: pickString(raw, ['priceRange', 'pricing']),
    costForTwo: pickNumber(raw, ['costForTwo', 'averageCostForTwo', 'avgCost']),
    cuisines: mapCuisines(raw.cuisines ?? raw.cuisine ?? raw.cuisineTypes),
    address,
    location: fallbackLocation.location,
    locationGeoValid: fallbackLocation.locationGeoValid,
    timings: mapTimings(raw.timings ?? raw.operatingHours ?? raw.hours),
    settings: mapSettings(raw.settings ?? raw),
    images,
  };
}

function mapStaff(raw: Record<string, unknown>): RestaurantStaffMember {
  const permissions = Array.isArray(raw.permissions)
    ? (raw.permissions.filter(
        (item) => typeof item === 'string'
      ) as StaffPermission[])
    : [];
  const staffIdRaw = pickString(raw, ['staffId', '_id', 'id']);
  const roleRaw = pickString(raw, ['role', 'staffRole', 'designation']) || 'kitchen';
  const isOwner = roleRaw.toLowerCase() === 'owner';
  return {
    staffId: isOwner ? null : staffIdRaw ?? null,
    userId: pickString(raw, ['userId']) ?? '',
    role: isOwner ? 'owner' : normalizeStaffRole(roleRaw),
    permissions,
    isActive: pickBool(raw, ['isActive', 'active']) !== false,
    lastSeenAt: pickString(raw, ['lastSeenAt']) ?? null,
    name: pickString(raw, ['name', 'fullName', 'displayName']) ?? null,
    phoneMasked:
      pickString(raw, ['phoneMasked', 'phone', 'mobile']) ?? null,
    emailMasked: pickString(raw, ['emailMasked', 'email']) ?? null,
    joinedAt: pickString(raw, ['joinedAt', 'createdAt']) ?? null,
  };
}

function resolveStaffInviteUrl(value?: string): string | undefined {
  const link = value?.trim();
  if (
    link &&
    /^https?:\/\//i.test(link) &&
    !/localhost|127\.0\.0\.1/i.test(link)
  ) {
    return link;
  }
  return undefined;
}

function mapStaffInvite(raw: Record<string, unknown>): StaffInvite {
  const permissions = Array.isArray(raw.permissions)
    ? (raw.permissions.filter(
        (item) => typeof item === 'string'
      ) as StaffPermission[])
    : [];
  return {
    inviteId: pickString(raw, ['inviteId', '_id', 'id']) ?? '',
    name: pickString(raw, ['name']) ?? 'Invite',
    phoneMasked: pickString(raw, ['phoneMasked', 'phone']) ?? null,
    emailMasked: pickString(raw, ['emailMasked', 'email']) ?? null,
    role: normalizeStaffRole(pickString(raw, ['role'])),
    permissions,
    status: String(raw.status ?? 'pending').toLowerCase(),
    expiresAt: pickString(raw, ['expiresAt']),
    inviteUrl: resolveStaffInviteUrl(
      pickString(raw, ['inviteUrl', 'inviteLink', 'url'])
    ),
    deliveredVia: Array.isArray(raw.deliveredVia)
      ? raw.deliveredVia.filter((item): item is string => typeof item === 'string')
      : undefined,
    createdAt: pickString(raw, ['createdAt']),
  };
}

function mapStaffRoster(payload: unknown): StaffRoster {
  const root = asRecord(payload);
  const data = asRecord(root.data ?? root);
  const membersRaw = Array.isArray(data.members)
    ? data.members
    : Array.isArray(root.members)
      ? root.members
      : [];
  const invitesRaw = Array.isArray(data.pendingInvites)
    ? data.pendingInvites
    : Array.isArray(root.pendingInvites)
      ? root.pendingInvites
      : [];
  return {
    members: (membersRaw as Record<string, unknown>[])
      .map(mapStaff)
      .filter((row) => row.userId || row.staffId || row.role === 'owner'),
    pendingInvites: (invitesRaw as Record<string, unknown>[])
      .map(mapStaffInvite)
      .filter((row) => Boolean(row.inviteId)),
  };
}

export function normalizeInvitePhone(value?: string): string | undefined {
  const digits = String(value ?? '').replace(/\D/g, '');
  const national =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  return national.length === 10 ? national : undefined;
}

function unwrapRestaurant(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  const data = asRecord(root.data ?? root);
  const nested =
    asRecord(data.restaurant) ||
    asRecord(root.restaurant) ||
    (pickString(data, ['_id', 'id']) ? data : {});
  return Object.keys(nested).length ? nested : data;
}

export const restaurantSettingsApi = {
  /** GET /health */
  health: async (): Promise<{ ok: boolean; message?: string }> => {
    try {
      const res = await request<Record<string, unknown>>(
        `${RESTAURANT_SERVICE}/health`
      );
      const data = asRecord(res.data ?? res);
      return {
        ok: Boolean(
          res.success ?? (data.status === 'ok' || data.ok !== false)
        ),
        message: pickString(data, ['message', 'status']),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Health check failed',
      };
    }
  },

  /** GET /restaurants/:restaurantId */
  getRestaurant: async (restaurantId: string): Promise<RestaurantDetail> => {
    const res = await request<Record<string, unknown>>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}`
    );
    const mapped = mapRestaurantDetail(unwrapRestaurant(res));
    if (!mapped.id) {
      throw new Error('Restaurant not found');
    }
    return mapped;
  },

  /** PUT /restaurants/:restaurantId — only sends fields present on the payload. */
  updateRestaurant: async (
    restaurantId: string,
    payload: UpdateRestaurantPayload
  ): Promise<RestaurantDetail> => {
    const body: Record<string, unknown> = {};

    if (payload.name !== undefined) body.name = payload.name.trim();
    if (payload.description !== undefined) {
      body.description = payload.description.trim();
    }
    if (payload.fssaiLicense !== undefined) {
      body.fssaiLicense = payload.fssaiLicense.trim();
    }
    if (payload.gstin !== undefined) {
      body.gstin = payload.gstin.trim();
    }
    if (payload.phone !== undefined) body.phone = payload.phone.trim();
    if (payload.priceRange !== undefined) body.priceRange = payload.priceRange;
    if (payload.costForTwo !== undefined) body.costForTwo = payload.costForTwo;
    if (payload.cuisines !== undefined) body.cuisines = payload.cuisines;

    if (payload.address !== undefined) {
      body.address = {
        street: payload.address.street?.trim() ?? '',
        area: payload.address.area?.trim() || undefined,
        city: payload.address.city?.trim() ?? '',
        state: payload.address.state?.trim() ?? '',
        country: payload.address.country?.trim() || 'India',
        pincode: payload.address.pincode?.trim() ?? '',
      };
    }

    const point = toGeoJsonPoint(payload.location);
    if (point) {
      // Exact GeoJSON Point shape required by MongoDB 2dsphere indexes.
      body.location = {
        type: 'Point',
        coordinates: [point.coordinates[0], point.coordinates[1]],
      };
    }

    if (Object.keys(body).length === 0) {
      throw new Error('No changes to save.');
    }

    return withGeoRepair(restaurantId, () =>
      putRestaurantBody(restaurantId, body)
    );
  },

  /** DELETE /restaurants/:restaurantId (admin) */
  deleteRestaurant: async (restaurantId: string): Promise<void> => {
    await request<unknown>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}`,
      { method: 'DELETE' }
    );
  },

  /** PUT /restaurants/:restaurantId/status */
  updateStatus: async (
    restaurantId: string,
    payload: UpdateRestaurantStatusPayload
  ): Promise<RestaurantDetail> => {
    const isOnline = Boolean(
      payload.isOnline ?? payload.isOpen ?? payload.isActive
    );
    // Backend expects a lean status payload — extra keys get rejected.
    const body = {
      status: isOnline ? 'online' : 'offline',
    };

    return withGeoRepair(restaurantId, async () => {
      const res = await request<Record<string, unknown>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/status`,
        { method: 'PUT', body }
      );
      const mapped = mapRestaurantDetail(unwrapRestaurant(res));
      if (!mapped.id) {
        const fresh = await restaurantSettingsApi.getRestaurant(restaurantId);
        return {
          ...fresh,
          isOnline,
          isOpen: isOnline,
          isActive: isOnline,
        };
      }
      return {
        ...mapped,
        isOnline: mapped.isOnline ?? isOnline,
        isOpen: mapped.isOpen ?? isOnline,
        isActive: mapped.isActive ?? isOnline,
      };
    });
  },

  /** PUT /restaurants/:restaurantId/timings */
  updateTimings: async (
    restaurantId: string,
    payload: UpdateTimingsPayload
  ): Promise<RestaurantDetail> => {
    // Live API shape (from GET detail):
    // { monday: { isOpen: boolean, slots: [{ open: "HH:mm", close: "HH:mm" }] }, ... }
    const timings: Record<string, { isOpen: boolean; slots: TimeSlot[] }> = {};
    (Object.keys(payload.timings) as DayKey[]).forEach((day) => {
      const dayTiming = payload.timings[day];
      const slots = dayTiming.isOpen
        ? dayTiming.slots
            .slice(0, 3)
            .map((slot) => ({
              open: normalizeTime(slot.open, '09:00'),
              close: normalizeTime(slot.close, '22:00'),
            }))
        : [];
      timings[day] = {
        isOpen: Boolean(dayTiming.isOpen),
        slots,
      };
    });

    return withGeoRepair(restaurantId, async () => {
      const res = await request<Record<string, unknown>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/timings`,
        {
          method: 'PUT',
          body: timings,
        }
      );
      const mapped = mapRestaurantDetail(unwrapRestaurant(res));
      if (!mapped.id) {
        return restaurantSettingsApi.getRestaurant(restaurantId);
      }
      // Some PUT responses omit timings — keep what we just saved.
      if (!mapped.timings || !Object.keys(asRecord(mapped.timings)).length) {
        mapped.timings = mapTimings(timings);
      }
      return mapped;
    });
  },

  /** PUT /restaurants/:restaurantId/settings */
  updateSettings: async (
    restaurantId: string,
    payload: UpdateSettingsPayload
  ): Promise<RestaurantDetail> => {
    const body = toApiSettingsBody(payload);
    if (Object.keys(body).length === 0) {
      throw new Error('No settings changes to save.');
    }

    return withGeoRepair(restaurantId, async () => {
      const res = await request<Record<string, unknown>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/settings`,
        { method: 'PUT', body }
      );
      const mapped = mapRestaurantDetail(unwrapRestaurant(res));
      if (!mapped.id) {
        return restaurantSettingsApi.getRestaurant(restaurantId);
      }
      // Re-merge saved settings in case response is lean
      return {
        ...mapped,
        settings: {
          ...mapped.settings,
          ...payload,
        },
      };
    });
  },

  /** POST /restaurants/:restaurantId/logo — multer field `photo`. */
  uploadLogo: async (
    restaurantId: string,
    file: { uri: string; fileName: string; mimeType: string }
  ) => {
    const data = await postMultipartFile(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/logo`,
      'photo',
      {
        uri: file.uri,
        name: file.fileName || 'logo.jpg',
        type: file.mimeType || 'image/jpeg',
      }
    );
    const mapped = await detailFromUpload(restaurantId, data);
    return mapped.logoUrl
      ? mapped
      : restaurantSettingsApi.getRestaurant(restaurantId);
  },

  /** POST /restaurants/:restaurantId/cover — multer field `photo`, max 5 MB. */
  uploadCover: async (
    restaurantId: string,
    file: { uri: string; fileName: string; mimeType: string }
  ) => {
    const data = await postMultipartFile(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/cover`,
      'photo',
      {
        uri: file.uri,
        name: file.fileName || 'cover.jpg',
        type: file.mimeType || 'image/jpeg',
      }
    );
    const mapped = await detailFromUpload(restaurantId, data);
    return mapped.coverUrl
      ? mapped
      : restaurantSettingsApi.getRestaurant(restaurantId);
  },

  /** POST /restaurants/:restaurantId/images — multer field `photos` (max 10). */
  uploadGalleryImages: async (
    restaurantId: string,
    files: { uri: string; fileName: string; mimeType: string }[]
  ): Promise<RestaurantDetail> => {
    if (!files.length) {
      throw new Error('Pick at least one photo to upload.');
    }
    if (files.length > 10) {
      throw new Error('You can add up to 10 photos at once.');
    }
    const data = await postMultipartFiles(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/images`,
      'photos',
      files.map((file, index) => ({
        uri: file.uri,
        name: file.fileName || `gallery-${index + 1}.jpg`,
        type: file.mimeType || 'image/jpeg',
      }))
    );
    const mapped = await detailFromUpload(restaurantId, data);
    return mapped.images?.length
      ? mapped
      : restaurantSettingsApi.getRestaurant(restaurantId);
  },

  /**
   * DELETE /restaurants/:restaurantId/images/:imageId
   * Body `{ imageUrl }` is required (gallery is stored as URL strings).
   */
  deleteGalleryImage: async (
    restaurantId: string,
    image: { id?: string; url: string }
  ): Promise<RestaurantDetail> => {
    const imageUrl = image.url.trim();
    if (!imageUrl) {
      throw new Error('Photo URL is missing.');
    }
    const res = await request<Record<string, unknown>>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/images/${encodeURIComponent(
        image.id || galleryPathId(imageUrl)
      )}`,
      { method: 'DELETE', body: { imageUrl } }
    );
    const mapped = mapRestaurantDetail(unwrapRestaurant(res));
    if (!mapped.id) {
      return restaurantSettingsApi.getRestaurant(restaurantId);
    }
    return mapped;
  },

  /** GET /restaurants/:restaurantId/staff — members + pendingInvites */
  getStaff: async (restaurantId: string): Promise<StaffRoster> => {
    const res = await request<unknown>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/staff`
    );
    return mapStaffRoster(res.data ?? res);
  },

  /** POST /restaurants/:restaurantId/staff/invite */
  inviteStaff: async (
    restaurantId: string,
    payload: InviteStaffPayload
  ): Promise<StaffInvite> => {
    const name = payload.name.trim();
    const phone = payload.phone
      ? normalizeInvitePhone(payload.phone)
      : undefined;
    const email = payload.email?.trim().toLowerCase() || undefined;
    if (!name) throw new Error('Enter the teammate’s name.');
    if (!phone && !email) {
      throw new Error('Enter a 10-digit mobile number or an email.');
    }
    if (payload.phone && !phone) {
      throw new Error('Enter a valid 10-digit mobile number.');
    }
    const role = normalizeStaffRole(payload.role);
    const res = await request<Record<string, unknown>>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/staff/invite`,
      {
        method: 'POST',
        body: {
          name,
          role,
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          ...(payload.permissions?.length
            ? { permissions: payload.permissions }
            : {}),
        },
      }
    );
    const mapped = mapStaffInvite(asRecord(res.data ?? res));
    if (!mapped.inviteId) {
      throw new Error('Invitation was not saved. Try again.');
    }
    return mapped;
  },

  /** POST /restaurants/:restaurantId/staff/accept { token } */
  acceptStaffInvite: async (
    restaurantId: string,
    token: string
  ): Promise<RestaurantStaffMember> => {
    const trimmed = token.trim();
    if (trimmed.length < 16) {
      throw new Error('This invite link is missing a valid token.');
    }
    const res = await request<Record<string, unknown>>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/staff/accept`,
      { method: 'POST', body: { token: trimmed } }
    );
    return mapStaff(asRecord(res.data ?? res));
  },

  /** POST /restaurants/:restaurantId/staff — direct-add by userId */
  addStaff: async (
    restaurantId: string,
    payload: AddStaffPayload
  ): Promise<RestaurantStaffMember> => {
    const userId = payload.userId.trim();
    if (!/^[a-f\d]{24}$/i.test(userId)) {
      throw new Error(
        'Direct-add needs the teammate’s user id. Prefer Invite by phone or email.'
      );
    }
    const role = normalizeStaffRole(payload.role);
    const permissions =
      payload.permissions?.length
        ? payload.permissions
        : DEFAULT_STAFF_PERMISSIONS[role];
    const res = await request<Record<string, unknown>>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/staff`,
      {
        method: 'POST',
        body: {
          userId,
          role,
          permissions,
          ...(payload.name?.trim() ? { name: payload.name.trim() } : {}),
          ...(payload.phone ? { phone: payload.phone } : {}),
          ...(payload.email?.trim()
            ? { email: payload.email.trim().toLowerCase() }
            : {}),
        },
      }
    );
    return mapStaff(asRecord(res.data ?? res));
  },

  /** PUT /restaurants/:restaurantId/staff/:staffId */
  updateStaff: async (
    restaurantId: string,
    staffId: string,
    payload: UpdateStaffPayload
  ): Promise<RestaurantStaffMember> => {
    const body: Record<string, unknown> = {};
    if (payload.role !== undefined) body.role = normalizeStaffRole(payload.role);
    if (payload.permissions !== undefined) body.permissions = payload.permissions;
    if (payload.isActive !== undefined) body.isActive = payload.isActive;
    if (!Object.keys(body).length) {
      throw new Error('Nothing to update.');
    }
    const res = await request<Record<string, unknown>>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/staff/${encodeURIComponent(staffId)}`,
      { method: 'PUT', body }
    );
    return mapStaff(asRecord(res.data ?? res));
  },

  /** DELETE /restaurants/:restaurantId/staff/:staffId — soft-deactivate */
  removeStaff: async (
    restaurantId: string,
    staffId: string
  ): Promise<void> => {
    await request<unknown>(
      `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/staff/${encodeURIComponent(staffId)}`,
      { method: 'DELETE' }
    );
  },
};

/** Merge detail fields onto the lightweight owner restaurant cache shape. */
export function toOwnerRestaurant(
  detail: RestaurantDetail
): RestaurantOwnerRestaurant {
  return {
    ...detail,
    id: detail.id,
    name: detail.name,
    description: detail.description,
    logoUrl: detail.logoUrl,
    coverUrl: detail.coverUrl,
    status: detail.status,
  };
}
