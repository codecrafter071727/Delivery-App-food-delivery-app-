import { Star } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { DashboardMetrics } from '@/lib/dashboard/types';

type Props = {
  metrics: DashboardMetrics;
  onRatingPress?: () => void;
};

export function MetricCards({ metrics, onRatingPress }: Props) {
  const hasRating = metrics.rating != null && Number.isFinite(metrics.rating);
  const hasDelivery =
    metrics.avgDeliveryMinutes != null &&
    Number.isFinite(metrics.avgDeliveryMinutes);
  const hasOrders =
    metrics.totalOrders != null && Number.isFinite(metrics.totalOrders);

  return (
    <View style={[styles.section, { flex: 1 }]}>
      <Text style={styles.sectionTitle}>At a glance</Text>

      <View style={[styles.card, styles.squareCard]}>
        <Pressable
          onPress={onRatingPress}
          disabled={!onRatingPress}
          style={styles.statSquare}
        >
          <Text style={styles.statLabel}>Rating</Text>
          <View style={styles.valueRow}>
            <Star color="#D97706" size={12} fill="#FBBF24" />
            <Text style={styles.statValue}>
              {hasRating ? (metrics.rating as number).toFixed(1) : '—'}
            </Text>
          </View>
        </Pressable>

        <View style={styles.statDividerH} />

        <View style={styles.statSquare}>
          <Text style={styles.statLabel}>Orders</Text>
          <Text style={styles.statValue}>
            {hasOrders ? Math.round(metrics.totalOrders as number) : '—'}
          </Text>
        </View>

        <View style={styles.statDividerH} />

        <View style={styles.statSquare}>
          <Text style={styles.statLabel}>Avg delivery</Text>
          <Text style={styles.statValue}>
            {hasDelivery
              ? `${Math.round(metrics.avgDeliveryMinutes as number)}m`
              : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: authTheme.text,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  squareCard: {
    padding: 14,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  statSquare: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statDividerH: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: authTheme.cardBorder,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
  },
});
