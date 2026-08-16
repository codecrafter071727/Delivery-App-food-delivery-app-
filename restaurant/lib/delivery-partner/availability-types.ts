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
  info?: PartnerBreakInfo | null
): number[] {
  const remaining = Math.max(0, Math.floor(info?.minutesRemainingToday ?? 60));
  const maxSingle = Math.min(
    info?.maxSingleMinutes ?? MAX_BREAK_MINUTES,
    remaining
  );
  const def = Math.min(info?.defaultMinutes ?? DEFAULT_BREAK_MINUTES, maxSingle);
  const opts = new Set<number>();
  if (def > 0) opts.add(def);
  if (maxSingle > 0) opts.add(maxSingle);
  return [...opts].filter((n) => n > 0).sort((a, b) => a - b);
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

export function capitalizeShiftLabel(label?: string): string {
  const raw = (label ?? '').trim();
  if (!raw) return 'Shift';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
