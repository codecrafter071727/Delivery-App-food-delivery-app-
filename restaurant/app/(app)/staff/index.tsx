import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { StaffManager } from '@/components/staff/StaffManager';
import { PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { useDashboardStats } from '@/lib/dashboard/hooks';

export default function StaffScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data } = useDashboardStats();

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Team"
        subtitle="Managers, kitchen and cashiers"
        showBack
        hideActions
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + PARTNER_BOTTOM_NAV_INSET,
          gap: 12,
        }}
      >
        <StaffManager />
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
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
});
