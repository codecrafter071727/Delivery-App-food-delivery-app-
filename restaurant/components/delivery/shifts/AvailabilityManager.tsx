import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Flame,
  MapPin,
  Timer,
  XCircle,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useDeliveryHeaderScrollProps } from '@/components/delivery/shared/header-scroll';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import {
  formatDutyError,
  usePartnerAttendance,
  usePartnerAttendanceStreak,
  usePartnerShiftMutations,
  usePartnerShifts,
} from '@/lib/delivery-partner/availability-hooks';
import {
  addIstDays,
  capitalizeShiftLabel,
  formatIstDayLabel,
  formatIstTime,
  formatMinutes,
  istDateString,
  type PartnerShiftSlot,
} from '@/lib/delivery-partner/availability-types';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/errors';
import { useRouter } from 'expo-router';

type TabKey = 'shifts' | 'attendance';

function shiftStatusMeta(slot: PartnerShiftSlot) {
  if (slot.bookedByMe) {
    return { label: 'Booked', color: '#15803D', bg: '#DCFCE7' };
  }
  const status = String(slot.status || '').toLowerCase();
  if (status === 'full' || slot.spotsLeft <= 0) {
    return { label: 'Full', color: '#B45309', bg: '#FEF3C7' };
  }
  if (status === 'closed' || status === 'cancelled') {
    return { label: 'Closed', color: '#64748B', bg: '#F1F5F9' };
  }
  return { label: 'Open', color: '#C2410C', bg: '#FFEDD5' };
}

