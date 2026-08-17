import type { ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GatewayStatusBanner } from '@/components/delivery/shared/GatewayStatusBanner';
import { CodLimitBanner } from '@/components/delivery/shared/CodLimitBanner';
import { DeliveryHeaderActions } from '@/components/delivery/shared/HeaderActions';
import { DeliveryHeaderScrollProvider } from '@/components/delivery/shared/header-scroll';
import { DeliveryTabBar } from '@/components/delivery/shared/TabBar';
import { authTheme } from '@/constants/auth-theme';
import { BRAND_NAME } from '@/constants/theme';
import { fonts } from '@/constants/typography';
import { usePartnerDutyStatus } from '@/lib/delivery-partner/availability-hooks';
import {
  dutyStatusLabel,
  isDutySwitchOn,
} from '@/lib/delivery-partner/availability-types';
import { useDeliveryPartnerMe } from '@/lib/delivery-partner/hooks';
import { useAuthStore } from '@/store/auth-store';

const tokajoLogo = require('../../../assets/tokajo-logo.png');

type Props = {
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** @deprecated Shell always owns the page header now. */
  hideHeader?: boolean;
  /** Remove default horizontal padding around children. */
  flush?: boolean;
  /** Dark canvas (Orders / live trip screens). */
  dark?: boolean;
  /** Hide bottom tab bar (e.g. setup). */
  hideTabBar?: boolean;
  /** Show Tokajo Food logo + partner greeting on home. */
  brandHeader?: boolean;
  /** Optional right-side header control (merged after bell/profile). */
  headerRight?: ReactNode;
};

const PAGE_COPY: Record<string, string> = {
  Dashboard: 'Your delivery hub',
  Home: 'Your delivery hub',
  Profile: 'Account & vehicle details',
  Documents: 'KYC verification center',
  Orders: 'Active trips & history',
  Analytics: 'Performance insights',
  Earnings: 'Payouts & daily totals',
  Restaurants: 'Partnered outlets',
  Notifications: 'Alerts & updates',
  Support: 'Help & tickets',
  Shifts: 'Book slots & attendance',
  Hubs: 'Nearby hubs & cash drop',
  Demand: 'Nearby order heatmap',
  Incentives: 'Bonuses, rewards & leaderboard',
  Performance: 'Ratings, tier, warnings & referrals',
};

function partnerDisplayId(id?: string) {
  if (!id) return 'ID: —';
  const clean = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const short = clean.slice(-8) || clean;
  return `ID: DP${short}`;
}

/** Shared chrome — maroon header (scrolls with layout, not pinned) + tabs. */
export function DeliveryScreenShell(props: Props) {
  return (
    <DeliveryHeaderScrollProvider>
      <DeliveryScreenShellInner {...props} />
    </DeliveryHeaderScrollProvider>
  );
}

