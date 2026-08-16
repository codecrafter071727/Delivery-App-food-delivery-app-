import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { KitchenSupportManager } from '@/components/support/KitchenSupportManager';
import { useDashboardStats } from '@/lib/dashboard/hooks';

export default function KitchenSupportScreen() {
  const router = useRouter();
  const { data } = useDashboardStats();

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <View style={{ flex: 1 }}>
        <KitchenSupportManager />
      </View>
      <DashboardTabBar
        active="stats"
        centerBadge={data?.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}
