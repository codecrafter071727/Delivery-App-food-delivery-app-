import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { AnalyticsManager } from '@/components/analytics/AnalyticsManager';
import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { useDashboardStats } from '@/lib/dashboard/hooks';

export default function AnalyticsScreen() {
  const router = useRouter();
  const { data } = useDashboardStats();

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <View style={{ flex: 1 }}>
        <AnalyticsManager />
      </View>
      <DashboardTabBar
        active="stats"
        centerBadge={data?.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}
