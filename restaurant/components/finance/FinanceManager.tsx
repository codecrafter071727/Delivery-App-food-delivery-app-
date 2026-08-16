import {
  Banknote,
  ChevronRight,
  Percent,
  Receipt,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/dashboard/format';
import {
  useRestaurantCommission,
  useRestaurantInvoices,
  useRestaurantPayout,
  useRestaurantPayouts,
} from '@/lib/restaurant/finance-hooks';
import type {
  PayoutStatus,
  RestaurantInvoice,
  RestaurantPayout,
} from '@/lib/restaurant/finance-types';

type TabKey = 'payouts' | 'invoices' | 'fees';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'payouts', label: 'Settlements' },
  { key: 'invoices', label: 'Invoices' },
  { key: 'fees', label: 'Fees' },
];

const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  paid: { bg: '#ECFDF5', fg: '#047857', label: 'Paid' },
  pending: { bg: '#FFFBEB', fg: '#B45309', label: 'Upcoming' },
  processing: { bg: '#EFF6FF', fg: '#1D4ED8', label: 'Processing' },
  failed: { bg: '#FEF2F2', fg: '#B91C1C', label: 'Failed' },
  on_hold: { bg: '#F8FAFC', fg: '#475569', label: 'On hold' },
};

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function StatusChip({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? {
    bg: authTheme.surface,
    fg: authTheme.textMuted,
    label: status.replace(/_/g, ' '),
  };
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <Text style={[styles.chipText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

function PayoutCard({
  payout,
  onPress,
}: {
  payout: RestaurantPayout;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.period}>{payout.period || 'Settlement'}</Text>
          <Text style={styles.meta}>
            {payout.ordersCount} order{payout.ordersCount === 1 ? '' : 's'}
            {payout.kind === 'instant' ? ' · Instant' : ' · Weekly'}
          </Text>
        </View>
        <StatusChip status={payout.status} />
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.net}>{formatCurrency(payout.netAmount)}</Text>
        <ChevronRight color={authTheme.textDim} size={18} />
      </View>
    </Pressable>
  );
}

function InvoiceCard({ invoice }: { invoice: RestaurantInvoice }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.period}>{invoice.invoiceId}</Text>
          <Text style={styles.meta}>
            {invoice.period} · GST {formatCurrency(invoice.gstOnCommission)}
          </Text>
        </View>
        <StatusChip status={invoice.status} />
      </View>
      <View style={styles.breakdown}>
        <Line label="Gross" value={formatCurrency(invoice.grossAmount)} />
        <Line label="Commission" value={formatCurrency(invoice.commissionAmount)} />
        <Line label="TDS" value={formatCurrency(invoice.tdsAmount)} />
        <Line label="Net payout" value={formatCurrency(invoice.netAmount)} />
        <Line label="Issued" value={formatDate(invoice.issuedAt)} />
      </View>
    </View>
  );
}

