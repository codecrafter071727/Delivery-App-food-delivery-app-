import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DeliveryHeaderActions } from '@/components/delivery/shared/HeaderActions';
import { BRAND_NAME } from '@/constants/theme';
import { fonts } from '@/constants/typography';
import { useDeliveryPartnerMe } from '@/lib/delivery-partner/hooks';
import { useAuthStore } from '@/store/auth-store';

const tokajoLogo = require('../../../assets/tokajo-logo.png');

function partnerDisplayId(id?: string) {
  if (!id) return 'ID: —';
  const clean = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const short = clean.slice(-8) || clean;
  return `ID: DP${short}`;
}

/**
 * Maroon home hero — place inside the home ScrollView so it scrolls
 * (not fixed to the top of the screen).
 */
export function DeliveryHomeHeader() {
  const insets = useSafeAreaInsets();
  const authUser = useAuthStore((s) => s.user);
  const me = useDeliveryPartnerMe();
  const profile = me.data;

  const displayName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
    profile?.name ||
    [authUser?.firstName, authUser?.lastName].filter(Boolean).join(' ') ||
    authUser?.email ||
    'Partner';
  const firstName = displayName.split(' ')[0] || displayName;
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const isOnline = Boolean(profile?.isOnline ?? profile?.isAvailable);
  const partnerId = partnerDisplayId(profile?.id || profile?.userId);
  const vehicle =
    profile?.vehicle?.type ||
    profile?.vehicleType ||
    profile?.vehicle?.model ||
    '';

  return (
    <View style={[styles.shell, { paddingTop: Math.max(insets.top, 16) }]}>
      <View style={styles.topRow}>
        <View style={styles.profileLeft}>
          <View style={styles.profileBtn}>
            {profile?.photoUrl ? (
              <Image source={{ uri: profile.photoUrl }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.initials}>{firstName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </View>
          <View style={styles.titleStack}>
            <Text style={styles.heroName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.heroMeta} numberOfLines={1}>
              {vehicle || 'Berlin'}
            </Text>
          </View>
        </View>

        <DeliveryHeaderActions onBrand={false} hideProfile />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    marginBottom: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  profileLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  profileBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D1D5DB',
  },
  initials: {
    color: '#374151',
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  titleStack: {
    flex: 1,
    justifyContent: 'center',
  },
  heroName: {
    color: '#000000',
    fontSize: 20,
    fontFamily: fonts.bold,
  },
  heroMeta: {
    marginTop: 2,
    color: '#374151',
    fontSize: 14,
    fontFamily: fonts.medium,
  },
});
