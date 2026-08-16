import { CalendarOff, Clock3, Plus, Sparkles, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useOutletCalendarMutations,
  useOutletHolidays,
  useOutletSpecialHours,
  useOutletTimings,
} from '@/lib/restaurant/hooks';
import {
  WEEK_DAYS,
  emptyTimings,
  type DayKey,
  type RestaurantTimings,
} from '@/lib/restaurant/settings-types';
import type { HolidayRow, SpecialHoursDay } from '@/lib/restaurant/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function addIstDays(ymd: string, days: number) {
  const date = new Date(`${ymd}T12:00:00+05:30`);
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function formatNextOpen(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatHoliday(date: string) {
  const parsed = new Date(`${date}T00:00:00+05:30`);
  if (!Number.isFinite(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

type Props = {
  restaurantId: string;
  busy: boolean;
  onSave: (next: RestaurantTimings) => void;
};

export function KitchenHoursEditor({ restaurantId, busy, onSave }: Props) {
  const timingsQuery = useOutletTimings(restaurantId, Boolean(restaurantId));
  const holidaysQuery = useOutletHolidays(restaurantId, Boolean(restaurantId));
  const specialQuery = useOutletSpecialHours(restaurantId, Boolean(restaurantId));
  const calendar = useOutletCalendarMutations(restaurantId);
  const [draft, setDraft] = useState<RestaurantTimings>(emptyTimings());
  const [holidayDate, setHolidayDate] = useState(istToday());
  const [holidayReason, setHolidayReason] = useState('');
  const [specialDate, setSpecialDate] = useState(addIstDays(istToday(), 1));
  const [specialOpen, setSpecialOpen] = useState(true);
  const [specialOpenTime, setSpecialOpenTime] = useState('11:00');
  const [specialCloseTime, setSpecialCloseTime] = useState('15:00');
  const [specialReason, setSpecialReason] = useState('');

  useEffect(() => {
    if (timingsQuery.data?.week) {
      setDraft(timingsQuery.data.week as RestaurantTimings);
    }
  }, [timingsQuery.data?.week]);

  const toggleDay = (day: DayKey, isOpen: boolean) => {
    setDraft((prev) => ({
      ...prev,
      [day]: {
        ...prev[day],
        isOpen,
        slots: prev[day].slots.length
          ? prev[day].slots
          : [{ open: '09:00', close: '22:00' }],
      },
    }));
  };

  const updateSlot = (
    day: DayKey,
    index: number,
    key: 'open' | 'close',
    value: string
  ) => {
    setDraft((prev) => {
      const slots = [...prev[day].slots];
      slots[index] = { ...slots[index], [key]: value };
      return { ...prev, [day]: { ...prev[day], slots } };
    });
  };

  const addSlot = (day: DayKey) => {
    setDraft((prev) => {
      if (prev[day].slots.length >= 3) return prev;
      return {
        ...prev,
        [day]: {
          ...prev[day],
          isOpen: true,
          slots: [...prev[day].slots, { open: '12:00', close: '15:00' }],
        },
      };
    });
  };

  const removeSlot = (day: DayKey, index: number) => {
    setDraft((prev) => {
      const slots = prev[day].slots.filter((_, i) => i !== index);
      return {
        ...prev,
        [day]: {
          ...prev[day],
          slots: slots.length ? slots : [{ open: '09:00', close: '22:00' }],
          isOpen: slots.length > 0 ? prev[day].isOpen : false,
        },
      };
    });
  };

  const nextOpen = formatNextOpen(timingsQuery.data?.nextOpenAt);
  const holidays = holidaysQuery.data?.holidays ?? timingsQuery.data?.holidays ?? [];
  const specialDays = specialQuery.data?.days ?? [];
  const calendarBusy =
    calendar.updateHolidays.isPending || calendar.updateSpecialHours.isPending;

  const saveHolidays = async (next: HolidayRow[]) => {
    try {
      await calendar.updateHolidays.mutateAsync(next);
    } catch (error) {
      Alert.alert(
        'Could not save closed dates',
        getApiErrorMessage(error, 'Try a date within the next year.')
      );
    }
  };

  const addHoliday = () => {
    if (!DATE_RE.test(holidayDate)) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD, for example 2026-08-15.');
      return;
    }
    if (holidays.some((row) => row.date === holidayDate)) {
      Alert.alert('Already closed', 'That date is already on the holiday list.');
      return;
    }
    const reason = holidayReason.trim();
    void saveHolidays(
      [...holidays, { date: holidayDate, reason: reason || 'Closed' }].sort(
        (a, b) => a.date.localeCompare(b.date)
      )
    );
    setHolidayReason('');
  };

  const saveSpecial = async () => {
    if (!DATE_RE.test(specialDate)) {
      Alert.alert('Invalid date', 'Use YYYY-MM-DD, for example 2026-08-16.');
      return;
    }
    if (specialOpen && (!TIME_RE.test(specialOpenTime) || !TIME_RE.test(specialCloseTime))) {
      Alert.alert('Invalid time', 'Use 24-hour IST times like 11:00 and 15:00.');
      return;
    }
    try {
      await calendar.updateSpecialHours.mutateAsync({
        date: specialDate,
        isOpen: specialOpen,
        slots: specialOpen
          ? [{ open: specialOpenTime, close: specialCloseTime }]
          : [],
        reason: specialReason.trim() || undefined,
      });
      setSpecialReason('');
    } catch (error) {
      Alert.alert(
        'Could not save special hours',
        getApiErrorMessage(error, 'Check the date and times, then try again.')
      );
    }
  };

  if (timingsQuery.isLoading && !timingsQuery.data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={authTheme.brand} size="large" />
      </View>
    );
  }

  if (timingsQuery.isError && !timingsQuery.data) {
    return (
      <View style={styles.banner}>
        <Text style={styles.errorText}>
          {timingsQuery.error instanceof Error
            ? timingsQuery.error.message
            : 'Could not load opening hours'}
        </Text>
        <Pressable onPress={() => void timingsQuery.refetch()}>
          <Text style={styles.link}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <Clock3
            color={timingsQuery.data?.isOpenNow ? authTheme.success : authTheme.textMuted}
            size={18}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>
            {timingsQuery.data?.isOpenNow ? 'Open now (IST)' : 'Closed now (IST)'}
          </Text>
          <Text style={styles.bannerMeta}>
            {timingsQuery.data?.isOpenNow
              ? 'Customers can order during these hours if the store is also online.'
              : nextOpen
                ? `Next open ${nextOpen}`
                : 'Set weekly slots so customers know when you cook.'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Operating hours</Text>
        <Text style={styles.sectionSub}>
          Toggle a day open, then set up to 3 IST slots (lunch + dinner).
        </Text>
        {WEEK_DAYS.map((day) => {
          const row = draft[day.key];
          return (
            <View key={day.key} style={styles.dayRow}>
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>{day.label}</Text>
                <Switch
                  value={row.isOpen}
                  onValueChange={(next) => toggleDay(day.key, next)}
                  trackColor={{ false: '#E2E8F0', true: 'rgba(234,75,20,0.35)' }}
                  thumbColor={row.isOpen ? authTheme.brand : '#F8FAFC'}
                />
              </View>
              {row.isOpen ? (
                <View style={{ gap: 8 }}>
                  {row.slots.slice(0, 3).map((slot, index) => (
                    <View key={`${day.key}-${index}`} style={styles.slotRow}>
                      <TextInput
                        value={slot.open}
                        onChangeText={(text) =>
                          updateSlot(day.key, index, 'open', text)
                        }
                        placeholder="09:00"
                        placeholderTextColor={authTheme.textDim}
                        style={styles.slotInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <Text style={styles.slotDash}>–</Text>
                      <TextInput
                        value={slot.close}
                        onChangeText={(text) =>
                          updateSlot(day.key, index, 'close', text)
                        }
                        placeholder="22:00"
                        placeholderTextColor={authTheme.textDim}
                        style={styles.slotInput}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {row.slots.length > 1 ? (
                        <Pressable onPress={() => removeSlot(day.key, index)}>
                          <Text style={styles.remove}>Remove</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                  {row.slots.length < 3 ? (
                    <Pressable onPress={() => addSlot(day.key)}>
                      <Text style={styles.addSlot}>Add time slot</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <PrimaryButton
        label="Save hours"
        loading={busy}
        onPress={() => onSave(draft)}
      />

      <View style={styles.section}>
        <View style={styles.holidayHead}>
          <CalendarOff color={authTheme.textMuted} size={16} />
          <Text style={styles.sectionTitle}>Closed dates</Text>
        </View>
        <Text style={styles.sectionSub}>
          Festival closures. Customers cannot order these IST dates. Max 90.
        </Text>
        <View style={styles.chipRow}>
          {[
            { label: 'Today', value: istToday() },
            { label: 'Tomorrow', value: addIstDays(istToday(), 1) },
            { label: '+7 days', value: addIstDays(istToday(), 7) },
          ].map((chip) => (
            <Pressable
              key={chip.label}
              onPress={() => setHolidayDate(chip.value)}
              style={[
                styles.chip,
                holidayDate === chip.value && styles.chipOn,
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  holidayDate === chip.value && styles.chipTextOn,
                ]}
              >
                {chip.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.slotRow}>
          <TextInput
            value={holidayDate}
            onChangeText={setHolidayDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={authTheme.textDim}
            style={styles.slotInput}
            autoCapitalize="none"
          />
          <TextInput
            value={holidayReason}
            onChangeText={setHolidayReason}
            placeholder="Reason (Diwali)"
            placeholderTextColor={authTheme.textDim}
            style={styles.slotInput}
          />
        </View>
        <Pressable
          disabled={calendarBusy}
          onPress={addHoliday}
          style={styles.addRow}
        >
          <Plus color={authTheme.brand} size={16} />
          <Text style={styles.addSlot}>Add closed date</Text>
        </Pressable>
        {holidaysQuery.isLoading && !holidays.length ? (
          <ActivityIndicator color={authTheme.brand} />
        ) : holidays.length ? (
          holidays.map((row) => (
            <View key={row.date} style={styles.holidayRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.holidayDate}>{formatHoliday(row.date)}</Text>
                <Text style={styles.holidayReason}>{row.reason || 'Closed'}</Text>
              </View>
              <Pressable
                onPress={() =>
                  void saveHolidays(holidays.filter((item) => item.date !== row.date))
                }
                hitSlop={8}
              >
                <Trash2 color={authTheme.error} size={16} />
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={styles.sectionSub}>No holidays on the calendar.</Text>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.holidayHead}>
          <Sparkles color={authTheme.textMuted} size={16} />
          <Text style={styles.sectionTitle}>Special hours</Text>
        </View>
        <Text style={styles.sectionSub}>
          One-day override (festival lunch, early close). Replaces a holiday on that date.
        </Text>
        <View style={styles.dayHeader}>
          <Text style={styles.dayLabel}>Open this day</Text>
          <Switch
            value={specialOpen}
            onValueChange={setSpecialOpen}
            trackColor={{ false: '#E2E8F0', true: 'rgba(234,75,20,0.35)' }}
            thumbColor={specialOpen ? authTheme.brand : '#F8FAFC'}
          />
        </View>
        <TextInput
          value={specialDate}
          onChangeText={setSpecialDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={authTheme.textDim}
          style={styles.slotInput}
          autoCapitalize="none"
        />
        {specialOpen ? (
          <View style={styles.slotRow}>
            <TextInput
              value={specialOpenTime}
              onChangeText={setSpecialOpenTime}
              placeholder="11:00"
              placeholderTextColor={authTheme.textDim}
              style={styles.slotInput}
              autoCapitalize="none"
            />
            <Text style={styles.slotDash}>–</Text>
            <TextInput
              value={specialCloseTime}
              onChangeText={setSpecialCloseTime}
              placeholder="15:00"
              placeholderTextColor={authTheme.textDim}
              style={styles.slotInput}
              autoCapitalize="none"
            />
          </View>
        ) : null}
        <TextInput
          value={specialReason}
          onChangeText={setSpecialReason}
          placeholder="Reason (Festival lunch)"
          placeholderTextColor={authTheme.textDim}
          style={styles.slotInput}
        />
        <PrimaryButton
          label={specialOpen ? 'Save special hours' : 'Mark this date closed'}
          loading={calendarBusy}
          onPress={() => void saveSpecial()}
        />
        {specialQuery.isLoading && !specialDays.length ? (
          <ActivityIndicator color={authTheme.brand} />
        ) : specialDays.length ? (
          specialDays.map((row: SpecialHoursDay) => (
            <View key={row.date} style={styles.holidayRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.holidayDate}>{formatHoliday(row.date)}</Text>
                <Text style={styles.holidayReason}>
                  {row.isOpen
                    ? row.slots
                        .map((slot) => `${slot.open}–${slot.close}`)
                        .join(', ')
                    : 'Closed'}
                  {row.reason ? ` · ${row.reason}` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  void calendar.updateSpecialHours
                    .mutateAsync({ date: row.date, remove: true })
                    .catch((error) =>
                      Alert.alert(
                        'Could not remove',
                        getApiErrorMessage(error, 'Try again.')
                      )
                    )
                }
                hitSlop={8}
              >
                <Trash2 color={authTheme.error} size={16} />
              </Pressable>
            </View>
          ))
        ) : (
          <Text style={styles.sectionSub}>No one-day overrides yet.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 40, alignItems: 'center' },
  banner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 14,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: {
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  bannerMeta: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    marginTop: 2,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  sectionSub: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    marginTop: -4,
  },
  dayRow: { gap: 8, paddingVertical: 6 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayLabel: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slotInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  slotDash: { color: authTheme.textMuted, fontFamily: fonts.bold },
  remove: { color: authTheme.error, fontSize: 12, fontFamily: fonts.bold },
  addSlot: {
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  holidayHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  holidayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  holidayDate: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 13 },
  holidayReason: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipOn: {
    backgroundColor: authTheme.brandSoft,
    borderColor: authTheme.brand,
  },
  chipText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  chipTextOn: { color: authTheme.brand },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  link: { color: authTheme.brand, fontFamily: fonts.bold, fontSize: 13 },
  errorText: {
    color: authTheme.error,
    fontFamily: fonts.medium,
    fontSize: 13,
    flex: 1,
  },
});
