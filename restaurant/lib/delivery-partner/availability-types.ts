/**
 * Availability & shift management — GET/PUT /partners/me/*
 * Gateway: /api/v1/delivery-service
 */

export type PartnerDutyStatus =
  | 'offline'
  | 'online'
  | 'on_delivery'
  | 'on_break'
  | 'on_way_to_hub';

export type PartnerBreakInfo = {
  active: boolean;
  startedAt?: string | null;
  expiresAt?: string | null;
  elapsedMinutes: number;
  minutesUsedToday: number;
  minutesRemainingToday: number;
  maxMinutesPerDay: number;
  maxSingleMinutes: number;
  defaultMinutes: number;
};

export type PartnerHubCheckin = {
  hubId?: string | null;
  checkedInAt?: string | null;
};

export type PartnerDutyStatusSnapshot = {
  dutyStatus: PartnerDutyStatus;
  isOnline: boolean;
  isAvailable: boolean;
  accountStatus?: string;
  onlineSince?: string | null;
  lastOfflineAt?: string | null;
  zoneId?: string | null;
  activeDeliveryId?: string | null;
  break: PartnerBreakInfo;
  hub: PartnerHubCheckin;
};

export type DutyPartnerSnapshot = {
  id: string;
  partnerCode?: string;
  status?: string;
  dutyStatus?: PartnerDutyStatus;
  isOnline?: boolean;
  isAvailable?: boolean;
};

export type GoOnlinePayload = {
  latitude: number;
  longitude: number;
  zoneId?: string;
};

export type GoOnlineResult = {
  partner: DutyPartnerSnapshot;
  status: PartnerDutyStatusSnapshot;
};

export type StartBreakPayload = {
  durationMinutes?: number;
};

export type ExtendBreakPayload = {
  additionalMinutes?: number;
};

export type PartnerBreakPolicy = {
  maxMinutesPerDay: number;
  maxSingleMinutes: number;
  defaultMinutes: number;
  extendDefaultMinutes: number;
  minOnlineMinutesBefore: number;
  timezone: string;
};

export type NearbyHubKind = 'hub' | 'dark_store' | 'cash_drop' | string;

export type NearbyHub = {
  hubId: string;
  name: string;
  city?: string;
  kind: NearbyHubKind;
  address?: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  distanceMeters: number;
  isActive: boolean;
};

export type HubCheckinResult = {
  hub?: NearbyHub | null;
  status: PartnerDutyStatusSnapshot;
};

export type SetDutyStatusPayload = {
  dutyStatus: Exclude<PartnerDutyStatus, 'on_delivery'>;
  latitude?: number;
  longitude?: number;
  durationMinutes?: number;
};

/** GET /partners/me/duty-summary — IST calendar day. */
export type PartnerDutySummary = {
  date: string;
  dutyStatus?: PartnerDutyStatus;
  onlineMinutes: number;
  onlineHours: number;
  deliveries: number;
  km: number;
  breakMinutes: number;
  stillOnDuty: boolean;
};

export type ShiftSlotStatus = 'open' | 'full' | 'closed' | 'cancelled' | string;

export type PartnerShiftSlot = {
  id: string;
  zoneId?: string;
  date: string;
  label: string;
  startAt?: string;
  endAt?: string;
  capacity: number;
  bookedCount: number;
  spotsLeft: number;
  guaranteedHours?: number;
  incentiveAmount?: number;
  status: ShiftSlotStatus;
  bookedByMe: boolean;
  canBook: boolean;
  canCancel: boolean;
};

export type ShiftBookingResult = {
  bookingId?: string;
  shift: Partial<PartnerShiftSlot> & { id: string };
};

export type ShiftCancelResult = {
  id?: string;
  shiftId: string;
  partnerId?: string;
  status: string;
  cancelledAt?: string;
  cancelReason?: string;
};

export type AttendanceDay = {
  date: string;
  loginAt?: string | null;
  logoutAt?: string | null;
  onlineMinutes: number;
  breakMinutes: number;
  stillOnDuty: boolean;
};

export type AttendanceLog = {
  from: string;
  to: string;
  days: AttendanceDay[];
  totals: {
    onlineMinutes: number;
    breakMinutes: number;
    daysWorked: number;
  };
};

export type AttendanceStreak = {
  currentStreak: number;
  todayCounted: boolean;
  lastWorkedDate?: string | null;
};

export function attendanceDayWorked(day: AttendanceDay): boolean {
  return (
    day.onlineMinutes > 0 ||
    day.stillOnDuty ||
    Boolean(day.loginAt)
  );
}

