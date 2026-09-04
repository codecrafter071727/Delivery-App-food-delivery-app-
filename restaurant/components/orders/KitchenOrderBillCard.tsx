import { Banknote } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { OwnerOrder } from '@/lib/dashboard/types';
import { buildRestaurantBill } from '@/lib/order/restaurant-bill';
import { displayStatus, money } from '@/lib/order/ui';

type Props = {
  order: OwnerOrder;
};

/**
 * Kitchen-facing settlement preview — food only, commission, wallet credit.
 * Matches partner orange theme; no customer GMV / packaging / GST.
 */
export function KitchenOrderBillCard({ order }: Props) {
  const bill = buildRestaurantBill(order);
  const delivered = String(order.status ?? '').toLowerCase() === 'delivered';
  const paymentMethod = order.paymentMethod?.replace(/_/g, ' ');

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Banknote color={authTheme.brand} size={16} />
        <Text style={styles.cardTitle}>Your earnings</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Item total</Text>
        <Text style={styles.value}>{money(bill.itemTotal)}</Text>
      </View>
      {bill.discount > 0 ? (
        <View style={styles.row}>
          <Text style={styles.label}>Discount</Text>
          <Text style={styles.value}>−{money(bill.discount)}</Text>
        </View>
      ) : null}

      <View style={[styles.row, styles.divider]}>
        <Text style={styles.midLabel}>Food total</Text>
        <Text style={styles.midValue}>{money(bill.restaurantCharges)}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>
          Platform commission ({bill.commissionPercent}%)
        </Text>
        <Text style={styles.commission}>−{money(bill.commissionAmount)}</Text>
      </View>

      <View style={styles.earnBox}>
        <View>
          <Text style={styles.earnKicker}>
            {delivered ? 'Credited to wallet' : 'You earn after delivery'}
          </Text>
          <Text style={styles.earnHint}>Food only · fees stay with platform</Text>
        </View>
        <Text style={styles.earnAmount}>{money(bill.youEarn)}</Text>
      </View>

      {paymentMethod ? (
        <View style={styles.row}>
          <Text style={styles.label}>Payment</Text>
          <Text style={styles.value}>
            {paymentMethod}
            {order.paymentStatus
              ? ` · ${displayStatus(order.paymentStatus)}`
              : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 12,
  },
  label: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  value: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
    textAlign: 'right',
  },
  divider: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  midLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  midValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  commission: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  earnBox: {
    marginTop: 10,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: authTheme.brandSoft,
    borderWidth: 1,
    borderColor: authTheme.brandMuted,
  },
  earnKicker: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: authTheme.brandDark,
  },
  earnHint: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
  },
  earnAmount: {
    fontFamily: fonts.extraBold,
    fontSize: 20,
    color: authTheme.brand,
    letterSpacing: -0.3,
  },
});
