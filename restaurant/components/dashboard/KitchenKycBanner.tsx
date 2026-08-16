import { ChevronRight, ShieldCheck } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { isListingLive } from '@/lib/restaurant/listing-status';
import { useOnboardingStatus } from '@/lib/restaurant/onboarding-hooks';

type Props = {
  restaurantId?: string;
  onPress: () => void;
};

export function KitchenKycBanner({ restaurantId, onPress }: Props) {
  const query = useOnboardingStatus(restaurantId, Boolean(restaurantId));
  const status = query.data;
  if (!status || isListingLive(status.listingStatus)) return null;

  const waiting =
    status.kycStatus === 'submitted' || status.kycStatus === 'under_review';
  const rejected = status.kycStatus === 'rejected';

  return (
    <Pressable onPress={onPress}>
      <View
        style={[
          styles.card,
          rejected ? styles.rejected : waiting ? styles.waiting : styles.draft,
        ]}
      >
        <View style={styles.icon}>
          <ShieldCheck
            color={rejected ? '#B91C1C' : waiting ? '#B45309' : authTheme.brand}
            size={18}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>
            {rejected
              ? 'KYC needs changes'
              : waiting
                ? 'Listing under review'
                : 'Complete KYC to go live'}
          </Text>
          <Text style={styles.meta} numberOfLines={2}>
            {rejected && status.rejectReason
              ? status.rejectReason
              : waiting
                ? 'Ops has not approved yet. Submitting KYC does not go live.'
                : `${status.percent}% done · FSSAI is required to submit.`}
          </Text>
        </View>
        <ChevronRight color={authTheme.textDim} size={16} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  draft: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  waiting: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  rejected: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  meta: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
});