/** Consecutive IST login/work days. Yesterday still counts until today is missed. */
export function computeLoginStreak(
  days: AttendanceDay[],
  today = istDateString()
): AttendanceStreak {
  const worked = new Set<string>();
  let last: string | null = null;
  for (const day of days) {
    if (!attendanceDayWorked(day)) continue;
    const key = day.date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    worked.add(key);
    if (!last || key > last) last = key;
  }

  const todayCounted = worked.has(today);
  const yesterday = addIstDays(today, -1);
  if (!todayCounted && !worked.has(yesterday)) {
    return { currentStreak: 0, todayCounted: false, lastWorkedDate: last };
  }

  let cursor = todayCounted ? today : yesterday;
  let streak = 0;
  while (worked.has(cursor)) {
    streak += 1;
    cursor = addIstDays(cursor, -1);
  }

  return { currentStreak: streak, todayCounted, lastWorkedDate: last };
}

/** Prefer live attendance streak; never hide a day you already worked. */
export function resolveDisplayStreak(
  attendance?: AttendanceStreak | null,
  performanceStreak?: number | null
): number {
  const today = istDateString();
  const yesterday = addIstDays(today, -1);
  const last = attendance?.lastWorkedDate?.slice(0, 10) ?? '';
  const fromDates =
    attendance?.todayCounted || last === today || last === yesterday ? 1 : 0;
  return Math.max(
    attendance?.currentStreak ?? 0,
    performanceStreak ?? 0,
    fromDates
  );
}

export const DEFAULT_BREAK_MINUTES = 15;
export const MAX_BREAK_MINUTES = 30;
export const MAX_BREAK_MINUTES_PER_DAY = 60;

export function normalizeDutyStatus(
  value?: string | null
): PartnerDutyStatus | undefined {
  if (!value) return undefined;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (
    key === 'on_delivery' ||
    key === 'ondelivery' ||
    key === 'busy' ||
    key === 'delivering'
  ) {
    return 'on_delivery';
  }
  if (key === 'on_break' || key === 'break' || key === 'onbreak') {
    return 'on_break';
  }
  if (
    key === 'on_way_to_hub' ||
    key === 'onwaytohub' ||
    key === 'heading_to_hub'
  ) {
    return 'on_way_to_hub';
  }
  if (key === 'online' || key === 'available' || key === 'active_duty') {
    return 'online';
  }
  if (key === 'offline' || key === 'unavailable') {
    return 'offline';
  }
  return undefined;
}

export function dutyStatusLabel(status?: PartnerDutyStatus | null): string {
  switch (status) {
    case 'online':
      return 'Online';
    case 'on_delivery':
      return 'On delivery';
    case 'on_break':
      return 'On break';
    case 'on_way_to_hub':
      return 'Heading to hub';
    case 'offline':
    default:
      return 'Offline';
  }
}

export function dutyStatusHint(status?: PartnerDutySnapshotLike | null): string {
  const duty = status?.dutyStatus;
  const brk = status?.break;
  if (duty === 'online') return 'Accepting deliveries';
  if (duty === 'on_delivery') return 'Finish your active trip first';
  if (duty === 'on_way_to_hub') return 'Head to the hub, then resume orders';
  if (duty === 'on_break') {
    const remaining =
      brk?.minutesRemainingToday ??
      Math.max(
        0,
        (brk?.maxSingleMinutes ?? MAX_BREAK_MINUTES) - (brk?.elapsedMinutes ?? 0)
      );
    const elapsed = brk?.elapsedMinutes ?? 0;
    if (brk?.active && elapsed > 0) {
      return `${elapsed}m used · ${remaining}m left today`;
    }
    return remaining > 0
      ? `${remaining}m break left today`
      : 'Daily break limit reached';
  }
  return 'Tap to go online';
}

type PartnerDutySnapshotLike = {
  dutyStatus?: PartnerDutyStatus | null;
  break?: PartnerBreakInfo | null;
  hub?: PartnerHubCheckin | null;
};

export function canAcceptOffers(status?: PartnerDutyStatus | null) {
  return status === 'online';
}

export function breakDurationOptions(
  info?: PartnerBreakInfo | null,
  policy?: PartnerBreakPolicy | null
): number[] {
  const remaining = Math.max(
    0,
    Math.floor(
      info?.minutesRemainingToday ?? policy?.maxMinutesPerDay ?? 60
    )
  );
  const maxSingle = Math.min(
    policy?.maxSingleMinutes ?? info?.maxSingleMinutes ?? MAX_BREAK_MINUTES,
    remaining
  );
  const def = Math.min(
    policy?.defaultMinutes ?? info?.defaultMinutes ?? DEFAULT_BREAK_MINUTES,
    maxSingle
  );
  const opts = new Set<number>();
  if (def > 0) opts.add(def);
  if (maxSingle > 0) opts.add(maxSingle);
  return [...opts].filter((n) => n > 0).sort((a, b) => a - b);
}

