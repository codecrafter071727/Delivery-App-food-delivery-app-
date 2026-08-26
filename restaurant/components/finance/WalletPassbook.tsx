import { Banknote, Download } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/dashboard/format';
import { restaurantFinanceApi } from '@/lib/restaurant/finance-api';
import type {
  RestaurantWallet,
  RestaurantWalletTxn,
} from '@/lib/restaurant/finance-types';

type LedgerFilter = 'all' | 'order_credit' | 'payout_debit' | 'adjustment';

const FILTERS: { key: LedgerFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'order_credit', label: 'Credits' },
  { key: 'payout_debit', label: 'Paid out' },
  { key: 'adjustment', label: 'Adjust' },
];

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

function formatDateTime(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function txnTitle(txn: RestaurantWalletTxn): string {
  if (txn.type === 'payout_debit') {
    return txn.payoutId
      ? `Bank payout · ${txn.payoutId.slice(-6).toUpperCase()}`
      : 'Bank payout';
  }
  if (txn.orderNumber) return `Order #${txn.orderNumber}`;
  if (txn.orderId) return `Order · ${txn.orderId.slice(-6)}`;
  return txn.description || 'Wallet entry';
}

function txnTypeLabel(type: string): string {
  if (type === 'order_credit') return 'Credit';
  if (type === 'payout_debit') return 'Debit';
  if (type === 'adjustment') return 'Adjustment';
  return type.replace(/_/g, ' ');
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue}>{value}</Text>
    </View>
  );
}

export function WalletPassbook({
  restaurantId,
  wallet,
  txns,
  filter,
  onFilterChange,
  walletError,
  txnsError,
  onRetry,
}: {
  restaurantId: string;
  wallet?: RestaurantWallet | null;
  txns: RestaurantWalletTxn[];
  filter: LedgerFilter;
  onFilterChange: (next: LedgerFilter) => void;
  walletError?: Error | null;
  txnsError?: Error | null;
  onRetry: () => void;
}) {
  const [exporting, setExporting] = useState(false);

  const onExport = async () => {
    if (!restaurantId) return;
    setExporting(true);
    try {
      const { csv, filename, rowCount } =
        await restaurantFinanceApi.exportWalletTransactions(restaurantId, {
          type: filter === 'all' ? undefined : filter,
        });
      const path = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, csv, {
        encoding: 'utf8',
      });
      await Share.share(
        Platform.OS === 'ios'
          ? { url: path, title: 'Wallet passbook' }
          : {
              message: csv.slice(0, 60000),
              title: `Wallet passbook (${rowCount} rows)`,
            }
      );
    } catch (error) {
      Alert.alert(
        'Export failed',
        error instanceof Error ? error.message : 'Could not export passbook.'
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.walletCard}>
        <Text style={styles.walletLabel}>Available balance</Text>
        <Text style={styles.walletBalance}>
          {formatCurrency(wallet?.balance ?? 0)}
        </Text>
        <Text style={styles.muted}>
          Net earnings after {wallet?.commissionPercent ?? 12}% platform fee.
          Admin bank release deducts from this balance.
        </Text>
        <View style={styles.walletMetaRow}>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Lifetime in</Text>
            <Text style={styles.metaValue}>
              {formatCurrency(wallet?.lifetimeCredited ?? 0)}
            </Text>
          </View>
          <View style={styles.metaBox}>
            <Text style={styles.metaLabel}>Paid to bank</Text>
            <Text style={styles.metaValue}>
              {formatCurrency(wallet?.lifetimeDebited ?? 0)}
            </Text>
          </View>
        </View>
        <Text style={styles.mutedSmall}>
          Last credit {formatDateTime(wallet?.lastCreditedAt)} · Last payout{' '}
          {formatDateTime(wallet?.lastDebitedAt)}
        </Text>
        <Pressable
          style={styles.exportBtn}
          disabled={exporting || !restaurantId}
          onPress={() => void onExport()}
        >
          {exporting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Download color="#FFFFFF" size={16} />
          )}
          <Text style={styles.exportText}>Export passbook (CSV)</Text>
        </Pressable>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((item) => {
          const on = filter === item.key;
          return (
            <Pressable
              key={item.key}
              style={[styles.filterChip, on && styles.filterChipOn]}
              onPress={() => onFilterChange(item.key)}
            >
              <Text style={[styles.filterText, on && styles.filterTextOn]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {walletError || txnsError ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Couldn’t load wallet</Text>
          <Text style={styles.mutedDark}>
            {(walletError || txnsError)?.message
              || 'Settlements service is unreachable. Ensure payment-service is running, then retry.'}
          </Text>
          <Pressable style={styles.retry} onPress={onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : txns.length ? (
        txns.map((txn) => {
          const credit = txn.amount >= 0;
          return (
            <View key={txn.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.period}>{txnTitle(txn)}</Text>
                  <Text style={styles.meta}>
                    {formatDate(txn.createdAt)} · {txnTypeLabel(txn.type)}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.net,
                    { color: credit ? '#047857' : '#B91C1C' },
                  ]}
                >
                  {credit ? '+' : ''}
                  {formatCurrency(txn.amount)}
                </Text>
              </View>
              {txn.description ? (
                <Text style={styles.meta}>{txn.description}</Text>
              ) : null}
              <View style={styles.breakdown}>
                {txn.grossAmount != null ? (
                  <Line
                    label="Restaurant charges"
                    value={formatCurrency(txn.grossAmount)}
                  />
                ) : null}
                {txn.commissionAmount != null ? (
                  <Line
                    label="Platform fee"
                    value={formatCurrency(txn.commissionAmount)}
                  />
                ) : null}
                {txn.payoutId ? (
                  <Line
                    label="Payout ref"
                    value={txn.payoutId.slice(-10).toUpperCase()}
                  />
                ) : null}
                <Line
                  label="Balance after"
                  value={formatCurrency(txn.balanceAfter)}
                />
              </View>
            </View>
          );
        })
      ) : (
        <View style={styles.empty}>
          <Banknote color={authTheme.textDim} size={36} />
          <Text style={styles.emptyTitle}>No ledger entries yet</Text>
          <Text style={styles.mutedDark}>
            Delivered orders credit net earnings here. When admin releases a bank
            payout, the amount is deducted on this passbook.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  walletCard: {
    backgroundColor: '#7A0E22',
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  walletLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  walletBalance: {
    fontFamily: fonts.bold,
    fontSize: 32,
    color: '#FFFFFF',
  },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 17,
  },
  mutedDark: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
    textAlign: 'center',
  },
  mutedSmall: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
  },
  walletMetaRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  metaBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12,
    padding: 10,
    gap: 2,
  },
  metaLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  metaValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  exportBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  exportText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#F1F5F9',
  },
  filterChipOn: { backgroundColor: authTheme.brandSoft },
  filterText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  filterTextOn: { color: authTheme.brand },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  period: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  net: {
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  breakdown: { gap: 4, paddingTop: 2 },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  lineLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  lineValue: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.text,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 16,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
    textAlign: 'center',
  },
  retry: {
    alignSelf: 'flex-start',
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
});