function ShiftCard({
  slot,
  busy,
  onBook,
  onCancel,
}: {
  slot: PartnerShiftSlot;
  busy: boolean;
  onBook: () => void;
  onCancel: () => void;
}) {
  const meta = shiftStatusMeta(slot);
  const timeRange =
    slot.startAt || slot.endAt
      ? `${formatIstTime(slot.startAt)} – ${formatIstTime(slot.endAt)}`
      : 'Time TBA';
  const extras = [
    slot.guaranteedHours ? `${slot.guaranteedHours}h guaranteed` : null,
    slot.incentiveAmount
      ? `${formatCurrency(slot.incentiveAmount, 'INR')} incentive`
      : null,
  ].filter(Boolean);

  return (
    <View style={styles.shiftCard}>
      <View style={styles.shiftTop}>
        <View style={styles.shiftTitleCol}>
          <Text style={styles.shiftLabel}>{capitalizeShiftLabel(slot.label)}</Text>
          <Text style={styles.shiftTime}>{timeRange}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      <View style={styles.shiftMetaRow}>
        <View style={styles.metaChip}>
          <MapPin color={authTheme.textMuted} size={13} />
          <Text style={styles.metaChipText}>
            {slot.spotsLeft} spot{slot.spotsLeft === 1 ? '' : 's'} left
          </Text>
        </View>
        <View style={styles.metaChip}>
          <Clock color={authTheme.textMuted} size={13} />
          <Text style={styles.metaChipText}>
            {slot.bookedCount}/{slot.capacity} booked
          </Text>
        </View>
      </View>

      {extras.length ? (
        <Text style={styles.shiftExtras}>{extras.join(' · ')}</Text>
      ) : null}

      {slot.canBook ? (
        <Pressable
          onPress={onBook}
          disabled={busy}
          style={[styles.actionBtn, styles.bookBtn]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <CheckCircle2 color="#FFFFFF" size={16} />
              <Text style={styles.bookBtnText}>Book shift</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {slot.canCancel ? (
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={[styles.actionBtn, styles.cancelBtn]}
        >
          {busy ? (
            <ActivityIndicator color="#B91C1C" size="small" />
          ) : (
            <>
              <XCircle color="#B91C1C" size={16} />
              <Text style={styles.cancelBtnText}>Cancel booking</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

export function PartnerAvailabilityManager() {
  const router = useRouter();
  const headerScroll = useDeliveryHeaderScrollProps();
  const [tab, setTab] = useState<TabKey>('shifts');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [busyShiftId, setBusyShiftId] = useState<string | null>(null);

  const today = istDateString();
  const shiftRange = useMemo(
    () => ({ from: today, to: addIstDays(today, 7) }),
    [today]
  );
  const attendanceRange = useMemo(
    () => ({ from: addIstDays(today, -6), to: today }),
    [today]
  );

  const shifts = usePartnerShifts(shiftRange);
  const attendance = usePartnerAttendance(attendanceRange);
  const streak = usePartnerAttendanceStreak();
  const { bookShift, cancelShift } = usePartnerShiftMutations();

  const groupedShifts = useMemo(() => {
    const map = new Map<string, PartnerShiftSlot[]>();
    for (const slot of shifts.data ?? []) {
      const key = slot.date || 'upcoming';
      const list = map.get(key) ?? [];
      list.push(slot);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [shifts.data]);

  const shiftErrorCode = getApiErrorCode(shifts.error);
  const shiftError =
    shifts.isError && !shifts.data
      ? formatDutyError(shifts.error, getApiErrorMessage(shifts.error, 'Could not load shifts.'))
      : null;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([
        shifts.refetch(),
        attendance.refetch(),
        streak.refetch(),
      ]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const onBook = (slot: PartnerShiftSlot) => {
    Alert.alert(
      'Book this shift?',
      `${capitalizeShiftLabel(slot.label)} · ${formatIstDayLabel(slot.date)}\n${formatIstTime(slot.startAt)} – ${formatIstTime(slot.endAt)}`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Book',
          onPress: () => {
            setBusyShiftId(slot.id);
            bookShift.mutate(slot.id, {
              onSuccess: () => {
                Alert.alert(
                  'Shift booked',
                  `${capitalizeShiftLabel(slot.label)} · ${formatIstDayLabel(slot.date)} is on your roster.`
                );
              },
              onError: (err) => {
                Alert.alert(
                  'Could not book',
                  formatDutyError(err, 'Please try another slot.')
                );
              },
              onSettled: () => setBusyShiftId(null),
            });
          },
        },
      ]
    );
  };

  const onCancel = (slot: PartnerShiftSlot) => {
    Alert.alert(
      'Cancel booking?',
      'You can cancel until 2 hours before the shift starts.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: () => {
            setBusyShiftId(slot.id);
            cancelShift.mutate(slot.id, {
              onError: (err) => {
                Alert.alert(
                  'Could not cancel',
                  formatDutyError(err, 'Please try again.')
                );
              },
              onSettled: () => setBusyShiftId(null),
            });
          },
        },
      ]
    );
  };

  const loading =
    (tab === 'shifts' && shifts.isLoading && !shifts.data) ||
    (tab === 'attendance' && attendance.isLoading && !attendance.data);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: headerScroll.contentInsetTop + 12,
            paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
          },
        ]}
        onScroll={headerScroll.onScroll}
        scrollEventThrottle={headerScroll.scrollEventThrottle}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.streakCard}>
          <View style={styles.streakIcon}>
            <Flame color="#EA4B14" size={22} />
          </View>
          <View style={styles.streakCopy}>
            <Text style={styles.streakValue}>
              {streak.data?.currentStreak ?? 0}-day streak
            </Text>
            <Text style={styles.streakHint}>
              {streak.data?.todayCounted
                ? 'Today already counts toward your streak.'
                : streak.data?.lastWorkedDate
                  ? `Last login ${formatIstDayLabel(streak.data.lastWorkedDate)}`
                  : 'Go online today to start your streak.'}
            </Text>
          </View>
        </View>

        <View style={styles.segment}>
          <Pressable
            onPress={() => setTab('shifts')}
            style={[styles.segmentBtn, tab === 'shifts' && styles.segmentBtnOn]}
          >
            <CalendarClock
              color={tab === 'shifts' ? '#FFFFFF' : authTheme.textMuted}
              size={15}
            />
            <Text
              style={[
                styles.segmentText,
                tab === 'shifts' && styles.segmentTextOn,
              ]}
            >
              Shifts
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab('attendance')}
            style={[
              styles.segmentBtn,
              tab === 'attendance' && styles.segmentBtnOn,
            ]}
          >
            <Timer
              color={tab === 'attendance' ? '#FFFFFF' : authTheme.textMuted}
              size={15}
            />
            <Text
              style={[
                styles.segmentText,
                tab === 'attendance' && styles.segmentTextOn,
              ]}
            >
              Attendance
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
            <Text style={styles.muted}>
              {tab === 'shifts' ? 'Loading shifts…' : 'Loading attendance…'}
            </Text>
          </View>
        ) : tab === 'shifts' ? (
          shiftError ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Couldn’t load shifts</Text>
              <Text style={styles.muted}>{shiftError}</Text>
              {shiftErrorCode === 'ZONE_REQUIRED' ? (
                <Pressable
                  onPress={() => router.push(DELIVERY_ROUTES.home as never)}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>Go online first</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => void shifts.refetch()}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>Retry</Text>
                </Pressable>
              )}
            </View>
          ) : groupedShifts.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>No shifts this week</Text>
              <Text style={styles.muted}>
                Open slots for your hub will appear here. Pull to refresh after
                going online.
              </Text>
            </View>
          ) : (
            groupedShifts.map(([date, slots]) => (
              <View key={date} style={styles.dayBlock}>
                <Text style={styles.dayTitle}>{formatIstDayLabel(date)}</Text>
                {slots.map((slot) => (
                  <ShiftCard
                    key={slot.id}
                    slot={slot}
                    busy={busyShiftId === slot.id}
                    onBook={() => onBook(slot)}
                    onCancel={() => onCancel(slot)}
                  />
                ))}
              </View>
            ))
          )
        ) : attendance.isError && !attendance.data ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Couldn’t load attendance</Text>
            <Text style={styles.muted}>
              {getApiErrorMessage(attendance.error, 'Please try again.')}
            </Text>
            <Pressable
              onPress={() => void attendance.refetch()}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.totalsRow}>
              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Online</Text>
                <Text style={styles.totalValue}>
                  {formatMinutes(attendance.data?.totals.onlineMinutes)}
                </Text>
              </View>
              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Breaks</Text>
                <Text style={styles.totalValue}>
                  {formatMinutes(attendance.data?.totals.breakMinutes)}
                </Text>
              </View>
              <View style={styles.totalCard}>
                <Text style={styles.totalLabel}>Days</Text>
                <Text style={styles.totalValue}>
                  {attendance.data?.totals.daysWorked ?? 0}
                </Text>
              </View>
            </View>

            {(attendance.data?.days ?? []).length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionTitle}>No login hours yet</Text>
                <Text style={styles.muted}>
                  Your last 7 days will show here after you go online.
                </Text>
              </View>
            ) : (
              (attendance.data?.days ?? []).map((day) => (
                <View key={day.date} style={styles.dayLog}>
                  <View style={styles.dayLogTop}>
                    <Text style={styles.dayLogDate}>
                      {formatIstDayLabel(day.date)}
                    </Text>
                    {day.stillOnDuty ? (
                      <View style={[styles.badge, { backgroundColor: '#DCFCE7' }]}>
                        <Text style={[styles.badgeText, { color: '#15803D' }]}>
                          On duty
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.dayLogMeta}>
                    In {formatIstTime(day.loginAt)}
                    {day.logoutAt ? ` · Out ${formatIstTime(day.logoutAt)}` : ''}
                  </Text>
                  <Text style={styles.dayLogHours}>
                    {formatMinutes(day.onlineMinutes)} online
                    {day.breakMinutes
                      ? ` · ${formatMinutes(day.breakMinutes)} break`
                      : ''}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollView: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FED7AA',
  },
  streakIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  streakCopy: { flex: 1 },
  streakValue: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  streakHint: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: authTheme.tabBg,
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 11,
  },
  segmentBtnOn: {
    backgroundColor: authTheme.brand,
  },
  segmentText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  segmentTextOn: {
    color: '#FFFFFF',
  },
  center: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 16,
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  primaryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  dayBlock: { gap: 8 },
  dayTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
    marginTop: 4,
  },
  shiftCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 10,
  },
  shiftTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  shiftTitleCol: { flex: 1 },
  shiftLabel: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  shiftTime: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  shiftMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: authTheme.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaChipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  shiftExtras: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#C2410C',
  },
  actionBtn: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 11,
  },
  bookBtn: {
    backgroundColor: authTheme.brand,
  },
  bookBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  cancelBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FECACA',
  },
  cancelBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#B91C1C',
  },
  totalsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  totalCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 12,
  },
  totalLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
  },
  totalValue: {
    marginTop: 4,
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  dayLog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 4,
  },
  dayLogTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dayLogDate: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  dayLogMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  dayLogHours: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
});
