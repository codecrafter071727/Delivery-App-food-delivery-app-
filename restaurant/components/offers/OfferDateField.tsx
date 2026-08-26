import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { Calendar } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  // RN Web host tags (input[type=date]) need unstable_createElement.
  // @ts-expect-error — typed in react-native-web, not always in RN typings
  unstable_createElement as createElement,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';

/** Display / wire format used by offer API body builders: dd-mm-yyyy */
export function formatOfferDate(value?: string | Date | null): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(value.trim())) {
    return value.trim();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (typeof value === 'string') {
      const ymd = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (ymd) return `${ymd[3]}-${ymd[2]}-${ymd[1]}`;
    }
    return '';
  }
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getFullYear()}`;
}

export function parseOfferDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const dmy = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymd) {
    const date = new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      12,
      0,
      0,
      0
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toYmdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type Props = {
  label: string;
  value: string;
  onChange: (ddmmyyyy: string) => void;
  required?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
};

/**
 * Tap-to-select offer date. Native calendar on iOS/Android; HTML date on web.
 * Always stores dd-mm-yyyy for the existing offer API mapper.
 */
export function OfferDateField({
  label,
  value,
  onChange,
  required,
  minimumDate,
  maximumDate,
}: Props) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => parseOfferDate(value) ?? new Date(),
    [value]
  );

  const commit = (date: Date) => {
    onChange(formatOfferDate(date));
  };

  const onNativeChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        setOpen(false);
        return;
      }
      if (date) commit(date);
      // Keep calendar open until Done — display="calendar" fires on each day tap.
      return;
    }
    if (date) commit(date);
  };

  const webDateInput =
    Platform.OS === 'web' && open
      ? createElement('input', {
          type: 'date',
          value: toYmdLocal(selected),
          min: minimumDate ? toYmdLocal(minimumDate) : undefined,
          max: maximumDate ? toYmdLocal(maximumDate) : undefined,
          onChange: (e: { target: { value: string } }) => {
            const next = parseOfferDate(e.target.value);
            if (next) {
              commit(next);
              setOpen(false);
            }
          },
          style: {
            fontSize: 16,
            padding: 12,
            borderRadius: 12,
            border: `1px solid ${authTheme.cardBorder}`,
            fontFamily: fonts.medium,
            width: '100%',
            boxSizing: 'border-box',
          },
        })
      : null;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} date picker`}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.input, pressed && styles.pressed]}
      >
        <Calendar color={authTheme.brand} size={16} strokeWidth={2.2} />
        <Text style={[styles.valueText, !value && styles.placeholder]}>
          {value || 'Tap to select date'}
        </Text>
      </Pressable>

      {Platform.OS === 'web' && open ? (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.webBackdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.webCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.webTitle}>{label}</Text>
              {webDateInput}
              <Pressable style={styles.webDone} onPress={() => setOpen(false)}>
                <Text style={styles.webDoneText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {Platform.OS === 'android' && open ? (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.webBackdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.androidCard} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.webTitle}>{label}</Text>
              <DateTimePicker
                value={selected}
                mode="date"
                display="calendar"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={onNativeChange}
              />
              <Pressable style={styles.webDone} onPress={() => setOpen(false)}>
                <Text style={styles.webDoneText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {Platform.OS === 'ios' && open ? (
        <Modal transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={styles.iosBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
            <View style={styles.iosSheet}>
              <View style={styles.iosHeader}>
                <Text style={styles.iosTitle}>{label}</Text>
                <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                  <Text style={styles.iosDone}>Done</Text>
                </Pressable>
              </View>
              <DateTimePicker
                value={selected}
                mode="date"
                display="spinner"
                themeVariant="light"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={onNativeChange}
                style={{ alignSelf: 'center' }}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  fieldLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
  },
  pressed: { opacity: 0.85 },
  valueText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  placeholder: { color: authTheme.textDim },
  webBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  webCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  webTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  webDone: {
    alignSelf: 'flex-end',
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  webDoneText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  androidCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    alignItems: 'center',
  },
  iosBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  iosSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 24,
  },
  iosHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  iosTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  iosDone: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.brand,
  },
});
