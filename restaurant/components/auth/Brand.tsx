import { Image, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/typography';
import {
  BRAND_NAME,
  PORTAL_LABELS,
  theme,
} from '@/constants/theme';
import type { PartnerRole } from '@/lib/auth/types';
import { useAuthStore } from '@/store/auth-store';

const logo = require('../../assets/tokajo-logo.png');

type BrandProps = {
  size?: 'sm' | 'md' | 'lg' | 'hero';
  /** Show Restaurant Portal / Delivery Portal under the name */
  portal?: PartnerRole | 'auto' | false;
  role?: PartnerRole;
  compact?: boolean;
};

const SIZES = {
  sm: { logo: 36, title: 15, portal: 10, gap: 8 },
  md: { logo: 48, title: 18, portal: 11, gap: 10 },
  lg: { logo: 72, title: 22, portal: 12, gap: 12 },
  hero: { logo: 132, title: 28, portal: 13, gap: 14 },
} as const;

export function Brand({
  size = 'md',
  portal = false,
  role,
  compact = false,
}: BrandProps) {
  const storeRole = useAuthStore((s) => s.user?.role ?? s.role);
  const dims = SIZES[size];
  const showPortal = portal !== false;
  const resolvedRole =
    portal === 'auto' || portal === false
      ? role ?? storeRole
      : portal;
  const portalRole: PartnerRole =
    resolvedRole === 'delivery' || resolvedRole === 'restaurant'
      ? resolvedRole
      : 'restaurant';
  const portalLabel = PORTAL_LABELS[portalRole];

  if (compact) {
    return (
      <View style={styles.row}>
        <Image
          source={logo}
          style={{ width: dims.logo, height: dims.logo, borderRadius: 10 }}
          resizeMode="contain"
        />
        <View style={{ gap: 2 }}>
          <Text
            style={[
              styles.title,
              { fontSize: dims.title, color: theme.primary },
            ]}
          >
            {BRAND_NAME}
          </Text>
          {showPortal ? (
            <Text style={[styles.portal, { fontSize: dims.portal }]}>
              {portalLabel}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.stack, { gap: dims.gap }]}>
      <View style={styles.logoWrap}>
        <Image
          source={logo}
          style={{ width: dims.logo, height: dims.logo, borderRadius: 18 }}
          resizeMode="contain"
        />
      </View>
      <Text
        style={[
          styles.title,
          {
            fontSize: dims.title,
            color: theme.primary,
            textAlign: 'center',
          },
        ]}
      >
        {BRAND_NAME}
      </Text>
      {showPortal ? (
        <View style={styles.portalBadge}>
          <Text style={[styles.portalBadgeText, { fontSize: dims.portal }]}>
            {portalLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stack: {
    alignItems: 'center',
  },
  logoWrap: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: '#7A0E22',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  title: {
    fontFamily: fonts.extraBold,
    letterSpacing: 0.6,
  },
  portal: {
    color: theme.secondaryLight,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  portalBadge: {
    marginTop: 2,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(122, 14, 34, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.12)',
  },
  portalBadgeText: {
    color: theme.primary,
    fontFamily: fonts.bold,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
