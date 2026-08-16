import { Wallet } from 'lucide-react-native';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/dashboard/format';
import type { DashboardMetrics } from '@/lib/dashboard/types';

type Props = {
  metrics: DashboardMetrics;
};

const CHART_HEIGHT = 88;

export function RevenueCard({ metrics }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const hasRevenue =
    metrics.grossRevenue != null && Number.isFinite(metrics.grossRevenue);
  const trend =
    metrics.revenueTrendPercent != null &&
    Number.isFinite(metrics.revenueTrendPercent)
      ? metrics.revenueTrendPercent
      : null;
  return (
    <View style={[styles.section, { flex: 1 }]}>
      <Text style={styles.sectionTitle}>Gross revenue</Text>

      <View style={[styles.card, styles.squareCard]}>
        <View style={styles.iconWrap}>
          <Wallet color={authTheme.brand} size={16} />
        </View>
        <View>
          <Text style={styles.label}>This week</Text>
          <Text style={styles.amount} numberOfLines={1} adjustsFontSizeToFit>
            {hasRevenue
              ? formatCurrency(metrics.grossRevenue as number)
              : '—'}
          </Text>
          {trend != null ? (
            <Text
              style={[
                styles.trend,
                { color: trend >= 0 ? '#15803D' : authTheme.error },
              ]}
              numberOfLines={1}
            >
              {trend >= 0 ? '+' : ''}
              {Math.round(trend)}% vs yesterday
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function shortLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return '—';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return parts[0].slice(0, 3);
  return trimmed.slice(0, 3);
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 16,
  },
  squareCard: {
    padding: 14,
    minHeight: 110,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
  },
  amount: {
    marginTop: 2,
    fontFamily: fonts.extraBold,
    fontSize: 20,
    color: authTheme.text,
    letterSpacing: -0.4,
  },
  trend: {
    marginTop: 4,
    fontSize: 11,
    fontFamily: fonts.semiBold,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
