import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import {
  Bell,
  Building2,
  CalendarClock,
  FileText,
  Gift,
  Flame,
  HelpCircle,
  Home,
  LogOut,
  Menu,
  Package,
  Power,
  Star,
  User,
  UtensilsCrossed,
  Wallet,
  X,
  Zap,
} from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image as RNImage,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatRating } from '@/lib/delivery-partner/analytics-api';
import { usePartnerPerformance } from '@/lib/delivery-partner/analytics-hooks';
import { usePartnerDutyStatus } from '@/lib/delivery-partner/availability-hooks';
import {
  dutyStatusLabel,
  isDutySwitchOn,
} from '@/lib/delivery-partner/availability-types';
import {
  formatGoOnlineError,
  getGoOnlineBlocker,
} from '@/lib/delivery-partner/go-online-guard';
import {
  useDeliveryOrderMutations,
  useDeliveryPartnerMe,
} from '@/lib/delivery-partner/hooks';
import { pushLiveToast } from '@/lib/delivery-partner/live-toast-store';
import {
  DELIVERY_ROUTES,
  DELIVERY_TABS,
  isDeliveryHomePath,
  type DeliveryTabKey,
} from '@/lib/delivery-partner/navigation';
import { useAuthStore } from '@/store/auth-store';

const tokajoLogo = require('../../../assets/tokajo-logo.png');

const ICONS: Record<DeliveryTabKey, typeof Home> = {
  home: Home,
  profile: User,
  documents: FileText,
  orders: Package,
  analytics: Zap,
  earnings: Wallet,
  restaurants: UtensilsCrossed,
  notifications: Bell,
  support: HelpCircle,
  shifts: CalendarClock,
  hubs: Building2,
  heatmap: Flame,
  incentives: Gift,
};

/** Hamburger button + slide-over menu (profile card + tabs + logout). */
export function DeliveryMenuButton({
  variant = 'default',
}: {
  variant?: 'default' | 'onBrand';
}) {
  const [open, setOpen] = useState(false);
  const onBrand = variant === 'onBrand';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.menuBtn, onBrand && styles.menuBtnOnBrand]}
        accessibilityRole="button"
        accessibilityLabel="Open menu"
      >
        <Menu color={onBrand ? '#FFFFFF' : authTheme.text} size={20} />
      </Pressable>
      <DeliverySideMenu visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function partnerDisplayId(id?: string) {
  if (!id) return 'ID: —';
  const clean = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const short = clean.slice(-8) || clean;
  return `ID: DP${short}`;
}

