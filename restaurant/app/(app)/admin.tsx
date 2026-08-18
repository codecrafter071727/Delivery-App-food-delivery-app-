import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  BadgeCheck,
  Banknote,
  Bike,
  ChevronRight,
  Clock3,
  Headphones,
  KeyRound,
  LogOut,
  Mail,
  MailCheck,
  MessageSquareQuote,
  MonitorSmartphone,
  ShieldAlert,
  ShieldOff,
  Store,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useDashboardStats } from '@/lib/dashboard/hooks';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { getRestaurantVerificationBadge } from '@/lib/restaurant/verification';
import { displayPlatformName } from '@/lib/user/account-types';
import { usePlatformMe } from '@/lib/user/account-hooks';
import { useAuthStore } from '@/store/auth-store';

type AdminRow = {
  label: string;
  hint?: string;
  icon: LucideIcon;
  accent?: string;
  soft?: string;
  onPress: () => void;
  danger?: boolean;
};

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.[0] ?? 'R').toUpperCase();
}

function AdminMenuRow({
  label,
  hint,
  icon: Icon,
  accent,
  soft,
  onPress,
  danger,
  isLast,
}: AdminRow & { isLast?: boolean }) {
  const iconColor = danger ? authTheme.error : accent ?? authTheme.brand;
  const iconBg = danger ? 'rgba(239,68,68,0.1)' : soft ?? authTheme.brandSoft;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={isLast ? undefined : styles.rowBorder}
    >
      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Icon color={iconColor} size={16} strokeWidth={2.2} />
        </View>

        <View style={styles.rowBody}>
          <Text
            style={[styles.rowLabel, danger ? styles.rowLabelDanger : null]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {hint ? (
            <Text style={styles.rowHint} numberOfLines={1}>
              {hint}
            </Text>
          ) : null}
        </View>

        <ChevronRight
          color={danger ? 'rgba(239,68,68,0.45)' : authTheme.textDim}
          size={16}
        />
      </View>
    </Pressable>
  );
}

