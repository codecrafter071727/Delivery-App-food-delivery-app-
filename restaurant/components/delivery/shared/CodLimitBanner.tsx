import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { useCodLimitStatus } from '@/lib/delivery-partner/finance-hooks';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';

/** Live COD cap from GET /partners/me/cod/limit-status */
export function CodLimitBanner() {
  const router = useRouter();
  const query = useCodLimitStatus(true);
  const data = query.data;
  if (!data) return null;
  if (!data.blocked && !data.remitDueToday && data.usedPercent < 50) {
    return null;
  }

  const blocked = data.blocked || data.blocksNewCodOrders;
  const copy =
    data.message?.trim() ||
    (blocked
      ? `COD limit reached (${formatCurrency(data.cashInHand)} / ${formatCurrency(data.limit)}). Remit cash to accept new COD orders.`
      : `Cash in hand ${formatCurrency(data.cashInHand)} — remit today so you stay under ${formatCurrency(data.limit)}.`);

  return (
    <View style={[styles.bar, blocked ? styles.barBlocked : styles.barWarn]}>
      <Text style={styles.text}>{copy}</Text>
      <Pressable
        onPress={() => router.push(DELIVERY_ROUTES.earnings)}
        hitSlop={8}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>Remit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 8,
  },
  barWarn: {
    backgroundColor: '#FFF7ED',
  },
  barBlocked: {
    backgroundColor: '#FEF2F2',
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: '#1F2937',
  },
  cta: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  ctaText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#EA4B14',
  },
});
