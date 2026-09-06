import { StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/dashboard/format';
import type { RestaurantWallet } from '@/lib/restaurant/finance-types';

const HOLD_DAYS = 15;

type BankSnap = {
  accountMasked?: string;
  ifsc?: string;
  holderName?: string;
  verificationStatus?: string;
} | null;

type Props = {
  wallet?: RestaurantWallet | null;
  bank?: BankSnap;
  oldestCreditAt?: string | null;
};

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
}

/** Settled vs remaining + 15-day due + bank — same truth as admin desk. */
export function SettlementSummaryStrip({
  wallet,
  bank,
  oldestCreditAt,
}: Props) {
  if (!wallet) return null;
  const settled = wallet.lifetimeDebited ?? 0;
  const remaining = wallet.balance ?? 0;
  const beforeCommission =
    wallet.lifetimeCredited +
    (wallet.commissionPercent
      ? (wallet.lifetimeCredited * wallet.commissionPercent) / (100 - wallet.commissionPercent)
      : 0);
  const due = oldestCreditAt ? addDays(oldestCreditAt, HOLD_DAYS) : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Settlement overview</Text>
      <Text style={styles.hint}>
        Delivered orders credit your wallet after platform commission. Payouts
        clear after a {HOLD_DAYS}-day hold from completion.
      </Text>
      <View style={styles.grid}>
        <Cell
          label="Sales (est. gross)"
          value={formatCurrency(beforeCommission || wallet.lifetimeCredited)}
        />
        <Cell
          label="After commission"
          value={formatCurrency(wallet.lifetimeCredited)}
        />
        <Cell label="Settled" value={formatCurrency(settled)} />
        <Cell label="Remaining" value={formatCurrency(remaining)} />
      </View>
      <Text style={styles.meta}>
        Next settlement due:{' '}
        {due
          ? due.toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : 'When eligible credits clear the hold'}
      </Text>
      {bank ? (
        <Text style={styles.meta}>
          Bank:{' '}
          {bank.holderName || 'Account'} · {bank.accountMasked || '••••'} ·{' '}
          {bank.ifsc || 'IFSC'} · {bank.verificationStatus || 'unverified'}
        </Text>
      ) : (
        <Text style={styles.meta}>Bank: add payout account in Settings</Text>
      )}
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel}>{label}</Text>
      <Text style={styles.cellValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: authTheme.border,
    backgroundColor: authTheme.surface,
    padding: 14,
    gap: 8,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: authTheme.text,
  },
  hint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    width: '47%',
    borderRadius: 12,
    backgroundColor: authTheme.bg,
    padding: 10,
  },
  cellLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
    textTransform: 'uppercase',
  },
  cellValue: {
    marginTop: 4,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: authTheme.text,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: authTheme.textMuted,
  },
});
