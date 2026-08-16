import { usePathname, useRouter } from 'expo-router';
import {
  ClipboardList,
  Home,
  Settings,
  UtensilsCrossed,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';

export type DashboardTab = 'stats' | 'orders' | 'menu' | 'admin';

type TabItem = {
  key: DashboardTab;
  label: string;
  icon: typeof Home;
  href: '/dashboard' | '/orders' | '/menu' | '/admin';
};

const tabs: TabItem[] = [
  { key: 'stats', label: 'Home', icon: Home, href: '/dashboard' },
  { key: 'orders', label: 'Orders', icon: ClipboardList, href: '/orders' },
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed, href: '/menu' },
  { key: 'admin', label: 'Admin', icon: Settings, href: '/admin' },
];

type Props = {
  /** @deprecated Preferred: active tab is inferred from the current route. */
  active?: DashboardTab;
  onNavigate?: (href: TabItem['href']) => void;
  onCenterPress?: () => void;
  centerBadge?: number;
};

function pathMatchesTab(pathname: string, tab: TabItem) {
  const path = pathname.replace(/\/$/, '') || '/';
  if (tab.href === '/dashboard') {
    return path === '/dashboard' || path === '';
  }
  if (tab.href === '/orders') {
    return path === '/orders' || path.startsWith('/order/');
  }
  if (tab.href === '/menu') {
    return path === '/menu' || path.startsWith('/menu/');
  }
  if (tab.href === '/admin') {
    return (
      path === '/admin' ||
      path === '/settings' ||
      path.startsWith('/settings/') ||
      path === '/onboarding' ||
      path === '/chain' ||
      path === '/staff' ||
      path.startsWith('/staff/')
    );
  }
  return path === tab.href;
}

/** Same floating 4-tab chrome as the delivery partner tab bar. */
export function DashboardTabBar({
  active,
  onNavigate,
  centerBadge = 0,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();

  const go = (href: TabItem['href']) => {
    if (onNavigate) onNavigate(href);
    else router.replace(href);
  };

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]}
    >
      <View style={styles.bar}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            pathMatchesTab(pathname, tab) ||
            // Fallback only when pathname is unavailable / mismatched screens.
            (!pathname && active === tab.key);
          const showBadge = tab.key === 'orders' && centerBadge > 0;

          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                // Always navigate Home/other tabs when not already on that route.
                // (Fixes secondary screens that incorrectly passed active="stats".)
                if (!pathMatchesTab(pathname, tab)) {
                  go(tab.href);
                }
              }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={tab.label}
            >
              <View style={styles.tabInner}>
                <View
                  style={[
                    styles.iconWrap,
                    isActive ? styles.iconWrapActive : null,
                  ]}
                >
                  <Icon
                    color={isActive ? authTheme.brand : authTheme.textDim}
                    size={22}
                    strokeWidth={isActive ? 2.4 : 1.9}
                  />
                  {showBadge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {centerBadge > 9 ? '9+' : String(centerBadge)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.label, isActive ? styles.labelActive : null]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  tab: {
    flex: 1,
  },
  tabInner: {
    alignItems: 'center',
    paddingVertical: 2,
    gap: 4,
  },
  iconWrap: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: authTheme.brandSoft,
  },
  label: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    color: authTheme.textDim,
  },
  labelActive: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: authTheme.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontFamily: fonts.bold,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.75,
  },
});
