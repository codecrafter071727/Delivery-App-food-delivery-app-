import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { OwnerOrder, OwnerOrderItem } from '@/lib/dashboard/types';
import {
  DELAY_EXTRA_OPTIONS,
  PREP_TIME_OPTIONS,
  type KitchenHandover,
  type KotPrintResult,
} from '@/lib/order/owner-api';
import { kitchenHandoverErrorCopy, money } from '@/lib/order/ui';

const DELAY_REASONS = [
  'Rush hour',
  'Taking longer to cook',
  'Short staffed',
  'Packing delay',
];

type PrepProps = {
  visible: boolean;
  current?: number;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (prepMinutes: number) => void;
};

export function PrepTimeSheet({
  visible,
  current,
  busy,
  onClose,
  onConfirm,
}: PrepProps) {
  const [mins, setMins] = useState(current ?? 20);
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Change prep time</Text>
          <Text style={styles.copy}>
            Customer promise updates. Allowed while accepted or cooking.
          </Text>
          <View style={styles.grid}>
            {PREP_TIME_OPTIONS.map((option) => {
              const on = mins === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setMins(option)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {option} min
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.secondary}>
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => onConfirm(mins)}
              style={styles.primary}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryText}>Save {mins} min</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type DelayProps = {
  visible: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (extraMinutes: number, reason: string) => void;
};

export function DelayOrderSheet({
  visible,
  busy,
  onClose,
  onConfirm,
}: DelayProps) {
  const [extra, setExtra] = useState(10);
  const [reason, setReason] = useState(DELAY_REASONS[0]);
  const [custom, setCustom] = useState('');
  const other = reason === 'Other';
  const text = other ? custom.trim() : reason;
  const canSubmit = text.length >= 3 && !busy;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Running late?</Text>
          <Text style={styles.copy}>
            We’ll tell the customer this order needs a little more time.
          </Text>
          <Text style={styles.section}>Extra minutes</Text>
          <View style={styles.grid}>
            {DELAY_EXTRA_OPTIONS.map((option) => {
              const on = extra === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setExtra(option)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    +{option} min
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.section}>Reason</Text>
          <View style={styles.grid}>
            {[...DELAY_REASONS, 'Other'].map((label) => {
              const on = reason === label;
              return (
                <Pressable
                  key={label}
                  onPress={() => setReason(label)}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {other ? (
            <TextInput
              maxLength={200}
              onChangeText={setCustom}
              placeholder="Why is it late?"
              placeholderTextColor={authTheme.textDim}
              style={styles.input}
              value={custom}
            />
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.secondary}>
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Pressable
              disabled={!canSubmit}
              onPress={() => onConfirm(extra, text)}
              style={[styles.primary, !canSubmit && styles.disabled]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryText}>Notify +{extra} min</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type EightySixProps = {
  visible: boolean;
  order: OwnerOrder | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (itemIds: string[], note?: string) => void;
};

export function ItemsUnavailableSheet({
  visible,
  order,
  busy,
  onClose,
  onConfirm,
}: EightySixProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const items = (order?.items ?? []).filter((item): item is OwnerOrderItem & { id: string } =>
    Boolean(item.id)
  );
  const allSelected = items.length > 0 && selected.length === items.length;
  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id]
    );
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Item not available?</Text>
          <Text style={styles.copy}>
            Remove dishes you can’t make. The bill is recalculated. Don’t select every
            item — cancel the order instead.
          </Text>
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
            {items.map((item) => {
              const on = selected.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggle(item.id)}
                  style={[styles.itemRow, on && styles.itemRowOn]}
                >
                  <View style={[styles.box, on && styles.boxOn]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{item.name}</Text>
                    <Text style={styles.itemMeta}>
                      {item.quantity}×
                      {item.price != null ? ` · ${money(item.price * item.quantity)}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          {allSelected ? (
            <Text style={styles.error}>
              That’s the whole order. Use Cancel order instead.
            </Text>
          ) : null}
          <TextInput
            maxLength={300}
            onChangeText={setNote}
            placeholder="Optional note (Paneer finished)"
            placeholderTextColor={authTheme.textDim}
            style={styles.input}
            value={note}
          />
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                setSelected([]);
                setNote('');
                onClose();
              }}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Pressable
              disabled={busy || selected.length === 0 || allSelected}
              onPress={() => onConfirm(selected, note.trim() || undefined)}
              style={[
                styles.primary,
                (busy || selected.length === 0 || allSelected) && styles.disabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryText}>
                  Remove {selected.length || ''}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type KotProps = {
  result: KotPrintResult | null;
  onClose: () => void;
};

export function KotPreviewSheet({ result, onClose }: KotProps) {
  const lines = useMemo(() => result?.ticket.items ?? [], [result]);
  if (!result) return null;
  return (
    <Modal transparent animationType="fade" visible={Boolean(result)} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>
            {result.reprint ? 'KOT reprinted' : 'KOT printed'}
          </Text>
          <Text style={styles.copy}>
            #{String(result.orderNumber || result.orderId).toUpperCase()}
            {result.printCount > 1 ? ` · print #${result.printCount}` : ''}
          </Text>
          {result.ticket.restaurantName ? (
            <Text style={styles.section}>{result.ticket.restaurantName}</Text>
          ) : null}
          {lines.map((line, index) => (
            <Text key={`${line.name}-${index}`} style={styles.itemName}>
              {line.quantity}× {line.name}
              {line.modifiers?.length ? ` (${line.modifiers.join(', ')})` : ''}
            </Text>
          ))}
          {result.ticket.specialInstructions ? (
            <Text style={styles.copy}>{result.ticket.specialInstructions}</Text>
          ) : null}
          <Pressable onPress={onClose} style={styles.primary}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type RateProps = {
  visible: boolean;
  riderName?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (stars: number, comment?: string) => void;
};

export function RatePartnerSheet({
  visible,
  riderName,
  busy,
  onClose,
  onConfirm,
}: RateProps) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Rate pickup</Text>
          <Text style={styles.copy}>
            How was {riderName || 'the rider'} at your counter? This is saved on their
            profile.
          </Text>
          <View style={styles.starRow}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable
                key={value}
                onPress={() => setStars(value)}
                style={styles.starHit}
              >
                <Text style={[styles.star, value <= stars && styles.starOn]}>
                  ★
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            maxLength={200}
            onChangeText={setComment}
            placeholder="Optional note (arrived on time, handled bags well)"
            placeholderTextColor={authTheme.textDim}
            style={styles.input}
            value={comment}
          />
          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.secondary}>
              <Text style={styles.secondaryText}>Back</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => onConfirm(stars, comment.trim() || undefined)}
              style={styles.primary}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryText}>Submit {stars}★</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

type HandoverCardProps = {
  handover?: KitchenHandover;
  loading?: boolean;
  error?: unknown;
  busy?: boolean;
  onRetry: () => void;
  onConfirmOtp: (otp: string) => void;
  onConfirmTap: () => void;
};

export function RiderHandoverCard({
  handover,
  loading,
  error,
  busy,
  onRetry,
  onConfirmOtp,
  onConfirmTap,
}: HandoverCardProps) {
  const [typed, setTyped] = useState('');
  const pin = (handover?.otp ?? typed).replace(/\D/g, '').slice(0, 4);
  const canOtp = Boolean(handover?.methods.includes('otp') || handover?.otp);
  const canTap = Boolean(handover?.methods.includes('tap'));
  const returning = handover?.kind === 'return';

  if (handover?.hide) return null;

  if (loading && !handover) {
    return (
      <View style={styles.handoverCard}>
        <ActivityIndicator color={authTheme.brand} />
        <Text style={styles.copy}>Checking rider handover…</Text>
      </View>
    );
  }

  if (error && !handover) {
    return (
      <View style={[styles.handoverCard, styles.handoverWait]}>
        <Text style={styles.title}>Couldn’t load handover</Text>
        <Text style={styles.error}>{kitchenHandoverErrorCopy(error)}</Text>
        <Pressable onPress={onRetry} style={styles.secondary}>
          <Text style={styles.secondaryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (returning && handover?.returnVerified) {
    return (
      <View style={[styles.handoverCard, styles.handoverDone]}>
        <Text style={styles.handoverEyebrow}>BAG RECEIVED</Text>
        <Text style={styles.title}>Bag received. Trip closed.</Text>
        <Text style={styles.copy}>
          {handover.riderName
            ? `${handover.riderName} returned this order.`
            : 'Returned order received.'}
        </Text>
      </View>
    );
  }

  if (!returning && handover?.confirmed) {
    return (
      <View style={[styles.handoverCard, styles.handoverDone]}>
        <Text style={styles.handoverEyebrow}>HANDED TO RIDER</Text>
        <Text style={styles.title}>Pickup confirmed</Text>
        <Text style={styles.copy}>
          {handover.riderName
            ? `${handover.riderName} has the order.`
            : 'The rider can leave for the customer.'}
        </Text>
      </View>
    );
  }

  if (returning && !handover?.returnArrived) {
    return (
      <View style={[styles.handoverCard, styles.handoverWait]}>
        <Text style={styles.handoverEyebrow}>RIDER IS RETURNING</Text>
        <Text style={styles.title}>Rider is returning this order</Text>
        <Text style={styles.copy}>
          Rider could not deliver. They are bringing the food back. Wait until
          they arrive.
        </Text>
        {handover?.rtoFee != null && handover.rtoFee > 0 ? (
          <Text style={styles.copy}>
            Rider RTO fee ₹{Math.round(handover.rtoFee)} (platform pays the
            rider — do not collect cash).
          </Text>
        ) : null}
      </View>
    );
  }

  if (!handover?.available) {
    return (
      <View style={[styles.handoverCard, styles.handoverWait]}>
        <Text style={styles.handoverEyebrow}>RIDER PICKUP</Text>
        <Text style={styles.title}>Waiting for rider</Text>
        <Text style={styles.copy}>
          {handover?.message ||
            'The 4-digit PIN appears here only after the rider taps Arrived at store. Never invent a PIN.'}
        </Text>
      </View>
    );
  }

  if (returning) {
    return (
      <View style={[styles.handoverCard, styles.handoverReady]}>
        <Text style={styles.handoverEyebrow}>RECEIVE RETURNED ORDER</Text>
        <Text style={styles.title}>
          {handover.riderName
            ? `${handover.riderName} is back at the store`
            : 'Check the bag, then Receive'}
        </Text>
        <Text style={styles.copy}>
          {handover.otp
            ? `Check the bag, then Receive. OTP ${handover.otp}.`
            : 'Ask the rider for the kitchen return OTP — not the customer drop OTP.'}
        </Text>
        {handover.otp ? (
          <View style={styles.pinRow}>
            {handover.otp
              .replace(/\D/g, '')
              .slice(0, 4)
              .padEnd(4, ' ')
              .split('')
              .map((digit, index) => (
                <View key={`${digit}-${index}`} style={styles.pinBox}>
                  <Text style={styles.pinDigit}>{digit.trim() || '·'}</Text>
                </View>
              ))}
          </View>
        ) : (
          <TextInput
            autoFocus
            keyboardType="number-pad"
            maxLength={4}
            onChangeText={(value) => setTyped(value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4-digit return OTP"
            placeholderTextColor={authTheme.textDim}
            style={styles.pinInput}
            value={typed}
          />
        )}
        {canTap ? (
          <Pressable
            disabled={busy}
            onPress={onConfirmTap}
            style={[styles.primary, busy && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.primaryText}>Tap receive</Text>
            )}
          </Pressable>
        ) : null}
        {canOtp ? (
          <Pressable
            disabled={busy || pin.length !== 4}
            onPress={() => onConfirmOtp(pin)}
            style={[styles.secondary, (busy || pin.length !== 4) && styles.disabled]}
          >
            <Text style={styles.secondaryText}>Confirm OTP</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.handoverCard, styles.handoverReady]}>
      <Text style={styles.handoverEyebrow}>RIDER HAS ARRIVED</Text>
      <Text style={styles.title}>
        {handover.riderName ? `${handover.riderName} is at the counter` : 'Confirm pickup'}
      </Text>
      {handover.otp ? (
        <>
          <Text style={styles.copy}>Show this PIN to the rider. Do not share it on chat.</Text>
          <View style={styles.pinRow}>
            {handover.otp
              .replace(/\D/g, '')
              .slice(0, 4)
              .padEnd(4, ' ')
              .split('')
              .map((digit, index) => (
                <View key={`${digit}-${index}`} style={styles.pinBox}>
                  <Text style={styles.pinDigit}>{digit.trim() || '·'}</Text>
                </View>
              ))}
          </View>
        </>
      ) : (
        <>
          <Text style={styles.copy}>
            Ask the rider for their pickup PIN, then enter it here.
          </Text>
          <TextInput
            autoFocus
            keyboardType="number-pad"
            maxLength={4}
            onChangeText={(value) => setTyped(value.replace(/\D/g, '').slice(0, 4))}
            placeholder="4-digit PIN"
            placeholderTextColor={authTheme.textDim}
            style={styles.pinInput}
            value={typed}
          />
        </>
      )}
      {canOtp ? (
        <Pressable
          disabled={busy || pin.length !== 4}
          onPress={() => onConfirmOtp(pin)}
          style={[styles.primary, (busy || pin.length !== 4) && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Text style={styles.primaryText}>Confirm OTP</Text>
          )}
        </Pressable>
      ) : null}
      {canTap ? (
        <Pressable disabled={busy} onPress={onConfirmTap} style={styles.secondary}>
          <Text style={styles.secondaryText}>Tap handover</Text>
        </Pressable>
      ) : null}
    </View>
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
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  itemRowOn: {
    backgroundColor: authTheme.brandSoft,
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  box: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: authTheme.cardBorder,
  },
  boxOn: {
    backgroundColor: authTheme.brand,
    borderColor: authTheme.brand,
  },
  itemName: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  itemMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    marginTop: 2,
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
    flex: 1.2,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brand,
  },
  disabled: { opacity: 0.45 },
  primaryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  handoverCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 10,
  },
  handoverWait: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  handoverReady: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  handoverDone: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  handoverEyebrow: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: authTheme.textMuted,
    letterSpacing: 0.6,
  },
  pinRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  pinBox: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDigit: {
    fontFamily: fonts.extraBold,
    fontSize: 28,
    color: authTheme.text,
    letterSpacing: 1,
  },
  pinInput: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    fontFamily: fonts.extraBold,
    fontSize: 22,
    letterSpacing: 8,
    color: authTheme.text,
    textAlign: 'center',
  },
  starRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  starHit: {
    padding: 4,
  },
  star: {
    fontSize: 28,
    color: '#CBD5E1',
  },
  starOn: {
    color: '#F59E0B',
  },
});
