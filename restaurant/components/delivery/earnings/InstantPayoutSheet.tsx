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
  useFinanceMutations,
  useInstantPayoutEligibility,
  usePartnerPayout,
} from '@/lib/delivery-partner/finance-hooks';
import {
  eligibilityReasonCopy,
  payoutStatusLabel,
  type PartnerPayout,
} from '@/lib/delivery-partner/finance-types';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { useRouter } from 'expo-router';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function InstantPayoutSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const eligibility = useInstantPayoutEligibility(visible);
  const { instantPayout } = useFinanceMutations();
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState<PartnerPayout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const data = eligibility.data;

  useEffect(() => {
    if (!visible) {
      setResult(null);
      setError(null);
      setAmount('');
      return;
    }
    if (data?.maxAmount) {
      setAmount(String(Math.floor(data.maxAmount)));
    }
  }, [visible, data?.maxAmount]);

  const live = usePartnerPayout(result?.payoutId, Boolean(result?.payoutId));
  const payout = live.data ?? result;
  const parsed = Number(amount);
  const omitAmount = !amount.trim();
  const amountForFee = omitAmount
    ? (data?.maxAmount ?? 0)
    : Number.isFinite(parsed)
      ? parsed
      : 0;
  const estimatedFee = data
    ? Math.max(data.feeMin, (amountForFee * data.feePercent) / 100)
    : 0;
  const estimatedNet = Math.max(0, amountForFee - estimatedFee);
  const canSubmit =
    Boolean(data?.eligible && data.bankVerified) &&
    (omitAmount ||
      (Number.isFinite(parsed) &&
        parsed >= (data?.minAmount ?? 200) &&
        parsed <= (data?.maxAmount ?? parsed))) &&
    !instantPayout.isPending;

  const onSubmit = async () => {
    setError(null);
    try {
      const created = await instantPayout.mutateAsync(
        omitAmount || !Number.isFinite(parsed) ? undefined : parsed
      );
      setResult(created);
    } catch (err) {
      setError(formatFinanceError(err, 'Could not request instant payout.'));
    }
  };

  const statusKey = (payout?.status ?? '').toLowerCase();
  const paid = statusKey === 'paid' && Boolean(payout?.paidAt);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Instant payout</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
              <X color="#6B7280" size={20} />
            </Pressable>
          </View>

          {eligibility.isLoading && !data ? (
            <ActivityIndicator color="#EA4B14" />
          ) : eligibility.isError && !data ? (
            <View style={styles.block}>
              <Text style={styles.error}>
                {formatFinanceError(eligibility.error, 'Could not check eligibility.')}
              </Text>
              <Pressable onPress={() => void eligibility.refetch()} style={styles.primary}>
                <Text style={styles.primaryText}>Retry</Text>
              </Pressable>
            </View>
          ) : payout ? (
            <View style={styles.block}>
              <Text style={[styles.status, paid ? styles.paid : styles.pending]}>
                {paid ? 'Paid' : payoutStatusLabel(payout.status)}
              </Text>
              <Text style={styles.amount}>
                {formatCurrency(payout.netAmount, 'INR')} to {payout.bankAccountMasked ?? 'bank'}
              </Text>
              <Text style={styles.meta}>
                Gross {formatCurrency(payout.grossAmount)} · fee{' '}
                {formatCurrency(payout.feeAmount)}
                {payout.tdsAmount ? ` · TDS ${formatCurrency(payout.tdsAmount)}` : ''}
              </Text>
              {!paid ? (
                <Text style={styles.hint}>
                  {statusKey === 'processing'
                    ? 'Sent to the payout gateway. This stays Processing until the bank confirms — we never mark Paid locally.'
                    : payout.failureReason ||
                      'Gateway is pending. Paid appears only after payment-service confirms.'}
                </Text>
              ) : null}
              <Pressable onPress={onClose} style={styles.primary}>
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.block}>
              <Text style={styles.meta}>
                Available {formatCurrency(data?.availableBalance ?? 0)} · min{' '}
                {formatCurrency(data?.minAmount ?? 200)}
              </Text>
              {data?.bankVerified ? (
                <Text style={styles.ok}>Bank verified</Text>
              ) : (
                <Pressable onPress={() => router.push(DELIVERY_ROUTES.profile)}>
                  <Text style={styles.error}>
                    Bank must be penny-drop verified. Open Profile to add / verify.
                  </Text>
                </Pressable>
              )}
              {data?.reasons.map((code) => (
                <Text key={code} style={styles.error}>
                  {eligibilityReasonCopy(code)}
                </Text>
              ))}
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                placeholder="Amount"
                style={styles.input}
              />
              <Text style={styles.meta}>
                Est. fee {formatCurrency(estimatedFee)} · you receive{' '}
                {formatCurrency(estimatedNet)}
              </Text>
              {data?.dailyRemainingCount != null ? (
                <Text style={styles.meta}>
                  Today left: {formatCurrency(data.dailyRemainingAmount ?? 0)} ·{' '}
                  {data.dailyRemainingCount} instant payouts
                </Text>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                onPress={() => void onSubmit()}
                disabled={!canSubmit}
                style={[styles.primary, !canSubmit && styles.disabled]}
              >
                {instantPayout.isPending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryText}>Request payout</Text>
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
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
    fontFamily: fonts.semiBold,
    fontSize: 16,
  },
  amount: {
    fontFamily: fonts.extraBold,
    fontSize: 22,
    color: '#111827',
  },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  hint: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#B45309',
    lineHeight: 18,
  },
  error: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#B91C1C',
  },
  ok: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#15803D',
  },
  status: {
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  paid: { color: '#15803D' },
  pending: { color: '#B45309' },
  primary: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#EA4B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: fonts.extraBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  disabled: { opacity: 0.45 },
});