function HomeBrandHeader() {
  const authUser = useAuthStore((s) => s.user);
  const me = useDeliveryPartnerMe();
  const duty = usePartnerDutyStatus();
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
  const dutyStatus = duty.data?.dutyStatus ?? profile?.dutyStatus;
  const isOnline = isDutySwitchOn(
    dutyStatus,
    Boolean(profile?.isOnline ?? profile?.isAvailable ?? duty.data?.isOnline)
  );
  const partnerId = partnerDisplayId(profile?.id || profile?.userId);
  const vehicle =
    profile?.vehicle?.type ||
    profile?.vehicleType ||
    profile?.vehicle?.model ||
    '';

  return (
    <View style={styles.homeHero}>
      <View style={styles.topRow}>
        <View style={styles.brandLeft}>
          <View style={styles.logoPlate}>
            <Image
              source={tokajoLogo}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.brandText}>
            <Text style={styles.appName} numberOfLines={1}>
              {BRAND_NAME}
            </Text>
            <Text style={styles.portalLabel} numberOfLines={1}>
              Delivery Portal
            </Text>
          </View>
        </View>
        <DeliveryHeaderActions onBrand />
      </View>

      <Text style={styles.greetingLine}>
        Good {partOfDay}, {firstName}
      </Text>
      <Text style={styles.heroName} numberOfLines={1}>
        {displayName}
      </Text>
      {vehicle ? (
        <Text style={styles.heroMeta} numberOfLines={1}>
          {String(vehicle)}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        <View style={styles.livePill}>
          <View
            style={[
              styles.liveDot,
              { backgroundColor: isOnline ? '#22C55E' : '#F87171' },
            ]}
          />
          <Text style={styles.liveText}>
            {isOnline
              ? `Live · ${dutyStatusLabel(dutyStatus ?? 'online')}`
              : 'Offline'}
          </Text>
        </View>
        <View style={styles.idPill}>
          <Text style={styles.idText} numberOfLines={1}>
            {partnerId}
          </Text>
        </View>
      </View>
    </View>
  );
}

function PageHeader({
  title,
  subtitle,
  headerRight,
}: {
  title: string;
  subtitle: string;
  headerRight?: ReactNode;
}) {
  return (
    <View style={styles.pageHero}>
      <View style={styles.topRow}>
        <View style={styles.pageCopy}>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.pageSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <DeliveryHeaderActions onBrand />
        {headerRight ? (
          <View style={styles.headerRight}>{headerRight}</View>
        ) : null}
      </View>
    </View>
  );
}

function DeliveryScreenShellInner({
  title,
  subtitle,
  children,
  flush,
  dark,
  hideTabBar,
  hideHeader,
  brandHeader,
  headerRight,
}: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'Partner';

  const isHome = title === 'Home' || title === 'Dashboard' || brandHeader;
  const showBrand = Boolean(brandHeader || isHome);
  const headerTitle = isHome ? 'Home' : title;
  const headerSubtitle =
    subtitle?.trim() ||
    PAGE_COPY[headerTitle] ||
    PAGE_COPY[title] ||
    `Hi, ${displayName}`;

  return (
    <View style={[styles.screen, dark && styles.screenDark]}>
      {!hideHeader ? (
        <View style={[styles.headerWrap, { paddingTop: insets.top + 10 }]}>
          {showBrand ? (
            <HomeBrandHeader />
          ) : (
            <PageHeader
              title={headerTitle}
              subtitle={headerSubtitle}
              headerRight={headerRight}
            />
          )}
        </View>
      ) : null}

      <GatewayStatusBanner />
      <CodLimitBanner />

      <View style={[styles.body, flush && styles.bodyFlush]}>
        {children ?? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>{headerTitle}</Text>
            <Text style={styles.placeholderText}>
              This section will connect to Delivery Service APIs next.
            </Text>
          </View>
        )}
      </View>

      {hideTabBar ? null : <DeliveryTabBar />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F3F4F6', // greyish background
  },
  screenDark: {
    backgroundColor: '#0B1220',
  },
  headerWrap: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    backgroundColor: 'transparent',
  },

  homeHero: {
    gap: 0,
  },
  pageHero: {
    paddingBottom: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 10,
  },
  brandLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  logoPlate: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: '#EA4B14',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 12,
  },
  logo: {
    width: 34,
    height: 34,
  },
  brandText: {
    flex: 1,
    minWidth: 0,
  },
  appName: {
    color: '#000000',
    fontSize: 16,
    fontFamily: fonts.extraBold,
    letterSpacing: 0.3,
  },
  portalLabel: {
    marginTop: 2,
    color: '#6B7280',
    fontSize: 11,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  greetingLine: {
    color: '#6B7280',
    fontSize: 13,
    fontFamily: fonts.medium,
  },
  heroName: {
    marginTop: 4,
    color: '#000000',
    fontSize: 22,
    lineHeight: 28,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
  },
  heroMeta: {
    marginTop: 2,
    color: '#6B7280',
    fontSize: 13,
    fontFamily: fonts.medium,
    textTransform: 'capitalize',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 7,
  },
  liveText: {
    color: '#000000',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  idPill: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  idText: {
    color: '#4B5563',
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  pageCopy: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: '#000000',
    fontSize: 20,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    marginTop: 2,
    color: '#6B7280',
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  headerRight: {
    marginLeft: 2,
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
  },
  bodyFlush: {
    paddingHorizontal: 0,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  placeholderTitle: {
    color: '#000000',
    fontFamily: fonts.bold,
    fontSize: 18,
    marginBottom: 8,
  },
  placeholderText: {
    color: '#6B7280',
    fontFamily: fonts.medium,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
