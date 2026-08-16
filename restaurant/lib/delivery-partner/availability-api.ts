import axios from 'axios';

import { api, assertApiBaseUrl } from '@/lib/api';
import { getApiErrorCode, getApiErrorMessage, PartnerApiError } from '@/lib/errors';
import type { DeliveryPartnerProfile } from '@/lib/delivery-partner/types';
import { canFallbackToRest } from '@/lib/delivery-partner/rider-ack';
import { emitRiderEvent, isRiderSocketConnected } from '@/lib/delivery-partner/rider-gateway';
import {
  DEFAULT_BREAK_MINUTES,
  MAX_BREAK_MINUTES,
  normalizeDutyStatus,
  type AttendanceDay,
  type AttendanceLog,
  type AttendanceStreak,
  type CreateAdminShiftPayload,
  type DutyPartnerSnapshot,
  type GoOnlinePayload,
  type GoOnlineResult,
  type PartnerBreakInfo,
  type PartnerDutyStatusSnapshot,
  type PartnerShiftSlot,
  type ShiftBookingResult,
  type ShiftCancelResult,
  type StartBreakPayload,
} from '@/lib/delivery-partner/availability-types';

const ME_BASE = '/api/v1/delivery-service/partners/me';
const ADMIN_SHIFTS = '/api/v1/delivery-service/admin/shifts';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  code?: string;
};

export { PartnerApiError };

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
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return undefined;
}

