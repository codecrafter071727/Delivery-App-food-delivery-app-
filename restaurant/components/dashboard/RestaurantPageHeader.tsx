import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RestaurantHeaderActions } from '@/components/dashboard/RestaurantHeaderActions';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';

type Props = {
  title: string;
  subtitle?: string;
  /** Show back chevron (detail / nested screens). */
  showBack?: boolean;
  /** Extra controls after bell/profile (refresh, create, etc.). */
  headerRight?: ReactNode;
  /** Optional content under the title row (stats strip, filters). */
  children?: ReactNode;
  /** Hide the notification and profile actions. */
  hideActions?: boolean;
  /** Hide just the profile icon. */
  hideProfile?: boolean;
};

/**
 * Shared brand header for restaurant portal pages
 * (everything except Home + Admin).
 */
export function RestaurantPageHeader({
  title,
  subtitle,
  showBack,
  headerRight,
  children,
  hideActions,
  hideProfile,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10 }]}>
      <StatusBar style="light" />
      <View style={styles.row}>
        {showBack ? (
          <Pressable
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/dashboard');
            }}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={6}
          >
            <ChevronLeft color={authTheme.text} size={20} strokeWidth={2.4} />
          </Pressable>
        ) : null}

        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {!hideActions ? <RestaurantHeaderActions hideProfile={hideProfile} /> : null}
        {headerRight ? <View style={styles.extra}>{headerRight}</View> : null}
      </View>

      {children ? <View style={styles.below}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: authTheme.text,
    fontSize: 20,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 2,
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  extra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  below: {
    marginTop: 12,
  },
});
