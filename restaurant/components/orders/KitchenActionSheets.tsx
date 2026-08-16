import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { OwnerOrder } from '@/lib/dashboard/types';
import { getApiErrorMessage } from '@/lib/errors';
import {
  DEFAULT_PREP_MINUTES,
  PREP_TIME_OPTIONS,
  type RejectReason,
} from '@/lib/order/owner-api';
import { money, resolveOrderTotal, shortOrderId } from '@/lib/order/ui';

type AcceptProps = {
  visible: boolean;
  order: OwnerOrder | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (prepTime: number) => void;
};

export function AcceptPrepSheet({
  visible,
  order,
  busy,
  onClose,
  onConfirm,
}: AcceptProps) {
  const [prepTime, setPrepTime] = useState(DEFAULT_PREP_MINUTES);

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Accept order?</Text>
          <Text style={styles.copy}>
            {order
              ? `#${shortOrderId(order).toUpperCase()} · ${money(resolveOrderTotal(order))}`
              : 'Choose how long cooking will take.'}
          </Text>
          <Text style={styles.section}>Prep time</Text>
          <View style={styles.grid}>
            {PREP_TIME_OPTIONS.map((mins) => {
              const on = prepTime === mins;
              return (
                <Pressable
                  key={mins}
                  onPress={() => setPrepTime(mins)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {mins} min
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.secondary}>
              <Text style={styles.secondaryText}>Not now</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => onConfirm(prepTime)}
              style={styles.primary}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryText}>Accept · {prepTime} min</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type RejectProps = {
  visible: boolean;
  order: OwnerOrder | null;
  reasons: RejectReason[];
  reasonsError?: unknown;
  busy?: boolean;
  title?: string;
  copy?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (reasonCode: string, note?: string) => void;
};

export function RejectOrderSheet({
  visible,
  order,
  reasons,
  reasonsError,
  busy,
  title = 'Reject order?',
  copy,
  confirmLabel = 'Reject',
  onClose,
  onConfirm,
}: RejectProps) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');

  const close = () => {
    setCode('');
    setNote('');
    onClose();
  };

  const submit = () => {
    if (!code) return;
    if (code === 'other' && note.trim().length < 3) return;
    onConfirm(code, note.trim() || undefined);
  };

  const needNote = code === 'other' || reasons.length === 0;
  const canSubmit =
    Boolean(code) && (!needNote || note.trim().length >= 3) && !busy;

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.copy}>
            {copy ??
              (order
                ? `#${shortOrderId(order).toUpperCase()} · pick a reason the customer may see.`
                : 'Pick a reason the customer may see.')}
          </Text>
          {reasonsError ? (
            <Text style={styles.error}>
              {getApiErrorMessage(reasonsError, 'Could not load reject reasons')}
            </Text>
          ) : null}
          <View style={styles.grid}>
            {reasons.map((reason) => {
              const on = code === reason.code;
              return (
                <Pressable
                  key={reason.code}
                  onPress={() => setCode(reason.code)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {reason.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {needNote ? (
            <TextInput
              multiline
              maxLength={200}
              onChangeText={setNote}
              placeholder="Short note for the customer"
              placeholderTextColor={authTheme.textDim}
              style={styles.input}
              value={note}
            />
          ) : null}
          {code === 'other' && note.trim().length > 0 && note.trim().length < 3 ? (
            <Text style={styles.error}>Write at least 3 characters.</Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={close} style={styles.secondary}>
              <Text style={styles.secondaryText}>Keep order</Text>
            </Pressable>
            <Pressable
              disabled={!canSubmit}
              onPress={submit}
              style={[styles.danger, !canSubmit && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: authTheme.text,
  },
  copy: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  section: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: authTheme.surface,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipOn: {
    backgroundColor: authTheme.brandSoft,
    borderColor: authTheme.brand,
  },
  chipText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  chipTextOn: {
    color: authTheme.brand,
  },
  input: {
    minHeight: 80,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 12,
    textAlignVertical: 'top',
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.error,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  secondaryText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.textMuted,
  },
  primary: {
    flex: 1.3,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brand,
  },
  danger: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.error,
  },
  disabled: {
    opacity: 0.5,
  },
  primaryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
});
