import {
  BarChart3,
  Bike,
  ClipboardList,
  MessageSquareQuote,
  Tag,
  UtensilsCrossed,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { DashboardQuickActions } from '@/lib/dashboard/types';

type Props = {
  actions: DashboardQuickActions;
  onOrdersPress?: () => void;
  onMenuPress?: () => void;
  onPromosPress?: () => void;
  onAnalyticsPress?: () => void;
  onReviewsPress?: () => void;
  onPartnersPress?: () => void;
};

const ACTIONS = [
  {
    key: 'orders',
    label: 'Orders',
    hint: (a: DashboardQuickActions) => {
      if (a.activeOrders <= 0) return undefined;
      return a.activeOrders > 99 ? '99+' : String(a.activeOrders);
    },
    icon: ClipboardList,
    color: '#EA4B14',
    well: '#FFE8DC',
  },
  {
    key: 'menu',
    label: 'Menu',
    hint: (a: DashboardQuickActions) =>
      a.menuItems > 0 ? String(a.menuItems) : undefined,
    icon: UtensilsCrossed,
    color: '#F97316',
    well: '#FFF1E6',
  },
  {
    key: 'promos',
    label: 'Offers',
    hint: (a: DashboardQuickActions) =>
      a.activePromos > 0 ? String(a.activePromos) : undefined,
    icon: Tag,
    color: '#7C3AED',
    well: '#EDE9FE',
  },
  {
    key: 'analytics',
    label: 'Insights',
    hint: () => undefined,
    icon: BarChart3,
    color: '#2563EB',
    well: '#DBEAFE',
  },
  {
    key: 'reviews',
    label: 'Reviews',
    hint: (a: DashboardQuickActions) =>
      a.totalReviews > 0 ? String(a.totalReviews) : undefined,
    icon: MessageSquareQuote,
    color: '#D97706',
    well: '#FEF3C7',
  },
  {
    key: 'partners',
    label: 'Riders',
    hint: () => undefined,
    icon: Bike,
    color: '#0D9488',
    well: '#CCFBF1',
  },
] as const;

export function QuickActionsGrid({
  actions,
  onOrdersPress,
  onMenuPress,
  onPromosPress,
  onAnalyticsPress,
  onReviewsPress,
  onPartnersPress,
}: Props) {
  const handlers: Record<string, (() => void) | undefined> = {
    orders: onOrdersPress,
    menu: onMenuPress,
    promos: onPromosPress,
    analytics: onAnalyticsPress,
    reviews: onReviewsPress,
    partners: onPartnersPress,
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Shortcuts</Text>
      <View style={styles.card}>
        {ACTIONS.map((item, index) => {
          const Icon = item.icon;
          const hint = item.hint(actions);
          const endCol = (index + 1) % 3 === 0;
          const lastRow = index >= 3;
          return (
            <Pressable
              key={item.key}
              onPress={handlers[item.key]}
              style={styles.cellPress}
            >
              <View
                style={[
                  styles.cell,
                  !endCol && styles.cellBorderRight,
                  !lastRow && styles.cellBorderBottom,
                ]}
              >
                <View style={[styles.iconWrap, { backgroundColor: item.well }]}>
                  <Icon color={item.color} size={19} strokeWidth={2.1} />
                  {hint ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{hint}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.tileLabel}>{item.label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
    letterSpacing: -0.2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    flexDirection: 'row',
    flexWrap: 'wrap',
    overflow: 'hidden',
  },
  cellPress: {
    width: '33.333%',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 6,
  },
  cellBorderRight: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: authTheme.cardBorder,
  },
  cellBorderBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -6,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontFamily: fonts.bold,
  },
});
