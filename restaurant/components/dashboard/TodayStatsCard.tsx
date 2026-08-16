import { ShieldCheck, Star } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/dashboard/format';
import type { DashboardMetrics } from '@/lib/dashboard/types';
import { useOutletHygiene, useOutletRatings } from '@/lib/restaurant/hooks';

type Props = {
  restaurantId?: string;
  metrics: DashboardMetrics;
  onRatingPress?: () => void;
};

export function TodayStatsCard({ restaurantId, metrics, onRatingPress }: Props) {
  const hygiene = useOutletHygiene(restaurantId, Boolean(restaurantId));
  const ratings = useOutletRatings(restaurantId, Boolean(restaurantId));
  const hygieneData = hygiene.data;
  const liveRatings = ratings.data?.available ? ratings.data : null;

  const hasRevenue =
    metrics.grossRevenue != null && Number.isFinite(metrics.grossRevenue);
  const hasOrders =
    metrics.totalOrders != null && Number.isFinite(metrics.totalOrders);
  const rating =
    liveRatings?.avgRating ??
    (metrics.rating != null && Number.isFinite(metrics.rating)
      ? metrics.rating
      : null);
  const ratingCount =
    liveRatings?.totalRatings ??
    (metrics.totalRatings != null && Number.isFinite(metrics.totalRatings)
      ? metrics.totalRatings
      : null);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.kicker}>Today</Text>
        <Text style={styles.title}>Business snapshot</Text>
      </View>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.label}>Sales</Text>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
            {hasRevenue ? formatCurrency(metrics.grossRevenue as number) : '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={styles.label}>Orders</Text>
          <Text style={styles.value}>
            {hasOrders ? Math.round(metrics.totalOrders as number) : '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <Pressable
          onPress={onRatingPress}
          disabled={!onRatingPress}
          style={styles.stat}
        >
          <Text style={styles.label}>Rating</Text>
          <View style={styles.valueRow}>
            <Star color="#D97706" size={13} fill="#FBBF24" />
            <Text style={styles.value}>
              {rating != null && rating > 0 ? rating.toFixed(1) : '—'}
            </Text>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {ratingCount
              ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}`
              : hygieneData && !hygieneData.available
                ? 'After listing is live'
                : 'Tap to view'}
          </Text>
        </Pressable>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={styles.label}>Hygiene</Text>
          <View style={styles.valueRow}>
            <ShieldCheck color="#15803D" size={13} />
            <Text style={styles.value}>
              {hygieneData?.available
                ? hygieneData.hygieneScore.toFixed(1)
                : hygiene.isLoading
                  ? '…'
                  : '—'}
            </Text>
          </View>
          <Text style={styles.meta} numberOfLines={1}>
            {hygieneData?.available
              ? hygieneData.fssaiMasked || 'FSSAI'
              : 'After go-live'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  head: {
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  kicker: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  title: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.bold,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  stat: {
    flex: 1,
    paddingHorizontal: 8,
    gap: 4,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: authTheme.cardBorder,
    marginVertical: 4,
  },
  label: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.semiBold,
  },
  value: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  meta: {
    color: authTheme.textDim,
    fontSize: 10,
    fontFamily: fonts.medium,
  },
});