function SectionCard({ title, rows }: { title: string; rows: AdminRow[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {rows.map((row, index) => (
          <AdminMenuRow
            key={row.label}
            {...row}
            isLast={index === rows.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

export default function AdminScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const me = usePlatformMe(true);
  const logout = useAuthStore((s) => s.logout);
  const logoutAll = useAuthStore((s) => s.logoutAll);
  const resendEmailVerification = useAuthStore((s) => s.resendEmailVerification);
  const { data } = useDashboardStats();
  const restaurant = useMyRestaurantId();

  const confirmLogout = (all: boolean) => {
    Alert.alert(
      all ? 'Log out everywhere?' : 'Log out?',
      all
        ? 'This will end your session on all devices.'
        : 'You will need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            await (all ? logoutAll() : logout());
            router.replace('/login');
          },
        },
      ]
    );
  };

  const restaurantRows: AdminRow[] = [
    {
      label: 'KYC & bank',
      hint: 'FSSAI, GST, PAN, settlement account',
      icon: BadgeCheck,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/onboarding'),
    },
    {
      label: 'Restaurant settings',
      hint: 'Profile, images, hours, staff',
      icon: Store,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/settings'),
    },
    {
      label: 'Team & access',
      hint: 'Invite kitchen, managers, cashiers',
      icon: Users,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/staff'),
    },
    {
      label: 'Reviews & ratings',
      hint: 'Read and reply to feedback',
      icon: MessageSquareQuote,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/reviews'),
    },
    {
      label: 'Payouts & invoices',
      hint: 'Weekly settlements, GST, and fees',
      icon: Banknote,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/payouts'),
    },
    {
      label: 'Help & support',
      hint: 'Raise a ticket for orders, payouts, KYC',
      icon: Headphones,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/support'),
    },
    {
      label: 'Delivery partners',
      hint: 'Invite and manage riders',
      icon: Bike,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/partners'),
    },
  ];

  const accountRows: AdminRow[] = [
    {
      label: 'Your account',
      hint: 'Name, photo, phone, email, devices, delete',
      icon: UserRound,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/account'),
    },
    {
      label: 'Change password',
      hint: 'Update your account password',
      icon: KeyRound,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => router.push('/change-password'),
    },
    {
      label: 'Resend email verification',
      hint: user?.emailVerified
        ? 'Email already verified'
        : user?.email ?? 'Send verification link',
      icon: MailCheck,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: async () => {
        if (user?.emailVerified) {
          Alert.alert('Already verified', 'Your email is already verified.');
          return;
        }
        try {
          await resendEmailVerification();
          Alert.alert('Email sent', 'Verification link sent to your inbox.');
        } catch (err) {
          Alert.alert(
            'Failed',
            err instanceof Error ? err.message : 'Could not resend email'
          );
        }
      },
    },
  ];

  const sessionRows: AdminRow[] = [
    {
      label: 'Log out all devices',
      hint: 'End every active session',
      icon: MonitorSmartphone,
      accent: '#0F172A',
      soft: '#F8F9FA',
      onPress: () => confirmLogout(true),
    },
    {
      label: 'Log out',
      hint: 'Sign out on this device',
      icon: LogOut,
      danger: true,
      onPress: () => confirmLogout(false),
    },
  ];

  const liveUser = me.data;
  const displayName =
    displayPlatformName(liveUser) ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    restaurant.data?.name ||
    'Restaurant owner';
  const photoUrl = liveUser?.photoUrl || user?.photoUrl;

  const restaurantName =
    data?.restaurantName || restaurant.data?.name || 'Your restaurant';
  const city = data?.city;
  const activeOrders = data?.quickActions.activeOrders ?? 0;
  const verification = getRestaurantVerificationBadge(
    restaurant.data?.listingStatus ?? restaurant.data?.status
  );
  const emailVerified = Boolean(liveUser?.emailVerified ?? user?.emailVerified);
  const VerificationIcon =
    verification.key === 'verified'
      ? BadgeCheck
      : verification.key === 'pending'
        ? Clock3
        : verification.key === 'rejected'
          ? ShieldAlert
          : ShieldOff;
  const EmailIcon = emailVerified ? BadgeCheck : Mail;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 14,
            paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>Admin</Text>
        <Text style={styles.pageSubtitle}>Manage outlet, account & session</Text>

        <View style={styles.profileCard}>
          <View style={styles.profileTop}>
            <Pressable
              onPress={() => router.push('/account')}
              style={styles.avatar}
              accessibilityRole="button"
              accessibilityLabel="Open account"
            >
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{initialsFrom(displayName)}</Text>
              )}
            </Pressable>
            <View style={styles.profileBody}>
              <Text style={styles.profileName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.profileMeta} numberOfLines={1}>
                {restaurantName}
                {city ? ` · ${city}` : ''}
              </Text>
              {liveUser?.email || user?.email ? (
                <Text style={styles.profileEmail} numberOfLines={1}>
                  {liveUser?.email || user?.email}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.badgeRow}>
            <View style={styles.livePill}>
              <View
                style={[
                  styles.liveDot,
                  {
                    backgroundColor:
                      activeOrders > 0 ? '#22C55E' : authTheme.textDim,
                  },
                ]}
              />
              <Text style={styles.liveText}>
                {activeOrders > 0 ? `${activeOrders} live orders` : 'Kitchen idle'}
              </Text>
            </View>
            <View
              style={[styles.badge, { backgroundColor: verification.soft }]}
            >
              <VerificationIcon color={verification.color} size={14} />
              <Text style={[styles.badgeText, { color: verification.color }]}>
                {verification.label}
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor: emailVerified ? '#DCFCE7' : '#FEF3C7',
                },
              ]}
            >
              <EmailIcon
                color={emailVerified ? '#15803D' : '#B45309'}
                size={14}
              />
              <Text
                style={[
                  styles.badgeText,
                  { color: emailVerified ? '#15803D' : '#B45309' },
                ]}
              >
                {emailVerified ? 'Email verified' : 'Email unverified'}
              </Text>
            </View>
          </View>
        </View>

        <SectionCard title="Restaurant" rows={restaurantRows} />
        <SectionCard title="Account" rows={accountRows} />
        <SectionCard title="Session" rows={sessionRows} />
      </ScrollView>

      <DashboardTabBar
        active="admin"
        centerBadge={data?.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    gap: 14,
  },
  pageTitle: {
    fontFamily: fonts.extraBold,
    fontSize: 28,
    color: authTheme.text,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    marginTop: -6,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 20,
    gap: 16,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 64,
    height: 64,
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: authTheme.brand,
  },
  profileBody: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontFamily: fonts.extraBold,
    fontSize: 20,
    color: authTheme.text,
    letterSpacing: -0.3,
  },
  profileMeta: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.textMuted,
  },
  profileEmail: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textDim,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  badgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: authTheme.surface,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  liveText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: authTheme.textMuted,
  },
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
    paddingHorizontal: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    width: '100%',
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  rowLabelDanger: {
    color: authTheme.error,
  },
  rowHint: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
});
