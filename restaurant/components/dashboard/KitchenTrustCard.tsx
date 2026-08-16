import { ShieldCheck, Star } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useOutletHygiene, useOutletRatings } from '@/lib/restaurant/hooks';

type Props = {
  restaurantId: string;
  onRatingsPress?: () => void;
};

const STARS = [5, 4, 3, 2, 1] as const;

export function KitchenTrustCard({ restaurantId, onRatingsPress }: Props) {
  const hygiene = useOutletHygiene(restaurantId, Boolean(restaurantId));
  const ratings = useOutletRatings(restaurantId, Boolean(restaurantId));
  const hygieneData = hygiene.data;
  const ratingsData = ratings.data;
  const total = ratingsData?.totalRatings ?? 0;
  const maxBar = Math.max(
    1,
    ...STARS.map((star) => ratingsData?.breakdown[star] ?? 0)
  );

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Customer trust</Text>
      <View style={styles.row}>
        <View style={styles.hygiene}>
          <View style={styles.iconWrap}>
            <ShieldCheck color="#15803D" size={18} />
          </View>
          <Text style={styles.label}>Hygiene</Text>
          {hygieneData && !hygieneData.available ? (
            <Text style={styles.muted}>
              {hygieneData.message ?? 'After listing is live'}
            </Text>
          ) : (
            <>
              <Text style={styles.score}>
                {hygieneData
                  ? hygieneData.hygieneScore.toFixed(1)
                  : hygiene.isLoading
                    ? '…'
                    : '—'}
              </Text>
              <Text style={styles.meta} numberOfLines={2}>
                FSSAI {hygieneData?.fssaiMasked || '—'}
                {hygieneData?.lastAuditAt
                  ? `\nAudit ${new Date(hygieneData.lastAuditAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
                  : ''}
              </Text>
            </>
          )}
        </View>

        <Pressable
          onPress={onRatingsPress}
          disabled={!onRatingsPress}
          style={styles.ratings}
        >
          <View style={styles.ratingHead}>
            <Star color="#D97706" size={14} fill="#FBBF24" />
            <Text style={styles.avg}>
              {ratingsData?.available
                ? ratingsData.avgRating.toFixed(1)
                : ratings.isLoading
                  ? '…'
                  : '—'}
            </Text>
            <Text style={styles.meta}>
              {ratingsData?.available
                ? `${total} rating${total === 1 ? '' : 's'}`
                : ratingsData?.message ?? 'After listing is live'}
            </Text>
          </View>
          {ratingsData?.available ? (
            <View style={{ gap: 4, marginTop: 8 }}>
              {STARS.map((star) => {
                const count = ratingsData.breakdown[star];
                return (
                  <View key={star} style={styles.barRow}>
                    <Text style={styles.barLabel}>{star}</Text>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { width: `${Math.round((count / maxBar) * 100)}%` },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </Pressable>
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
    padding: 14,
    gap: 10,
  },
  kicker: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', gap: 12 },
  hygiene: { width: 112, gap: 4 },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  score: {
    color: authTheme.text,
    fontSize: 22,
    fontFamily: fonts.extraBold,
  },
  meta: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.medium,
  },
  muted: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 16,
  },
  ratings: { flex: 1 },
  ratingHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  avg: {
    color: authTheme.text,
    fontSize: 22,
    fontFamily: fonts.extraBold,
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: {
    width: 10,
    color: authTheme.textMuted,
    fontSize: 10,
    fontFamily: fonts.bold,
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#F59E0B',
  },
});
