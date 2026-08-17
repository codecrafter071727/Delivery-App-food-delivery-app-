import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { formatFinanceError } from '@/lib/delivery-partner/finance-api';
import {
  useCodPending,
  useFinanceMutations,
} from '@/lib/delivery-partner/finance-hooks';
import {
  COD_REMIT_METHODS,
  type CodRemitMethod,
  type CodRemittance,
} from '@/lib/delivery-partner/finance-types';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function CodRemitSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const pending = useCodPending(visible);
  const { remitCod } = useFinanceMutations();
  const [method, setMethod] = useState<CodRemitMethod>('hub_cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CodRemittance | null>(null);

  const data = pending.data;

  useEffect(() => {
    if (!visible) {
      setDone(null);
      setError(null);
      setAmount('');
      setReference('');
      setNote('');
      setMethod('hub_cash');
    }
  }, [visible]);

  const parsed = amount.trim() ? Number(amount) : undefined;
  const canSubmit =
    (data?.cashInHand ?? 0) >= 1 &&
    !remitCod.isPending &&
    (parsed == null || (Number.isFinite(parsed) && parsed >= (data?.minRemit ?? 1)));

  const onSubmit = async () => {
    setError(null);
    try {
      const result = await remitCod.mutateAsync({
        method,
        amount: parsed,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      setDone(result);
    } catch (err) {
      setError(formatFinanceError(err, 'Could not record remittance.'));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Remit COD cash</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
              <X color="#6B7280" size={20} />
            </Pressable>
          </View>

          {pending.isLoading && !data ? (
            <ActivityIndicator color="#EA4B14" />
          ) : pending.isError && !data ? (
            <View style={styles.block}>
              <Text style={styles.error}>
                {formatFinanceError(pending.error, 'Could not load COD cash.')}
              </Text>
              <Pressable onPress={() => void pending.refetch()} style={styles.primary}>
                <Text style={styles.primaryText}>Retry</Text>
              </Pressable>
            </View>
          ) : done ? (
            <View style={styles.block}>
              <Text style={styles.ok}>Remittance recorded</Text>
              <Text style={styles.amount}>{formatCurrency(done.amount)}</Text>
              <Text style={styles.meta}>
                {done.method.replace(/_/g, ' ')} · cash now{' '}
                {formatCurrency(done.cashAfter ?? 0)}
              </Text>
              <Pressable onPress={onClose} style={styles.primary}>
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.block}>
              <Text style={styles.meta}>
                Cash in hand {formatCurrency(data?.cashInHand ?? 0)} · max{' '}
                {formatCurrency(data?.maxRemit ?? data?.cashInHand ?? 0)}
              </Text>
              <View style={styles.chips}>
                {COD_REMIT_METHODS.map((row) => {
                  const active = method === row.code;
                  return (
                    <Pressable
                      key={row.code}
                      onPress={() => setMethod(row.code)}
                      style={[styles.chip, active && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextOn]}>
                        {row.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                placeholder="Amount (blank = all cash in hand)"
                style={styles.input}
              />
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder={
                  method === 'hub_cash'
                    ? 'Hub slip / locker id'
                    : method === 'upi'
                      ? 'UPI UTR'
                      : 'Bank deposit ref'
                }
                style={styles.input}
              />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note (optional)"
                style={styles.input}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                onPress={() => void onSubmit()}
                disabled={!canSubmit}
                style={[styles.primary, !canSubmit && styles.disabled]}
              >
                {remitCod.isPending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryText}>Record remittance</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.extraBold,
    fontSize: 20,
    color: '#111827',
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F3F4F6',
  },
  chipOn: { backgroundColor: '#111827' },
  chipText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#374151' },
  chipTextOn: { color: '#FFFFFF' },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 46,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  amount: {
    fontFamily: fonts.extraBold,
    fontSize: 22,
    color: '#111827',
  },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  error: { fontFamily: fonts.semiBold, fontSize: 13, color: '#B91C1C' },
  ok: { fontFamily: fonts.bold, fontSize: 14, color: '#15803D' },
  primary: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#EA4B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.extraBold, fontSize: 15, color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
});
