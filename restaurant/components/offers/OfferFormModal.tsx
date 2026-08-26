import { Save, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  OfferDateField,
  formatOfferDate,
  parseOfferDate,
} from '@/components/offers/OfferDateField';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  normalizeOfferType,
  offerEffectSummary,
  valueFieldLabel,
} from '@/lib/restaurant/offer-copy';
import { sanitizePromoCode } from '@/lib/restaurant/offers-api';
import type {
  CreateOfferPayload,
  OfferDiscountType,
  RestaurantOffer,
} from '@/lib/restaurant/types';

export type OfferModalState =
  | { mode: 'create' }
  | { mode: 'edit'; offer: RestaurantOffer }
  | null;

const OFFER_TYPE_OPTIONS: { key: OfferDiscountType; label: string }[] = [
  { key: 'percentage', label: '% off' },
  { key: 'flat', label: 'Flat ₹' },
  { key: 'free_delivery', label: 'Free delivery' },
  { key: 'bogo', label: 'BOGO' },
];

function formatDateInput(value?: string) {
  return formatOfferDate(value);
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  required,
  multiline,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  autoCapitalize?: 'none' | 'characters' | 'sentences';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={authTheme.textDim}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

export function OfferFormModal({
  state,
  saving,
  onClose,
  onSubmit,
}: {
  state: OfferModalState;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateOfferPayload) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<OfferDiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [maxDiscount, setMaxDiscount] = useState('');
  const [description, setDescription] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [perUserLimit, setPerUserLimit] = useState('1');
  const [isActive, setIsActive] = useState(true);
  const [descTouched, setDescTouched] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'edit') {
      const offer = state.offer;
      setTitle(offer.title);
      setCode(offer.code ?? '');
      setDiscountType(normalizeOfferType(offer.discountType));
      setDiscountValue(
        offer.discountValue != null ? String(offer.discountValue) : ''
      );
      setMinOrder(
        offer.minOrderAmount != null ? String(offer.minOrderAmount) : '0'
      );
      setMaxDiscount(
        offer.maxDiscountAmount != null ? String(offer.maxDiscountAmount) : ''
      );
      setDescription(offer.description ?? '');
      setValidFrom(formatDateInput(offer.validFrom));
      setValidUntil(formatDateInput(offer.validUntil));
      setUsageLimit(offer.usageLimit ? String(offer.usageLimit) : '');
      setPerUserLimit(
        offer.perUserLimit != null ? String(offer.perUserLimit) : '1'
      );
      setIsActive(offer.isActive !== false);
      setDescTouched(Boolean(offer.description?.trim()));
    } else {
      const today = new Date();
      const in30 = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 30,
        12,
        0,
        0,
        0
      );
      setTitle('');
      setCode('');
      setDiscountType('percentage');
      setDiscountValue('50');
      setMinOrder('500');
      setMaxDiscount('');
      setDescription('');
      setValidFrom(formatDateInput(today));
      setValidUntil(formatDateInput(in30));
      setUsageLimit('');
      setPerUserLimit('1');
      setIsActive(true);
      setDescTouched(false);
    }
  }, [state]);

  const showMaxDiscount = discountType === 'percentage';
  const valueRequired = discountType === 'percentage' || discountType === 'flat';

  const preview = useMemo(() => {
    const discount =
      discountValue.trim() === '' ? 0 : Number(discountValue);
    const min = minOrder.trim() === '' ? 0 : Number(minOrder);
    const max =
      showMaxDiscount && maxDiscount.trim() !== ''
        ? Number(maxDiscount)
        : undefined;
    return offerEffectSummary({
      discountType,
      discountValue: Number.isFinite(discount) ? discount : 0,
      minOrderAmount: Number.isFinite(min) ? min : 0,
      maxDiscountAmount: max != null && Number.isFinite(max) ? max : undefined,
    });
  }, [discountType, discountValue, minOrder, maxDiscount, showMaxDiscount]);

  useEffect(() => {
    if (!descTouched) setDescription(preview);
  }, [preview, descTouched]);

  return (
    <Modal visible={Boolean(state)} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.modalDismiss} onPress={onClose} />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.modalScroll}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {state?.mode === 'edit' ? 'Edit offer' : 'Create offer'}
              </Text>
              <Pressable onPress={onClose}>
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>

            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>What customers get</Text>
              <Text style={styles.previewText}>{preview}</Text>
              <Text style={styles.previewHint}>
                Applied on cart item total when the minimum is met. Delivery fee
                and taxes are not discounted (except free-delivery offers).
              </Text>
            </View>

            <Field
              label="Offer title"
              required
              value={title}
              onChangeText={setTitle}
              placeholder="Weekend special"
            />
            <Field
              label="Promo code"
              required
              value={code}
              onChangeText={(value) => setCode(sanitizePromoCode(value))}
              placeholder="SAVE50"
              autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>Type *</Text>
            <View style={styles.typeRow}>
              {OFFER_TYPE_OPTIONS.map((option) => {
                const on = discountType === option.key;
                return (
                  <Pressable
                    key={option.key}
                    style={[styles.typeChip, on && styles.typeChipOn]}
                    onPress={() => {
                      setDiscountType(option.key);
                      if (option.key !== 'percentage') setMaxDiscount('');
                      if (
                        (option.key === 'bogo' || option.key === 'free_delivery')
                        && !discountValue.trim()
                      ) {
                        setDiscountValue('0');
                      }
                      if (option.key === 'percentage' && !discountValue.trim()) {
                        setDiscountValue('50');
                      }
                      if (option.key === 'flat' && !discountValue.trim()) {
                        setDiscountValue('50');
                      }
                    }}
                  >
                    <Text
                      style={[styles.typeChipText, on && styles.typeChipTextOn]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field
                  label={valueFieldLabel(discountType)}
                  required={valueRequired}
                  value={discountValue}
                  onChangeText={setDiscountValue}
                  placeholder={discountType === 'percentage' ? '50' : '50'}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Field
                  label="Min item total (₹)"
                  value={minOrder}
                  onChangeText={setMinOrder}
                  placeholder="500"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            {showMaxDiscount ? (
              <Field
                label="Max discount cap (₹)"
                value={maxDiscount}
                onChangeText={setMaxDiscount}
                placeholder="100"
                keyboardType="decimal-pad"
              />
            ) : null}

            <Field
              label="Description (shown in cart)"
              value={description}
              onChangeText={(v) => {
                setDescTouched(true);
                setDescription(v);
              }}
              placeholder={preview}
              multiline
            />

            <Text style={styles.fieldLabel}>Valid date range *</Text>
            <Text style={styles.dateHint}>
              Tap a field to open the calendar. Offer runs from that day through
              the end day (inclusive).
            </Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <OfferDateField
                  label="From"
                  required
                  value={validFrom}
                  onChange={(next) => {
                    setValidFrom(next);
                    const from = parseOfferDate(next);
                    const until = parseOfferDate(validUntil);
                    if (from && until && until < from) {
                      setValidUntil(next);
                    }
                  }}
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <OfferDateField
                  label="Until"
                  required
                  value={validUntil}
                  onChange={setValidUntil}
                  minimumDate={parseOfferDate(validFrom) ?? undefined}
                />
              </View>
            </View>

            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Usage cap"
                  value={usageLimit}
                  onChangeText={setUsageLimit}
                  placeholder="Blank = unlimited"
                  keyboardType="numeric"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Field
                  label="Per customer"
                  value={perUserLimit}
                  onChangeText={setPerUserLimit}
                  placeholder="1"
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Show in customer cart</Text>
                <Text style={styles.dateHint}>
                  Off when paused — customers cannot apply this code.
                </Text>
              </View>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ true: '#FECACA', false: '#E5E7EB' }}
                thumbColor={isActive ? authTheme.brand : '#FFFFFF'}
              />
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalPrimary}
                disabled={
                  saving ||
                  !title.trim() ||
                  !code.trim() ||
                  (valueRequired && !discountValue.trim()) ||
                  !validFrom.trim() ||
                  !validUntil.trim()
                }
                onPress={() => {
                  const discount =
                    discountValue.trim() === '' ? 0 : Number(discountValue);
                  const min = minOrder.trim() === '' ? 0 : Number(minOrder);
                  const max =
                    showMaxDiscount && maxDiscount.trim() !== ''
                      ? Number(maxDiscount)
                      : undefined;
                  const cap =
                    usageLimit.trim() === '' ? undefined : Number(usageLimit);
                  const perUser =
                    perUserLimit.trim() === ''
                      ? undefined
                      : Number(perUserLimit);

                  if (
                    valueRequired
                    && (!Number.isFinite(discount) || discount <= 0)
                  ) {
                    Alert.alert(
                      'Invalid value',
                      `Enter a valid ${valueFieldLabel(discountType).toLowerCase()}.`
                    );
                    return;
                  }
                  if (discountType === 'percentage' && discount > 100) {
                    Alert.alert(
                      'Invalid discount',
                      'Percentage cannot exceed 100.'
                    );
                    return;
                  }
                  if (!Number.isFinite(min) || min < 0) {
                    Alert.alert(
                      'Invalid min order',
                      'Enter a valid minimum item total.'
                    );
                    return;
                  }
                  if (max != null && (!Number.isFinite(max) || max < 0)) {
                    Alert.alert('Invalid cap', 'Enter a valid max discount.');
                    return;
                  }
                  if (cap != null && (!Number.isFinite(cap) || cap < 0)) {
                    Alert.alert(
                      'Invalid usage cap',
                      'Enter a whole number, or leave blank.'
                    );
                    return;
                  }
                  if (
                    perUser != null
                    && (!Number.isFinite(perUser) || perUser < 0)
                  ) {
                    Alert.alert(
                      'Invalid per-customer limit',
                      'Enter a whole number.'
                    );
                    return;
                  }
                  const fromDate = parseOfferDate(validFrom);
                  const untilDate = parseOfferDate(validUntil);
                  if (!fromDate || !untilDate) {
                    Alert.alert(
                      'Pick dates',
                      'Tap From and Until to select dates from the calendar.'
                    );
                    return;
                  }
                  if (untilDate < fromDate) {
                    Alert.alert(
                      'Invalid date range',
                      'Until must be on or after From.'
                    );
                    return;
                  }
                  const cleanCode = sanitizePromoCode(code);
                  if (cleanCode.length < 2) {
                    Alert.alert(
                      'Invalid promo code',
                      'Use at least 2 letters or numbers (e.g. SAVE50).'
                    );
                    return;
                  }
                  void onSubmit({
                    title: title.trim(),
                    code: cleanCode,
                    discountType,
                    discountValue: Number.isFinite(discount) ? discount : 0,
                    minOrderAmount: min,
                    maxDiscountAmount:
                      discountType === 'percentage' ? max : undefined,
                    description: (description.trim() || preview) || undefined,
                    validFrom: validFrom.trim(),
                    validUntil: validUntil.trim(),
                    isActive,
                    usageLimit: cap,
                    perUserLimit: perUser,
                  });
                }}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Save color="#FFFFFF" size={16} />
                    <Text style={styles.modalPrimaryText}>
                      {state?.mode === 'edit' ? 'Save' : 'Create'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalDismiss: { flex: 1 },
  modalScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 10,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: authTheme.text,
  },
  previewBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FED7AA',
    padding: 12,
    gap: 4,
  },
  previewLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9A3412',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  previewText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  previewHint: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
    lineHeight: 15,
  },
  field: { gap: 6 },
  fieldLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  dateHint: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textDim,
    marginBottom: 2,
  },
  input: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  textarea: { minHeight: 72, textAlignVertical: 'top' },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F1F5F9',
  },
  typeChipOn: { backgroundColor: authTheme.brandSoft },
  typeChipText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  typeChipTextOn: { color: authTheme.brand },
  row2: { flexDirection: 'row', alignItems: 'flex-start' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalCancel: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  modalCancelText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.textMuted,
  },
  modalPrimary: {
    flex: 1.2,
    minHeight: 46,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: authTheme.brand,
  },
  modalPrimaryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
});
