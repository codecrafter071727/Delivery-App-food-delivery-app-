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
import { WalletPassbook } from '@/components/finance/WalletPassbook';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/dashboard/format';
import {
  useRestaurantCommission,
  useRestaurantInvoices,
  useRestaurantSettlement,
  useRestaurantSettlements,
  useRestaurantWallet,
  useRestaurantWalletTransactions,
} from '@/lib/restaurant/finance-hooks';
import type {
  RestaurantInvoice,
  RestaurantSettlement,
} from '@/lib/restaurant/finance-types';

type TabKey = 'wallet' | 'payouts' | 'invoices' | 'fees';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'wallet', label: 'Wallet' },
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

function SettlementCard({
  settlement,
  onPress,
}: {
  settlement: RestaurantSettlement;
  onPress: () => void;
}) {
  const period =
    settlement.periodStart && settlement.periodEnd
      ? `${formatDate(settlement.periodStart)} – ${formatDate(settlement.periodEnd)}`
      : 'Settlement';
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.period}>{settlement.settlementNumber}</Text>
          <Text style={styles.meta}>
            {period} · {settlement.totalOrders} order
            {settlement.totalOrders === 1 ? '' : 's'}
          </Text>
        </View>
        <StatusChip status={settlement.status} />
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.net}>{formatCurrency(settlement.finalPayable)}</Text>
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
  const [tab, setTab] = useState<TabKey>('wallet');
  const [page, setPage] = useState(1);
  const [ledgerFilter, setLedgerFilter] = useState<
    'all' | 'order_credit' | 'payout_debit' | 'adjustment'
  >('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const wallet = useRestaurantWallet();
  const walletTxns = useRestaurantWalletTransactions(
    tab === 'wallet' ? page : 1,
    ledgerFilter
  );
  const payouts = useRestaurantSettlements(tab === 'payouts' ? page : 1);
  const invoices = useRestaurantInvoices(tab === 'invoices' ? page : 1);
  const commission = useRestaurantCommission();
  const detail = useRestaurantSettlement(selectedId);

  const listQuery =
    tab === 'wallet'
      ? walletTxns
      : tab === 'invoices'
        ? invoices
        : tab === 'fees'
          ? commission
          : payouts;
  const restaurantName =
    wallet.restaurantName
    || payouts.restaurantName
    || invoices.restaurantName
    || commission.restaurantName;
  const loading =
    (tab === 'wallet'
      ? wallet.isLoading && !wallet.data
      : listQuery.isLoading && !listQuery.data);
  const refreshing =
    tab === 'wallet'
      ? wallet.isRefetching || walletTxns.isRefetching
      : listQuery.isRefetching;
  const hasNext =
    tab === 'fees' ? false : (listQuery.data as { hasNext?: boolean } | undefined)?.hasNext ?? false;
  const payoutList = payouts.data?.items ?? [];
  const settlementList = payoutList;
  const invoiceList = invoices.data?.items ?? [];
  const txnList = walletTxns.data?.items ?? [];

  const switchTab = (next: TabKey) => {
    setTab(next);
    setPage(1);
  };

  const selectedSummary = settlementList.find((row) => row.id === selectedId);
  const settlement: RestaurantSettlement | undefined = detail.data ?? selectedSummary;

  const onRefresh = () => {
    if (tab === 'wallet') {
      void wallet.refetch();
      void walletTxns.refetch();
      return;
    }
    void listQuery.refetch();
  };

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Finance"
        subtitle={
          restaurantName
            ? `${restaurantName} · wallet after 12% platform fee`
            : 'Wallet, settlements, and fees'
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
            onRefresh={onRefresh}
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
                {item.key === 'wallet' ? (
                  <Banknote
                    color={on ? '#FFFFFF' : authTheme.textMuted}
                    size={14}
                  />
                ) : item.key === 'payouts' ? (
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

        {!loading && listQuery.isError && tab !== 'wallet' ? (
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

        {!loading && tab === 'wallet' ? (
          <View style={styles.list}>
            <WalletPassbook
              restaurantId={wallet.restaurantId}
              wallet={wallet.data}
              txns={txnList}
              filter={ledgerFilter}
              onFilterChange={(next) => {
                setLedgerFilter(next);
                setPage(1);
              }}
              walletError={
                wallet.error instanceof Error ? wallet.error : null
              }
              txnsError={
                walletTxns.error instanceof Error ? walletTxns.error : null
              }
              onRetry={onRefresh}
            />
          </View>
        ) : null}

        {!loading && !listQuery.isError && tab === 'payouts' ? (
          settlementList.length ? (
            <View style={styles.list}>
              {settlementList.map((row) => (
                <SettlementCard
                  key={row.id}
                  settlement={row}
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
            {detail.isLoading && !settlement ? (
              <ActivityIndicator color={authTheme.brand} />
            ) : detail.isError && !settlement ? (
              <Text style={styles.muted}>
                {detail.error instanceof Error
                  ? detail.error.message
                  : 'Could not load this settlement.'}
              </Text>
            ) : settlement ? (
              <>
                <View style={styles.modalHero}>
                  <Text style={styles.modalPeriod}>{settlement.settlementNumber}</Text>
                  <StatusChip status={settlement.status} />
                </View>
                <Text style={styles.net}>{formatCurrency(settlement.finalPayable)}</Text>
                <View style={styles.breakdown}>
                  <Line label="Gross sales" value={formatCurrency(settlement.grossSales)} />
                  <Line
                    label="Commission"
                    value={formatCurrency(settlement.commissionAmount)}
                  />
                  <Line label="Refund impact" value={formatCurrency(settlement.refundImpact)} />
                  <Line label="Orders" value={String(settlement.totalOrders)} />
                  {settlement.payoutStatus ? (
                    <Line label="Payout status" value={settlement.payoutStatus} />
                  ) : null}
                  {settlement.payoutReference ? (
                    <Line label="Reference" value={settlement.payoutReference} />
                  ) : null}
                  <Line label="Paid on" value={formatDate(settlement.paidAt)} />
                </View>
                {settlement.orders?.length ? (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.period}>Included orders</Text>
                    {settlement.orders.slice(0, 8).map((order) => (
                      <Line
                        key={order.orderId}
                        label={order.orderNumber ?? order.orderId.slice(-6)}
                        value={formatCurrency(order.restaurantNetAmount)}
                      />
                    ))}
                  </View>
                ) : null}
                {settlement.failureReason ? (
                  <Text style={styles.fail}>{settlement.failureReason}</Text>
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
  walletCard: {
    backgroundColor: '#FFF7F8',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.1)',
    padding: 16,
    gap: 8,
  },
  walletLabel: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: authTheme.textMuted,
  },
  walletBalance: {
    fontSize: 28,
    fontFamily: fonts.bold,
    color: authTheme.brand,
  },
  walletMeta: { marginTop: 4 },
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
