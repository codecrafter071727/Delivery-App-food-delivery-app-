import { Bell, MapPin } from 'lucide-react-native';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';

type Props = {
  name: string;
  restaurantName?: string;
  restaurantCity?: string;
  logoUrl?: string;
  unreadNotifications?: number;
  activeOrders?: number;
  verificationLabel?: string;
  verificationColor?: string;
  verificationSoft?: string;
  dutyLabel?: string;
  dutyOnline?: boolean;
  onNotificationsPress?: () => void;
  onProfilePress?: () => void;
};

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? 'R').toUpperCase();
}

export function DashboardHeader({
  name,
  restaurantName,
  restaurantCity,
  logoUrl,
  unreadNotifications = 0,
  verificationLabel,
  verificationColor,
  verificationSoft,
  dutyLabel,
  dutyOnline,
  onNotificationsPress,
  onProfilePress,
}: Props) {
  const insets = useSafeAreaInsets();
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
  const firstName = name.split(' ')[0] || name;
  const initials = initialsFrom(restaurantName || name);
  const unread = Math.max(0, unreadNotifications);
  const badgeLabel = unread > 99 ? '99+' : String(unread);
  const live = dutyOnline === true;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topRow}>
        <Pressable
          onPress={onProfilePress}
          style={styles.profileBtn}
          accessibilityRole="button"
          accessibilityLabel="Profile"
        >
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.logo} />
          ) : (
            <Text style={styles.profileInitials}>{initials}</Text>
          )}
        </Pressable>

        <View style={styles.titleStack}>
          <Text style={styles.greeting} numberOfLines={1}>
            Good {partOfDay}, {firstName}
          </Text>
          <Text style={styles.outletName} numberOfLines={1}>
            {restaurantName || 'Your restaurant'}
          </Text>
          {restaurantCity ? (
            <View style={styles.cityRow}>
              <MapPin color={authTheme.textMuted} size={12} />
              <Text style={styles.city} numberOfLines={1}>
                {restaurantCity}
              </Text>
            </View>
          ) : null}
        </View>

        <Pressable
          onPress={onNotificationsPress}
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={
            unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
          }
          hitSlop={6}
        >
          <Bell color={authTheme.text} size={20} strokeWidth={2.1} />
          {unread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badgeLabel}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.metaRow}>
        <View
          style={[
            styles.livePill,
            live ? styles.livePillOn : styles.livePillOff,
          ]}
        >
          <View
            style={[
              styles.liveDot,
              { backgroundColor: live ? '#16A34A' : authTheme.textDim },
            ]}
          />
          <Text
            style={[styles.liveText, live ? styles.liveTextOn : undefined]}
          >
            {dutyLabel || (live ? 'Open' : 'Offline')}
          </Text>
        </View>

        {verificationLabel ? (
          <View
            style={[
              styles.verifyPill,
              { backgroundColor: verificationSoft ?? authTheme.brandSoft },
            ]}
          >
            <Text
              style={[
                styles.verifyText,
                { color: verificationColor ?? authTheme.brand },
              ]}
            >
              {verificationLabel}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  logo: {
    width: 46,
    height: 46,
  },
  profileInitials: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  titleStack: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    paddingRight: 8,
  },
  greeting: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  outletName: {
    color: authTheme.text,
    fontSize: 17,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
    marginTop: 1,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  city: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    flex: 1,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.bgSoft,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brand,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 9,
    lineHeight: 11,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  livePillOn: {
    backgroundColor: '#ECFDF3',
  },
  livePillOff: {
    backgroundColor: '#F1F5F9',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  liveTextOn: {
    color: '#15803D',
  },
  verifyPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  verifyText: {
    fontSize: 11,
    fontFamily: fonts.bold,
  },
});