export function FinanceManager() {
  const [tab, setTab] = useState<TabKey>('payouts');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const payouts = useRestaurantPayouts(tab === 'payouts' ? page : 1);
  const invoices = useRestaurantInvoices(tab === 'invoices' ? page : 1);
  const commission = useRestaurantCommission();
  const detail = useRestaurantPayout(selectedId);

  const listQuery =
    tab === 'invoices' ? invoices : tab === 'fees' ? commission : payouts;
  const restaurantName =
    payouts.restaurantName || invoices.restaurantName || commission.restaurantName;
  const loading = listQuery.isLoading && !listQuery.data;
  const refreshing = listQuery.isRefetching;
  const hasNext =
    tab === 'fees' ? false : (listQuery.data as { hasNext?: boolean } | undefined)?.hasNext ?? false;
  const payoutList = payouts.data?.items ?? [];
  const invoiceList = invoices.data?.items ?? [];

  const switchTab = (next: TabKey) => {
    setTab(next);
    setPage(1);
  };

  const selectedSummary = payoutList.find((row) => row.id === selectedId);
  const payout: RestaurantPayout | undefined = detail.data ?? selectedSummary;

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Payouts"
        subtitle={
          restaurantName
            ? `${restaurantName} · weekly settlements`
            : 'Settlements and GST invoices'
        }
        showBack
        hideProfile
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void listQuery.refetch()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.tabGroup}>
          {TABS.map((item) => {
            const on = item.key === tab;
            return (
              <Pressable
                key={item.key}
                onPress={() => switchTab(item.key)}
                style={[styles.tab, on && styles.tabActive]}
              >
                {item.key === 'payouts' ? (
                  <Banknote
                    color={on ? '#FFFFFF' : authTheme.textMuted}
                    size={14}
                  />
                ) : item.key === 'invoices' ? (
                  <Receipt
                    color={on ? '#FFFFFF' : authTheme.textMuted}
                    size={14}
                  />
                ) : (
                  <Percent
                    color={on ? '#FFFFFF' : authTheme.textMuted}
                    size={14}
                  />
                )}
                <Text style={[styles.tabText, on && styles.tabTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : null}

        {!loading && listQuery.isError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn’t load {tab}</Text>
            <Text style={styles.muted}>
              {listQuery.error instanceof Error
                ? listQuery.error.message
                : 'Please try again'}
            </Text>
            <Pressable style={styles.retry} onPress={() => void listQuery.refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !listQuery.isError && tab === 'payouts' ? (
          payoutList.length ? (
            <View style={styles.list}>
              {payoutList.map((row) => (
                <PayoutCard
                  key={row.id}
                  payout={row}
                  onPress={() => setSelectedId(row.id)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.empty}>
              <Banknote color={authTheme.textDim} size={36} />
              <Text style={styles.emptyTitle}>No settlements yet</Text>
              <Text style={styles.muted}>
                Weekly payouts appear here after delivered orders are closed.
              </Text>
            </View>
          )
        ) : null}

        {!loading && !listQuery.isError && tab === 'invoices' ? (
          invoiceList.length ? (
            <View style={styles.list}>
              {invoiceList.map((row) => (
                <InvoiceCard
                  key={`${row.invoiceId}-${row.payoutId}`}
                  invoice={row}
                />
              ))}
            </View>
          ) : (
            <View style={styles.empty}>
              <Receipt color={authTheme.textDim} size={36} />
              <Text style={styles.emptyTitle}>No invoices yet</Text>
              <Text style={styles.muted}>
                GST invoices are generated from each settlement cycle.
              </Text>
            </View>
          )
        ) : null}

        {!loading && !listQuery.isError && tab === 'fees' && commission.data ? (
          <View style={styles.card}>
            <View style={styles.cardTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.period}>
                  {commission.data.commissionPercent}% platform fee
                </Text>
                <Text style={styles.meta}>
                  {commission.data.source === 'restaurant_override'
                    ? 'Custom outlet rate'
                    : 'Platform default'}
                  {commission.data.effectiveFrom
                    ? ` · from ${formatDate(commission.data.effectiveFrom)}`
                    : ''}
                </Text>
              </View>
            </View>
            <Text style={styles.net}>
              {commission.data.tdsPercent}% TDS
            </Text>
            <View style={styles.breakdown}>
              {commission.data.feeSchedule.map((row) => (
                <View key={row.id || row.label} style={{ gap: 2 }}>
                  <Line
                    label={row.label}
                    value={
                      row.type === 'flat'
                        ? formatCurrency(row.value)
                        : `${row.value}%`
                    }
                  />
                  {row.description ? (
                    <Text style={styles.meta}>{row.description}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {!loading && !listQuery.isError && (page > 1 || hasNext) && tab !== 'fees' ? (
          <View style={styles.pager}>
            <Pressable
              disabled={page <= 1 || listQuery.isFetching}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              style={[styles.pageBtn, page <= 1 && styles.disabled]}
            >
              <Text style={styles.pageBtnText}>Previous</Text>
            </Pressable>
            <Pressable
              disabled={!hasNext || listQuery.isFetching}
              onPress={() => setPage((p) => p + 1)}
              style={[styles.pageBtn, !hasNext && styles.disabled]}
            >
              <Text style={styles.pageBtnText}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={Boolean(selectedId)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Settlement</Text>
              <Pressable onPress={() => setSelectedId(null)}>
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>
            {detail.isLoading && !payout ? (
              <ActivityIndicator color={authTheme.brand} />
            ) : detail.isError && !payout ? (
              <Text style={styles.muted}>
                {detail.error instanceof Error
                  ? detail.error.message
                  : 'Could not load this settlement.'}
              </Text>
            ) : payout ? (
              <>
                <View style={styles.modalHero}>
                  <Text style={styles.modalPeriod}>{payout.period}</Text>
                  <StatusChip status={payout.status as PayoutStatus} />
                </View>
                <Text style={styles.net}>{formatCurrency(payout.netAmount)}</Text>
                <View style={styles.breakdown}>
                  <Line label="Gross sales" value={formatCurrency(payout.grossAmount)} />
                  <Line
                    label={`Commission (${Math.round(payout.commissionRate <= 1 ? payout.commissionRate * 100 : payout.commissionRate)}%)`}
                    value={formatCurrency(payout.commissionAmount)}
                  />
                  <Line label="TDS" value={formatCurrency(payout.tdsAmount)} />
                  {payout.feeAmount > 0 ? (
                    <Line label="Fee" value={formatCurrency(payout.feeAmount)} />
                  ) : null}
                  <Line
                    label="Orders"
                    value={String(payout.ordersCount)}
                  />
                  <Line
                    label="Bank"
                    value={
                      payout.bankLast4
                        ? `•••• ${payout.bankLast4}${payout.ifscCode ? ` · ${payout.ifscCode}` : ''}`
                        : 'On file'
                    }
                  />
                  <Line label="Paid on" value={formatDate(payout.paidAt)} />
                </View>
                {payout.failureReason ? (
                  <Text style={styles.fail}>{payout.failureReason}</Text>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14, paddingTop: 12 },
  tabGroup: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.08)',
    padding: 4,
    gap: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9,
  },
  tabActive: { backgroundColor: authTheme.brand },
  tabText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  tabTextActive: { color: '#FFFFFF' },
  list: { gap: 10 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  period: { color: authTheme.text, fontSize: 15, fontFamily: fonts.bold },
  meta: { color: authTheme.textMuted, fontSize: 12, fontFamily: fonts.medium, marginTop: 2 },
  net: { color: authTheme.text, fontSize: 22, fontFamily: fonts.extraBold },
  chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 11, fontFamily: fonts.bold },
  breakdown: { gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  lineLabel: { color: authTheme.textMuted, fontSize: 13, fontFamily: fonts.medium },
  lineValue: { color: authTheme.text, fontSize: 13, fontFamily: fonts.semiBold },
  center: { paddingVertical: 48, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { color: authTheme.text, fontSize: 16, fontFamily: fonts.bold },
  muted: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
    lineHeight: 18,
  },
  retry: {
    marginTop: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: fonts.bold },
  pager: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  pageBtn: {
    backgroundColor: authTheme.surface,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pageBtnText: { color: authTheme.text, fontFamily: fonts.semiBold, fontSize: 13 },
  disabled: { opacity: 0.45 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { color: authTheme.text, fontSize: 18, fontFamily: fonts.bold },
  modalHero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalPeriod: { color: authTheme.text, fontSize: 16, fontFamily: fonts.bold },
  fail: { color: authTheme.error, fontSize: 13, fontFamily: fonts.medium },
});
