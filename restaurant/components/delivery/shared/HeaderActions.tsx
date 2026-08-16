import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import { Bell, User } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useDeliveryPartnerMe } from '@/lib/delivery-partner/hooks';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { useUnreadNotificationCount } from '@/lib/notification/hooks';
import { useAuthStore } from '@/store/auth-store';

/** Header actions: notification bell (unread badge) + profile. */
export function DeliveryHeaderActions({
  onBrand = true,
  hideProfile = false,
}: {
  onBrand?: boolean;
  hideProfile?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const authUser = useAuthStore((s) => s.user);
  const me = useDeliveryPartnerMe();
  const unreadQuery = useUnreadNotificationCount({
    // Bell badge stays live via background sync + focus refetch
    refetchOnMount: true,
  });

  const unread = Math.max(0, unreadQuery.data ?? 0);
  const badgeLabel = unread > 99 ? '99+' : String(unread);

  const profile = me.data;
  const displayName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
    profile?.name ||
    [authUser?.firstName, authUser?.lastName].filter(Boolean).join(' ') ||
    'P';
  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'P';
  const photoUrl = profile?.photoUrl;

  const notifActive = pathname === DELIVERY_ROUTES.notifications;
  const profileActive = pathname === DELIVERY_ROUTES.profile;

  const iconColor = onBrand ? '#000000' : authTheme.text;
  const btnBg = onBrand ? '#F3F4F6' : authTheme.surface;
  const btnBorder = onBrand
    ? '#E5E7EB'
    : authTheme.cardBorder;

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          if (!notifActive) router.push(DELIVERY_ROUTES.notifications);
        }}
        style={[
          styles.btn,
          { backgroundColor: btnBg, borderColor: btnBorder },
          notifActive && styles.btnActive,
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          unread > 0
            ? `Notifications, ${unread} unread`
            : 'Notifications'
        }
        hitSlop={6}
      >
        <Bell color={iconColor} size={18} />
        {unread > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeLabel}</Text>
          </View>
        ) : null}
      </Pressable>

      {!hideProfile ? (
        <Pressable
          onPress={() => {
            if (!profileActive) router.push(DELIVERY_ROUTES.profile);
          }}
          style={[
            styles.profileBtn,
            {
              borderColor: onBrand
                ? '#E5E7EB'
                : authTheme.brandMuted,
            },
            profileActive && styles.profileActive,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Profile"
          hitSlop={6}
        >
          {photoUrl ? (
            <Image
              source={{ uri: photoUrl }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View
              style={[styles.avatarFallback, onBrand && styles.avatarOnBrand]}
            >
              {onBrand ? (
                <Text style={styles.initials}>{initials}</Text>
              ) : (
                <User color={authTheme.brand} size={16} />
              )}
            </View>
          )}
        </Pressable>
      ) : null}
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
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  btnActive: {
    backgroundColor: 'rgba(0,0,0,0.05)',
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
    borderWidth: 2,
  },
  profileActive: {
    borderColor: '#000000',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brandSoft,
  },
  avatarOnBrand: {
    backgroundColor: '#F3F4F6',
  },
  initials: {
    color: '#000000',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
});
