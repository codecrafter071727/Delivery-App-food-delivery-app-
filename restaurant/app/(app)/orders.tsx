import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { KitchenOrdersManager } from '@/components/orders/KitchenOrdersManager';
import { useDashboardStats } from '@/lib/dashboard/hooks';

export default function OrdersScreen() {
  const router = useRouter();
  const { data } = useDashboardStats(false);

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <View style={{ flex: 1 }}>
        <KitchenOrdersManager />
      </View>
      <DashboardTabBar
        active="orders"
        centerBadge={data?.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}