/** Minutes the rider can still add to the current break. */
export function breakExtendMinutes(
  info?: PartnerBreakInfo | null,
  policy?: PartnerBreakPolicy | null
): number {
  if (!info?.active) return 0;
  const remainingDay = Math.max(0, Math.floor(info.minutesRemainingToday ?? 0));
  const maxSingle =
    policy?.maxSingleMinutes ?? info.maxSingleMinutes ?? MAX_BREAK_MINUTES;
  const remainingSingle = Math.max(
    0,
    Math.floor(maxSingle - (info.elapsedMinutes ?? 0))
  );
  const cap = Math.min(remainingDay, remainingSingle);
  if (cap < 1) return 0;
  const def = policy?.extendDefaultMinutes ?? 10;
  return Math.min(def, cap);
}

export function breakSecondsLeft(info?: PartnerBreakInfo | null): number | null {
  if (!info?.active) return null;
  if (info.expiresAt) {
    const ms = Date.parse(info.expiresAt) - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, Math.ceil(ms / 1000));
  }
  const cap = info.maxSingleMinutes ?? MAX_BREAK_MINUTES;
  const elapsed = info.elapsedMinutes ?? 0;
  return Math.max(0, Math.round((cap - elapsed) * 60));
}

export function isDutySwitchOn(status?: PartnerDutyStatus | null, isOnline?: boolean) {
  if (status) return status !== 'offline';
  return Boolean(isOnline);
}

export function istDateString(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

export function addIstDays(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split('-').map((n) => Number(n));
  const utc = Date.UTC(y, (m || 1) - 1, d || 1);
  const next = new Date(utc + days * 86_400_000);
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(next.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatIstTime(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatIstDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function formatIstDayLabel(ymd: string): string {
  const date = new Date(`${ymd}T12:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return ymd;
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(date);
}

export function formatMinutes(mins?: number | null): string {
  const total = Math.max(0, Math.round(Number(mins) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatDutyKm(km?: number | null): string {
  const value = Number(km);
  if (!Number.isFinite(value) || value <= 0) return '0 km';
  return `${value.toFixed(value >= 10 ? 0 : 1)} km`;
}

export function formatMeters(meters?: number | null): string {
  const value = Number(meters);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1000) return `${Math.round(value)} m`;
  return `${(value / 1000).toFixed(1)} km`;
}

export function hubKindLabel(kind?: string | null): string {
  const key = (kind ?? 'hub').trim().toLowerCase();
  if (key === 'dark_store' || key === 'darkstore') return 'Dark store';
  if (key === 'cash_drop' || key === 'cashdrop') return 'Cash drop';
  return 'Hub';
}

export function capitalizeShiftLabel(label?: string): string {
  const raw = (label ?? '').trim();
  if (!raw) return 'Shift';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Rider can cancel a booked shift until this many hours before start. */
export const SHIFT_CANCEL_LEAD_HOURS = 2;

export function shiftCancelDeadlineMs(startAt?: string | null): number | null {
  if (!startAt) return null;
  const start = Date.parse(startAt);
  if (!Number.isFinite(start)) return null;
  return start - SHIFT_CANCEL_LEAD_HOURS * 3_600_000;
}

export function isShiftCancelWindowOpen(startAt?: string | null): boolean {
  const deadline = shiftCancelDeadlineMs(startAt);
  if (deadline == null) return false;
  return Date.now() < deadline;
}

/** Prefer the API `canCancel` flag; fall back to the 2h IST-absolute window. */
export function canCancelShiftBooking(slot: {
  bookedByMe?: boolean;
  canCancel?: boolean;
  startAt?: string | null;
}): boolean {
  if (!slot.bookedByMe) return false;
  if (slot.canCancel === true) return true;
  if (slot.canCancel === false && slot.startAt) {
    return isShiftCancelWindowOpen(slot.startAt);
  }
  return isShiftCancelWindowOpen(slot.startAt);
}

export function formatShiftCancelUntil(startAt?: string | null): string | null {
  const deadline = shiftCancelDeadlineMs(startAt);
  if (deadline == null) return null;
  return formatIstDateTime(new Date(deadline).toISOString());
}
