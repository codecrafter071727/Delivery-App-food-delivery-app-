import { LinearGradient } from 'expo-linear-gradient';
import { Bike, LogOut } from 'lucide-react-native';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useAuthStore } from '@/store/auth-store';

/** Minimal delivery-partner hub until a dedicated Figma screen exists. */
export function DeliveryDashboardFallback() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'Partner';

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={['#7A0E22', '#5A0A18']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + 16 }]}
      >
        <View style={styles.row}>
          <View style={styles.left}>
            <View style={styles.icon}>
              <Bike color="#FFFFFF" size={24} />
            </View>
            <View>
              <Text style={styles.role}>Delivery Partner</Text>
              <Text style={styles.name}>{displayName}</Text>
            </View>
          </View>
          <Pressable
            onPress={() =>
              Alert.alert('Log out?', 'You will need to sign in again.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Log out',
                  style: 'destructive',
                  onPress: async () => {
                    await logout();
                    router.replace('/login');
                  },
                },
              ])
            }
            style={styles.logout}
          >
            <LogOut color="#FFFFFF" size={20} />
          </Pressable>
        </View>
      </LinearGradient>
      <View style={styles.body}>
        <Text style={styles.message}>Delivery dashboard UI is coming soon.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: authTheme.surface,
  },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  role: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontFamily: fonts.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 18,
    fontFamily: fonts.extraBold,
    marginTop: 2,
  },
  logout: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  message: {
    color: authTheme.textMuted,
    fontSize: 15,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
});
