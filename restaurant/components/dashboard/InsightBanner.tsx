import { TrendingUp } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { DashboardInsight } from '@/lib/dashboard/types';

type Props = {
  insight: DashboardInsight;
};

export function InsightBanner({ insight }: Props) {
  const title = insight.title.replace(/\n/g, ' ');

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.eyebrow}>Today’s insight</Text>
        <View style={styles.trendChip}>
          <TrendingUp color={authTheme.brand} size={12} />
          <Text style={styles.trendText}>
            {insight.trendPercent >= 0 ? '+' : ''}
            {insight.trendPercent}%
          </Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{insight.subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  eyebrow: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  trendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: authTheme.brandSoft,
  },
  trendText: {
    color: authTheme.brand,
    fontSize: 12,
    fontFamily: fonts.extraBold,
  },
  title: {
    color: authTheme.text,
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 6,
    color: authTheme.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: fonts.medium,
  },
});