function unwrap(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!Object.keys(record).length) return payload;
  if ('data' in record) return record.data;
  return payload;
}

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  const nested =
    record.shifts ??
    record.slots ??
    record.items ??
    record.results ??
    record.docs ??
    record.list ??
    record.data;
  if (Array.isArray(nested)) return nested;
  if (nested && typeof nested === 'object') return extractList(nested);
  return [];
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
  assertApiBaseUrl();
  try {
    const response = await api.request<Envelope<T> | T>({
      url: path,
      method,
      data: method === 'GET' || method === 'DELETE' ? undefined : (body ?? {}),
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
      throw new PartnerApiError(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    throw new PartnerApiError(
      getApiErrorMessage(error, 'Request failed'),
      getApiErrorCode(error)
    );
  }
}

function mapBreak(raw: unknown): PartnerBreakInfo {
  const record = asRecord(raw);
  return {
    active: pickBool(record, ['active', 'isActive', 'onBreak']) ?? false,
    startedAt: pickString(record, ['startedAt', 'startAt']) ?? null,
    elapsedMinutes: pickNumber(record, ['elapsedMinutes', 'elapsed']) ?? 0,
    minutesUsedToday: pickNumber(record, ['minutesUsedToday', 'usedToday']) ?? 0,
    minutesRemainingToday:
      pickNumber(record, ['minutesRemainingToday', 'remainingToday']) ?? 0,
    maxMinutesPerDay: pickNumber(record, ['maxMinutesPerDay']) ?? 60,
    maxSingleMinutes: pickNumber(record, ['maxSingleMinutes']) ?? MAX_BREAK_MINUTES,
    defaultMinutes: pickNumber(record, ['defaultMinutes']) ?? DEFAULT_BREAK_MINUTES,
  };
}

function inferDutyStatus(
  record: Record<string, unknown>,
  brk: PartnerBreakInfo
): PartnerDutyStatusSnapshot['dutyStatus'] {
  const explicit = normalizeDutyStatus(
    pickString(record, ['dutyStatus', 'status', 'duty', 'availabilityStatus'])
  );
  if (explicit) return explicit;
  if (brk.active) return 'on_break';
  if (pickString(record, ['activeDeliveryId', 'activeDelivery'])) {
    return 'on_delivery';
  }
  const online = pickBool(record, ['isOnline', 'online']);
  if (online === false) return 'offline';
  if (online === true) return 'online';
  return 'offline';
}

export function mapDutyStatus(raw: unknown): PartnerDutyStatusSnapshot {
  const record = asRecord(unwrap(raw));
  const nested = asRecord(record.status ?? record);
  const source = Object.keys(nested).length ? nested : record;
  const brk = mapBreak(source.break ?? source.breakInfo ?? record.break);
  const dutyStatus = inferDutyStatus(source, brk);
  const isOnline =
    pickBool(source, ['isOnline', 'online']) ??
    (dutyStatus !== 'offline');
  const isAvailable =
    pickBool(source, ['isAvailable', 'available']) ??
    (dutyStatus === 'online');

  return {
    dutyStatus,
    isOnline,
    isAvailable,
    accountStatus: pickString(source, ['accountStatus', 'status']),
    onlineSince: pickString(source, ['onlineSince']) ?? null,
    lastOfflineAt: pickString(source, ['lastOfflineAt']) ?? null,
    zoneId: pickString(source, ['zoneId', 'hubId']) ?? null,
    activeDeliveryId:
      pickString(source, ['activeDeliveryId', 'activeDelivery', 'deliveryId']) ??
      null,
    break: brk,
  };
}

function mapDutyPartner(raw: unknown): DutyPartnerSnapshot {
  const record = asRecord(unwrap(raw));
  const source = asRecord(record.partner ?? record);
  return {
    id: pickString(source, ['_id', 'id', 'partnerId']) ?? '',
    partnerCode: pickString(source, ['partnerCode', 'code']),
    status: pickString(source, ['status', 'accountStatus']),
    dutyStatus: normalizeDutyStatus(pickString(source, ['dutyStatus'])),
    isOnline: pickBool(source, ['isOnline', 'online']),
    isAvailable: pickBool(source, ['isAvailable', 'available']),
  };
}

function mapGoOnlineResult(raw: unknown): GoOnlineResult {
  const record = asRecord(unwrap(raw));
  const partnerRaw = record.partner ?? record;
  const statusRaw = record.status ?? record;
  return {
    partner: mapDutyPartner(partnerRaw),
    status: mapDutyStatus(statusRaw),
  };
}

function mapShift(raw: unknown): PartnerShiftSlot | null {
  const record = asRecord(raw);
  const id = pickString(record, ['id', '_id', 'shiftId']);
  if (!id) return null;
  const capacity = pickNumber(record, ['capacity']) ?? 0;
  const bookedCount = pickNumber(record, ['bookedCount', 'booked']) ?? 0;
  const spotsLeft =
    pickNumber(record, ['spotsLeft', 'availableSpots']) ??
    Math.max(0, capacity - bookedCount);

  return {
    id,
    zoneId: pickString(record, ['zoneId', 'hubId']),
    date: pickString(record, ['date']) ?? '',
    label: pickString(record, ['label', 'name', 'slot']) ?? 'shift',
    startAt: pickString(record, ['startAt', 'start', 'startsAt']),
    endAt: pickString(record, ['endAt', 'end', 'endsAt']),
    capacity,
    bookedCount,
    spotsLeft,
    guaranteedHours: pickNumber(record, ['guaranteedHours']),
    incentiveAmount: pickNumber(record, ['incentiveAmount', 'incentive']),
    status: (pickString(record, ['status']) ?? 'open').toLowerCase(),
    bookedByMe: pickBool(record, ['bookedByMe', 'isBooked']) ?? false,
    canBook: pickBool(record, ['canBook']) ?? false,
    canCancel: pickBool(record, ['canCancel']) ?? false,
  };
}

function mapAttendanceDay(raw: unknown): AttendanceDay | null {
  const record = asRecord(raw);
  const date = pickString(record, ['date']);
  if (!date) return null;
  return {
    date,
    loginAt: pickString(record, ['loginAt', 'onlineAt']) ?? null,
    logoutAt: pickString(record, ['logoutAt', 'offlineAt']) ?? null,
    onlineMinutes: pickNumber(record, ['onlineMinutes', 'dutyMinutes']) ?? 0,
    breakMinutes: pickNumber(record, ['breakMinutes']) ?? 0,
    stillOnDuty: pickBool(record, ['stillOnDuty', 'onDuty']) ?? false,
  };
}

function mapAttendance(raw: unknown): AttendanceLog {
  const record = asRecord(unwrap(raw));
  const daysRaw = Array.isArray(record.days) ? record.days : extractList(record);
  const days = daysRaw
    .map(mapAttendanceDay)
    .filter((d): d is AttendanceDay => Boolean(d));
  const totalsRecord = asRecord(record.totals);
  return {
    from: pickString(record, ['from']) ?? '',
    to: pickString(record, ['to']) ?? '',
    days,
    totals: {
      onlineMinutes:
        pickNumber(totalsRecord, ['onlineMinutes']) ??
        days.reduce((sum, d) => sum + d.onlineMinutes, 0),
      breakMinutes:
        pickNumber(totalsRecord, ['breakMinutes']) ??
        days.reduce((sum, d) => sum + d.breakMinutes, 0),
      daysWorked:
        pickNumber(totalsRecord, ['daysWorked']) ??
        days.filter((d) => d.onlineMinutes > 0 || d.stillOnDuty).length,
    },
  };
}

function mapStreak(raw: unknown): AttendanceStreak {
  const record = asRecord(unwrap(raw));
  return {
    currentStreak: pickNumber(record, ['currentStreak', 'streak']) ?? 0,
    todayCounted: pickBool(record, ['todayCounted']) ?? false,
    lastWorkedDate: pickString(record, ['lastWorkedDate']) ?? null,
  };
}

export function applyDutyStatusToProfile(
  profile: DeliveryPartnerProfile | null | undefined,
  status?: PartnerDutyStatusSnapshot | null,
  partner?: DutyPartnerSnapshot | null
): DeliveryPartnerProfile {
  const base: DeliveryPartnerProfile = profile?.id
    ? { ...profile }
    : {
        id: partner?.id ?? '',
        status: partner?.status,
      };

  if (partner?.status) base.status = partner.status;
  if (partner?.dutyStatus) base.dutyStatus = partner.dutyStatus;
  if (typeof partner?.isOnline === 'boolean') base.isOnline = partner.isOnline;
  if (typeof partner?.isAvailable === 'boolean') {
    base.isAvailable = partner.isAvailable;
  }

  if (status) {
    base.dutyStatus = status.dutyStatus;
    base.isOnline = status.isOnline;
    base.isAvailable = status.isAvailable;
    if (status.accountStatus) base.status = status.accountStatus;
    if (status.zoneId) base.zoneId = status.zoneId;
    if (status.onlineSince) base.onlineSince = status.onlineSince;
  }

  return base;
}

export const DUTY_ERROR_COPY: Record<string, string> = {
  PARTNER_NOT_ACTIVE:
    'Only active partners can go online. Finish KYC and wait for account activation.',
  ACTIVE_DELIVERY: 'Complete your active delivery before changing duty status.',
  PARTNER_OFFLINE: 'Go online before starting a break.',
  ALREADY_ON_BREAK: 'You are already on a break.',
  BREAK_TOO_EARLY: 'Wait a little longer before starting another break.',
  BREAK_LIMIT_EXCEEDED: 'You have used today’s break allowance.',
  NOT_ON_BREAK: 'You are not on a break.',
  ZONE_REQUIRED: 'Go online once so your hub/zone is set, then book shifts.',
  SHIFT_NOT_FOUND: 'This shift is no longer available.',
  SHIFT_FULL: 'This shift is full.',
  SHIFT_OVERLAP: 'This shift overlaps another shift you already booked.',
  SHIFT_ALREADY_STARTED: 'This shift has already started.',
  SHIFT_CLOSED: 'This shift is closed.',
  BOOKING_NOT_FOUND: 'No booking found for this shift.',
  SHIFT_CANCEL_WINDOW_CLOSED:
    'You can cancel only until 2 hours before the shift starts.',
};

export function formatDutyError(error: unknown, fallback: string): string {
  const code =
    error instanceof PartnerApiError
      ? error.code
      : getApiErrorCode(error);
  if (code && DUTY_ERROR_COPY[code]) return DUTY_ERROR_COPY[code];
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback;
  return message || fallback;
}

export const partnerAvailabilityApi = {
  /** PUT /partners/me/go-online — socket `partner:online` when live. */
  goOnline: async (payload: GoOnlinePayload): Promise<GoOnlineResult> => {
    const body: Record<string, unknown> = {
      latitude: payload.latitude,
      longitude: payload.longitude,
      lat: payload.latitude,
      lng: payload.longitude,
    };
    if (payload.zoneId?.trim()) body.zoneId = payload.zoneId.trim();

    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('partner:online', body);
        return mapGoOnlineResult(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }

    const res = await request<unknown>(`${ME_BASE}/go-online`, {
      method: 'PUT',
      body,
    });
    return mapGoOnlineResult(res.data ?? res);
  },

  /** PUT /partners/me/go-offline — socket `partner:offline` when live. */
  goOffline: async (): Promise<GoOnlineResult> => {
    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('partner:offline', {});
        return mapGoOnlineResult(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }

    const res = await request<unknown>(`${ME_BASE}/go-offline`, {
      method: 'PUT',
      body: {},
    });
    return mapGoOnlineResult(res.data ?? res);
  },

  /** GET /partners/me/status */
  getStatus: async (): Promise<PartnerDutyStatusSnapshot> => {
    const res = await request<unknown>(`${ME_BASE}/status`);
    return mapDutyStatus(res.data ?? res);
  },

  /** PUT /partners/me/break/start */
  startBreak: async (
    payload: StartBreakPayload = {}
  ): Promise<PartnerDutyStatusSnapshot> => {
    const duration = Math.min(
      MAX_BREAK_MINUTES,
      Math.max(1, Math.round(payload.durationMinutes ?? DEFAULT_BREAK_MINUTES))
    );
    const res = await request<unknown>(`${ME_BASE}/break/start`, {
      method: 'PUT',
      body: { durationMinutes: duration },
    });
    return mapDutyStatus(res.data ?? res);
  },

  /** PUT /partners/me/break/end */
  endBreak: async (): Promise<PartnerDutyStatusSnapshot> => {
    const res = await request<unknown>(`${ME_BASE}/break/end`, {
      method: 'PUT',
      body: {},
    });
    return mapDutyStatus(res.data ?? res);
  },

  /** GET /partners/me/shifts */
  getShifts: async (range?: {
    from?: string;
    to?: string;
  }): Promise<PartnerShiftSlot[]> => {
    const res = await request<unknown>(`${ME_BASE}/shifts`, {
      params: {
        from: range?.from,
        to: range?.to,
      },
    });
    return extractList(res.data ?? res)
      .map(mapShift)
      .filter((s): s is PartnerShiftSlot => Boolean(s));
  },

  /** POST /partners/me/shifts/:shiftId/book */
  bookShift: async (shiftId: string): Promise<ShiftBookingResult> => {
    const id = shiftId.trim();
    if (!id) throw new PartnerApiError('Shift id is required.');
    const res = await request<unknown>(`${ME_BASE}/shifts/${id}/book`, {
      method: 'POST',
      body: {},
    });
    const record = asRecord(unwrap(res.data ?? res));
    const shiftRecord = asRecord(record.shift ?? record);
    const mapped = mapShift(shiftRecord);
    return {
      bookingId: pickString(record, ['bookingId', '_id', 'id']),
      shift: mapped ?? {
        id: pickString(shiftRecord, ['id', '_id', 'shiftId']) ?? id,
        bookedByMe: true,
        canBook: false,
        canCancel: true,
      },
    };
  },

  /** DELETE /partners/me/shifts/:shiftId */
  cancelShift: async (shiftId: string): Promise<ShiftCancelResult> => {
    const id = shiftId.trim();
    if (!id) throw new PartnerApiError('Shift id is required.');
    const res = await request<unknown>(`${ME_BASE}/shifts/${id}`, {
      method: 'DELETE',
    });
    const record = asRecord(unwrap(res.data ?? res));
    return {
      id: pickString(record, ['_id', 'id', 'bookingId']),
      shiftId: pickString(record, ['shiftId']) ?? id,
      partnerId: pickString(record, ['partnerId']),
      status: pickString(record, ['status']) ?? 'cancelled',
      cancelledAt: pickString(record, ['cancelledAt']),
      cancelReason: pickString(record, ['cancelReason', 'reason']),
    };
  },

  /** GET /partners/me/attendance */
  getAttendance: async (range?: {
    from?: string;
    to?: string;
  }): Promise<AttendanceLog> => {
    const res = await request<unknown>(`${ME_BASE}/attendance`, {
      params: {
        from: range?.from,
        to: range?.to,
      },
    });
    return mapAttendance(res.data ?? res);
  },

  /** GET /partners/me/attendance/streak */
  getAttendanceStreak: async (): Promise<AttendanceStreak> => {
    const res = await request<unknown>(`${ME_BASE}/attendance/streak`);
    return mapStreak(res.data ?? res);
  },

  /** POST /admin/shifts (admin role) */
  createAdminShift: async (
    payload: CreateAdminShiftPayload
  ): Promise<PartnerShiftSlot> => {
    const res = await request<unknown>(ADMIN_SHIFTS, {
      method: 'POST',
      body: payload,
    });
    const mapped = mapShift(unwrap(res.data ?? res));
    if (!mapped) {
      throw new PartnerApiError('Shift was created but could not be read back.');
    }
    return mapped;
  },
};
