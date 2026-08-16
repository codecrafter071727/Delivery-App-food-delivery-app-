import { usePathname, useRouter } from 'expo-router';
import { Bell } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useKitchenUnreadCount } from '@/lib/restaurant/inbox-hooks';
import { useAuthStore } from '@/store/auth-store';

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? 'R').toUpperCase();
}

/** Shared notification bell + profile avatar for restaurant portal headers. */
export function RestaurantHeaderActions({ hideProfile }: { hideProfile?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const unreadQuery = useKitchenUnreadCount();

  const unread = Math.max(0, unreadQuery.data ?? 0);
  const badgeLabel = unread > 99 ? '99+' : String(unread);
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email?.split('@')[0] ||
    'R';
  const initials = initialsFrom(displayName);

  const notifActive = pathname === '/notifications';
  const profileActive = pathname === '/admin';

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          if (!notifActive) router.push('/notifications');
        }}
        style={[styles.btn, notifActive && styles.btnActive]}
        accessibilityRole="button"
        accessibilityLabel={
          unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
        }
        hitSlop={6}
      >
        <Bell color={authTheme.text} size={18} strokeWidth={2.2} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeLabel}</Text>
          </View>
        ) : null}
      </Pressable>

    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    backgroundColor: '#F1F5F9',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 9,
    lineHeight: 11,
  },
  profileBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileActive: {
    borderColor: authTheme.brand,
  },
  initials: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
});
