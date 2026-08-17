import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { formatFinanceError } from '@/lib/delivery-partner/finance-api';
import { usePartnerPayout } from '@/lib/delivery-partner/finance-hooks';
import { payoutStatusLabel } from '@/lib/delivery-partner/finance-types';

type Props = {
  visible: boolean;
  payoutId: string | null;
  onClose: () => void;
};

function when(iso?: string | null) {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PayoutDetailSheet({ visible, payoutId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const query = usePartnerPayout(payoutId ?? undefined, visible && Boolean(payoutId));
  const payout = query.data;
  const status = (payout?.status ?? '').toLowerCase();
  const paid = status === 'paid' && Boolean(payout?.paidAt);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Payout</Text>
            <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
              <X color="#6B7280" size={20} />
            </Pressable>
          </View>

          {query.isLoading && !payout ? (
            <ActivityIndicator color="#EA4B14" />
          ) : query.isError && !payout ? (
            <View style={styles.block}>
              <Text style={styles.error}>
                {formatFinanceError(query.error, 'Could not load payout.')}
              </Text>
              <Pressable onPress={() => void query.refetch()} style={styles.primary}>
                <Text style={styles.primaryText}>Retry</Text>
              </Pressable>
            </View>
          ) : payout ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[styles.status, paid ? styles.paid : styles.pending]}>
                {paid ? 'Paid' : payoutStatusLabel(payout.status)}
              </Text>
              <Text style={styles.amount}>{formatCurrency(payout.netAmount)}</Text>
              <Text style={styles.meta}>
                {payout.kind === 'instant' ? 'Instant' : 'Weekly'} ·{' '}
                {payout.bankAccountMasked ?? 'Bank'} {payout.ifscCode ?? ''}
              </Text>
              <View style={styles.rows}>
                <Row label="Gross" value={formatCurrency(payout.grossAmount)} />
                <Row label="Fee" value={formatCurrency(payout.feeAmount)} />
                <Row label="TDS" value={formatCurrency(payout.tdsAmount)} />
                <Row label="Requested" value={when(payout.requestedAt)} />
                <Row label="Paid at" value={paid ? when(payout.paidAt) : 'Not paid yet'} />
                {payout.gatewayPayoutId ? (
                  <Row label="Gateway id" value={payout.gatewayPayoutId} />
                ) : null}
              </View>
              {!paid ? (
                <Text style={styles.hint}>
                  {payout.failureReason ||
                    (status === 'processing'
                      ? 'Refreshing from payment-service. Paid appears only after the gateway confirms.'
                      : 'Pending until the payout gateway accepts this transfer.')}
                </Text>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
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
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontFamily: fonts.extraBold, fontSize: 20, color: '#111827' },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { gap: 10 },
  amount: { fontFamily: fonts.extraBold, fontSize: 26, color: '#111827' },
  meta: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280', marginTop: 4 },
  status: { fontFamily: fonts.bold, fontSize: 14, marginBottom: 4 },
  paid: { color: '#15803D' },
  pending: { color: '#B45309' },
  hint: {
    marginTop: 12,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#B45309',
    lineHeight: 18,
  },
  error: { fontFamily: fonts.semiBold, fontSize: 13, color: '#B91C1C' },
  rows: { marginTop: 16, gap: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  rowValue: { fontFamily: fonts.semiBold, fontSize: 13, color: '#111827', flex: 1, textAlign: 'right' },
  primary: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
});
