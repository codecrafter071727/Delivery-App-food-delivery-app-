import axios from 'axios';

import { api } from '@/lib/api';
import type {
  CreateInvitationPayload,
  DeliveryPartner,
  PartnerInvitation,
  UpdatePartnerStatusPayload,
} from '@/lib/partner/types';

/**
 * Fleet via restaurant-service proxy:
 *   /restaurants/:id/fleet/invitations
 *   /restaurants/:id/fleet/partners
 *   /restaurants/:id/fleet/available-partners
 */
const FLEET_BASE = '/api/v1/restaurant-service/restaurants';

function fleetPath(restaurantId: string, suffix: string) {
  return `${FLEET_BASE}/${encodeURIComponent(restaurantId)}/fleet${suffix}`;
}

function fleetInvitesPath(restaurantId: string, invitationId?: string) {
  const root = fleetPath(restaurantId, '/invitations');
  return invitationId ? `${root}/${encodeURIComponent(invitationId)}` : root;
}

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<Envelope<T>> {
  const { method = 'GET', body } = options;
  const isMutating = method !== 'GET';

  try {
    const response = await api.request<Envelope<T> | T>({
      url: path,
      method,
      data: isMutating ? (body ?? {}) : body,
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
        data?.message ||
        data?.error ||
        `Request failed (${error.response.status})`;
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
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const nested =
    record.partners ??
    record.invitations ??
    record.items ??
    record.results ??
    record.docs ??
    record.list ??
    record.data ??
    [];
  if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  if (nested && typeof nested === 'object') return extractList(nested);
  return [];
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

/**
 * Shareable invite URL from the API only. Never invent localhost / token URLs.
 */
export function resolveInviteLink(input: {
  inviteLink?: string;
  token?: string;
}): string | undefined {
  const link = input.inviteLink?.trim();
  if (
    link &&
    /^https?:\/\//i.test(link) &&
    !/localhost|127\.0\.0\.1/i.test(link)
  ) {
    return link;
  }
  return undefined;
}

function unwrapInvitationRecord(
  payload: unknown
): Record<string, unknown> {
  const root = asRecord(payload);
  const data = asRecord(root.data ?? root);
  const candidates = [
    data,
    asRecord(data.invitation),
    asRecord(data.invite),
    asRecord(data.result),
    asRecord(root.invitation),
    asRecord(root.invite),
    root,
  ];
  for (const candidate of candidates) {
    if (
      pickString(candidate, ['_id', 'id', 'invitationId', 'token', 'inviteToken']) ||
      pickString(candidate, [
        'inviteLink',
        'invitationLink',
        'registrationLink',
        'inviteUrl',
      ])
    ) {
      // Merge sibling link/token from data when nested invitation omits them
      return {
        ...asRecord(data),
        ...candidate,
        inviteLink:
          candidate.inviteLink ??
          data.inviteLink ??
          root.inviteLink ??
          candidate.link,
        token:
          candidate.token ??
          data.token ??
          root.token ??
          candidate.inviteToken,
      };
    }
  }
  return data;
}

export function mapPartner(raw: Record<string, unknown>): DeliveryPartner {
  const nested =
    asRecord(raw.partner) ||
    asRecord(raw.user) ||
    asRecord(raw.deliveryPartner) ||
    {};
  const source = { ...nested, ...raw };
  const id = pickString(source, [
    '_id',
    'id',
    'partnerId',
    'deliveryPartnerId',
    'userId',
  ]);

  const statusRaw = String(
    source.status ?? source.associationStatus ?? source.partnerStatus ?? ''
  )
    .trim()
    .toLowerCase();
  const isActive = pickBool(source, ['isActive', 'active', 'enabled']);
  const status =
    statusRaw ||
    (isActive === false ? 'inactive' : isActive === true ? 'active' : undefined);

  const location = asRecord(source.lastLocation ?? source.location ?? source.geo);
  const coords = Array.isArray(location.coordinates)
    ? (location.coordinates as number[])
    : null;

  return {
    id: id ?? '',
    name:
      pickString(source, [
        'name',
        'fullName',
        'partnerName',
        'displayName',
      ]) ||
      [pickString(source, ['firstName']), pickString(source, ['lastName'])]
        .filter(Boolean)
        .join(' ') ||
      'Delivery partner',
    phone: pickString(source, ['phone', 'mobile', 'phoneNumber', 'contact']),
    email: pickString(source, ['email']),
    status,
    isOnline: pickBool(source, ['isOnline', 'online']),
    isAvailable: pickBool(source, [
      'isAvailable',
      'available',
      'isFree',
      'free',
    ]),
    vehicleType: pickString(source, ['vehicleType', 'vehicle', 'bikeType']),
    vehicleNumber: pickString(source, [
      'vehicleNumber',
      'vehicleNo',
      'plateNumber',
    ]),
    rating: pickNumber(source, ['rating', 'avgRating', 'averageRating']),
    ratingCount: pickNumber(source, ['ratingCount', 'ratingsCount', 'reviewCount']),
    totalDeliveries: pickNumber(source, [
      'totalDeliveries',
      'deliveries',
      'completedDeliveries',
    ]),
    dutyStatus: pickString(source, ['dutyStatus', 'duty', 'availabilityStatus']),
    partnerCode: pickString(source, ['partnerCode', 'code', 'riderCode']),
    distanceKm: pickNumber(source, [
      'distanceKm',
      'distance',
      'distanceInKm',
    ]),
    etaMinutes: pickNumber(source, ['etaMinutes', 'eta', 'estimatedMinutes']),
    avatarUrl: pickString(source, [
      'profilePhoto',
      'avatarUrl',
      'photoUrl',
      'profileImage',
      'imageUrl',
    ]),
    lastLocation:
      location && (location.lat != null || location.lng != null || coords)
        ? {
            lat:
              pickNumber(location, ['lat', 'latitude']) ??
              (coords ? Number(coords[1]) : undefined),
            lng:
              pickNumber(location, ['lng', 'longitude', 'lon']) ??
              (coords ? Number(coords[0]) : undefined),
            updatedAt: pickString(location, ['updatedAt', 'timestamp']),
          }
        : undefined,
  };
}

export function mapInvitation(raw: Record<string, unknown>): PartnerInvitation {
  const source = unwrapInvitationRecord(raw);
  const partner = asRecord(source.partner ?? source.deliveryPartner);
  const status = String(source.status ?? raw.status ?? 'pending').toLowerCase();
  const inviteLinkRaw = pickString(source, [
    'inviteUrl',
    'inviteLink',
    'invitationLink',
    'registrationLink',
    'registrationUrl',
    'shareUrl',
    'shareLink',
    'link',
    'url',
  ]);
  const inviteLink =
    status === 'pending' ? resolveInviteLink({ inviteLink: inviteLinkRaw }) : undefined;

  return {
    id: pickString(source, ['invitationId', '_id', 'id']) ?? '',
    restaurantId: pickString(source, ['restaurantId', 'restaurant']),
    partnerId:
      pickString(source, ['partnerId', 'deliveryPartnerId']) ||
      pickString(partner, ['_id', 'id']),
    partnerName:
      pickString(source, ['name', 'partnerName', 'fullName']) ||
      pickString(partner, ['name', 'fullName']),
    partnerPhone:
      pickString(source, ['phone', 'partnerPhone', 'mobile', 'phoneNumber']) ||
      pickString(partner, ['phone', 'mobile', 'phoneNumber']),
    partnerEmail:
      pickString(source, ['email', 'partnerEmail']) ||
      pickString(partner, ['email']),
    status,
    message: pickString(source, ['message', 'note']),
    inviteLink,
    createdAt: pickString(source, ['createdAt', 'created_at', 'sentAt']),
    updatedAt: pickString(source, ['updatedAt', 'updated_at']),
    expiresAt: pickString(source, ['expiresAt', 'expiry', 'expires_at']),
  };
}

export const restaurantPartnerApi = {
  /** POST /restaurants/:id/fleet/invitations { name, phone, email? } */
  createInvitation: async (
    restaurantId: string,
    payload: CreateInvitationPayload
  ): Promise<PartnerInvitation> => {
    const name = payload.name?.trim() || undefined;
    const phone = normalizeInvitePhone(payload.phone);
    const email = payload.email?.trim() || undefined;

    if (!name || !phone) {
      throw new Error('Full name and a 10-digit phone are required.');
    }

    const res = await request<Record<string, unknown>>(
      fleetInvitesPath(restaurantId),
      {
        method: 'POST',
        body: {
          name,
          phone,
          ...(email ? { email } : {}),
        },
      }
    );
    const mapped = mapInvitation(unwrapInvitationRecord(res));
    if (!mapped.id) {
      throw new Error('Invitation was not saved. Try again.');
    }
    return mapped;
  },

  /** GET /restaurants/:id/fleet/invitations */
  getInvitations: async (
    restaurantId: string
  ): Promise<PartnerInvitation[]> => {
    const res = await request<unknown>(fleetInvitesPath(restaurantId));
    return extractList(res.data ?? res)
      .map(mapInvitation)
      .filter((row) => Boolean(row.id));
  },

  /** DELETE /restaurants/:id/fleet/invitations/:invitationId */
  cancelInvitation: async (
    restaurantId: string,
    invitationId: string
  ): Promise<PartnerInvitation> => {
    const res = await request<unknown>(fleetInvitesPath(restaurantId, invitationId), {
      method: 'DELETE',
    });
    const mapped = mapInvitation(unwrapInvitationRecord(res.data ?? res));
    return mapped.id
      ? mapped
      : { id: invitationId, status: 'cancelled' };
  },

  /** GET /restaurants/:id/fleet/partners */
  getPartners: async (restaurantId: string): Promise<DeliveryPartner[]> => {
    const res = await request<unknown>(fleetPath(restaurantId, '/partners'));
    return extractList(res.data ?? res)
      .map(mapPartner)
      .filter((row) => row.id);
  },

  /** GET /restaurants/:id/fleet/partners/:partnerId */
  getPartner: async (
    restaurantId: string,
    partnerId: string
  ): Promise<DeliveryPartner> => {
    const res = await request<Record<string, unknown>>(
      fleetPath(restaurantId, `/partners/${encodeURIComponent(partnerId)}`)
    );
    const mapped = mapPartner(asRecord(res.data ?? res));
    if (!mapped.id) {
      throw new Error('Rider not found in your fleet.');
    }
    return mapped;
  },

  /** PUT /restaurants/:id/fleet/partners/:partnerId/status { action, reason? } */
  updatePartnerStatus: async (
    restaurantId: string,
    partnerId: string,
    payload: UpdatePartnerStatusPayload
  ): Promise<DeliveryPartner> => {
    const action = payload.action;
    const reason = payload.reason?.trim();
    if (
      (action === 'suspend' || action === 'deactivate') &&
      (!reason || reason.length < 8)
    ) {
      throw new Error('Add a reason (at least 8 characters) to suspend or deactivate.');
    }
    const res = await request<Record<string, unknown>>(
      fleetPath(
        restaurantId,
        `/partners/${encodeURIComponent(partnerId)}/status`
      ),
      {
        method: 'PUT',
        body:
          action === 'activate'
            ? { action: 'activate' }
            : { action, reason },
      }
    );
    const mapped = mapPartner(asRecord(res.data ?? res));
    if (!mapped.id) {
      return {
        id: partnerId,
        name: 'Delivery partner',
        status:
          action === 'activate'
            ? 'active'
            : action === 'suspend'
              ? 'suspended'
              : 'deactivated',
      };
    }
    return mapped;
  },

  /** GET /restaurants/:id/fleet/available-partners ?lat=&lng=&radiusKm= */
  getAvailablePartners: async (
    restaurantId: string,
    pin?: { lat?: number; lng?: number; radiusKm?: number }
  ): Promise<DeliveryPartner[]> => {
    const params = new URLSearchParams();
    if (pin?.lat != null && Number.isFinite(pin.lat)) {
      params.set('lat', String(pin.lat));
    }
    if (pin?.lng != null && Number.isFinite(pin.lng)) {
      params.set('lng', String(pin.lng));
    }
    if (pin?.radiusKm != null) {
      params.set('radiusKm', String(Math.min(15, Math.max(1, pin.radiusKm))));
    }
    const query = params.toString();
    const res = await request<unknown>(
      `${fleetPath(restaurantId, '/available-partners')}${query ? `?${query}` : ''}`
    );
    return extractList(res.data ?? res)
      .map(mapPartner)
      .filter((row) => row.id);
  },
};