function DeliverySideMenu({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const logout = useAuthStore((s) => s.logout);
  const authUser = useAuthStore((s) => s.user);
  const [loggingOut, setLoggingOut] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const me = useDeliveryPartnerMe(visible);
  const duty = usePartnerDutyStatus(visible);
  const performance = usePartnerPerformance(visible);
  const { setOnline } = useDeliveryOrderMutations();

  const profile = me.data;
  const displayName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
    profile?.name ||
    [authUser?.firstName, authUser?.lastName].filter(Boolean).join(' ') ||
    authUser?.email ||
    'Partner';

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || 'P';

  const photoUrl = profile?.photoUrl;
  const dutyStatus =
    duty.data?.dutyStatus ?? profile?.dutyStatus ?? undefined;
  const isOnline = isDutySwitchOn(
    dutyStatus,
    Boolean(profile?.isOnline ?? profile?.isAvailable ?? duty.data?.isOnline)
  );
  const onDelivery = dutyStatus === 'on_delivery';
  const avgRating =
    performance.data?.avgRating ?? profile?.stats?.avgRating ?? 0;
  const partnerId = partnerDisplayId(profile?.id || profile?.userId);

  const goOnlineBlocker = getGoOnlineBlocker(profile);

  const go = (href: string) => {
    onClose();
    setTimeout(() => {
      const isHome =
        href === DELIVERY_ROUTES.home && isDeliveryHomePath(pathname);
      if (pathname === href || isHome) return;
      router.push(href as never);
    }, 50);
  };

  const onToggleOnline = () => {
    if (onDelivery) {
      Alert.alert(
        'Active delivery',
        'Complete your active delivery before going offline.'
      );
      return;
    }
    if (!isOnline && goOnlineBlocker) {
      Alert.alert(goOnlineBlocker.title, goOnlineBlocker.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: goOnlineBlocker.actionLabel,
          onPress: () => go(goOnlineBlocker.actionHref),
        },
      ]);
      return;
    }

    setTogglingOnline(true);
    setOnline.mutate(!isOnline, {
      onSuccess: () => {
        pushLiveToast({
          title: !isOnline ? 'You’re online' : 'You’re offline',
          body: !isOnline
            ? 'Nearby orders will start coming in.'
            : 'You won’t receive new orders.',
          tone: 'success',
        });
      },
      onError: (err) => {
        Alert.alert(
          'Could not update duty',
          formatGoOnlineError(err, 'Please try again.')
        );
      },
      onSettled: () => setTogglingOnline(false),
    });
  };

  const onLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setLoggingOut(true);
            try {
              await logout();
              onClose();
              router.replace('/login');
            } catch {
              onClose();
              router.replace('/login');
            } finally {
              setLoggingOut(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalRoot}>
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={[styles.brandRow, { paddingTop: insets.top + 14 }]}>
            <RNImage
              source={tokajoLogo}
              style={styles.brandLogo}
              resizeMode="contain"
            />
            <View style={styles.brandTextCol}>
              <Text style={styles.brandName}>Tokajo Food</Text>
              <Text style={styles.brandPortal}>Delivery Partner</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <X color={authTheme.textMuted} size={18} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.profileCard}>
              <View style={styles.profileTop}>
                <View style={styles.avatarRing}>
                  {photoUrl ? (
                    <Image
                      source={{ uri: photoUrl }}
                      style={styles.avatarImg}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarInitials}>{initials}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.profileMeta}>
                  <Text style={styles.profileName} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={styles.profileId} numberOfLines={1}>
                    {partnerId}
                  </Text>
                </View>
              </View>

              <View style={styles.pillsRow}>
                <View
                  style={[
                    styles.pill,
                    {
                      backgroundColor: isOnline
                        ? 'rgba(22, 163, 74, 0.12)'
                        : 'rgba(185, 28, 28, 0.1)',
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.pillDot,
                      {
                        backgroundColor: isOnline
                          ? authTheme.success
                          : authTheme.error,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.pillText,
                      {
                        color: isOnline ? '#15803D' : '#B91C1C',
                      },
                    ]}
                  >
                    {dutyStatusLabel(dutyStatus ?? (isOnline ? 'online' : 'offline'))}
                  </Text>
                </View>
                <View style={[styles.pill, styles.ratingPill]}>
                  <Star color="#D97706" size={12} fill="#FBBF24" />
                  <Text style={styles.ratingText}>
                    {formatRating(avgRating)}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={onToggleOnline}
                disabled={togglingOnline || setOnline.isPending || onDelivery}
                style={[
                  styles.onlineBtn,
                  isOnline ? styles.onlineBtnOff : styles.onlineBtnOn,
                ]}
              >
                {togglingOnline || setOnline.isPending ? (
                  <ActivityIndicator
                    color={isOnline ? '#B91C1C' : authTheme.success}
                    size="small"
                  />
                ) : (
                  <>
                    <Power
                      color={isOnline ? '#B91C1C' : authTheme.success}
                      size={16}
                    />
                    <Text
                      style={[
                        styles.onlineBtnText,
                        {
                          color: isOnline ? '#B91C1C' : '#15803D',
                        },
                      ]}
                    >
                      {onDelivery
                        ? 'On delivery'
                        : isOnline
                          ? 'Go Offline'
                          : 'Go Online'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            <Text style={styles.menuHeading}>MENU</Text>

            {DELIVERY_TABS.map((tab) => {
              const Icon = ICONS[tab.key];
              const active =
                pathname === tab.href ||
                (tab.href === DELIVERY_ROUTES.home &&
                  isDeliveryHomePath(pathname));
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => go(tab.href)}
                  style={[styles.item, active && styles.itemActive]}
                >
                  <View
                    style={[
                      styles.itemIcon,
                      active && styles.itemIconActive,
                    ]}
                  >
                    <Icon
                      color={active ? authTheme.brand : authTheme.textMuted}
                      size={18}
                    />
                  </View>
                  <Text
                    style={[styles.itemLabel, active && styles.itemLabelActive]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={onLogout}
            disabled={loggingOut}
            style={styles.logoutBtn}
          >
            {loggingOut ? (
              <ActivityIndicator color="#B91C1C" />
            ) : (
              <>
                <LogOut color="#B91C1C" size={18} />
                <Text style={styles.logoutText}>Logout</Text>
              </>
            )}
          </Pressable>
        </View>
        <Pressable style={styles.backdrop} onPress={onClose} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  menuBtnOnBrand: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.22)',
  },
  modalRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  backdrop: {
    flex: 1,
  },
  sheet: {
    width: '82%',
    maxWidth: 340,
    backgroundColor: authTheme.bg,
    paddingHorizontal: 14,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingHorizontal: 2,
  },
  brandLogo: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  brandTextCol: {
    flex: 1,
    minWidth: 0,
  },
  brandName: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  brandPortal: {
    marginTop: 1,
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 11,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 12,
    gap: 2,
  },
  profileCard: {
    backgroundColor: authTheme.card,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    gap: 12,
  },
  profileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: authTheme.brandMuted,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  avatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brandSoft,
  },
  avatarInitials: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 18,
  },
  profileMeta: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  profileId: {
    marginTop: 2,
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  pillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
  ratingPill: {
    backgroundColor: 'rgba(217, 119, 6, 0.1)',
  },
  ratingText: {
    color: '#B45309',
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
  onlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  onlineBtnOn: {
    backgroundColor: 'rgba(22, 163, 74, 0.08)',
    borderColor: 'rgba(22, 163, 74, 0.35)',
  },
  onlineBtnOff: {
    backgroundColor: 'rgba(185, 28, 28, 0.06)',
    borderColor: 'rgba(185, 28, 28, 0.25)',
  },
  onlineBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  menuHeading: {
    marginTop: 4,
    marginBottom: 8,
    marginLeft: 10,
    color: authTheme.textDim,
    fontFamily: fonts.semiBold,
    fontSize: 11,
    letterSpacing: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  itemActive: {
    backgroundColor: authTheme.brandSoft,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  itemIconActive: {
    backgroundColor: authTheme.brandMuted,
  },
  itemLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: authTheme.text,
  },
  itemLabelActive: {
    color: authTheme.brand,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FECACA',
  },
  logoutText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#B91C1C',
  },
});
