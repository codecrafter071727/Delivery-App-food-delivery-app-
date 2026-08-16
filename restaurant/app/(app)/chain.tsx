import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ChainManager } from '@/components/chain/ChainManager';
import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { useDashboardStats } from '@/lib/dashboard/hooks';

export default function ChainScreen() {
  const router = useRouter();
  const { data } = useDashboardStats(false);

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <View style={{ flex: 1 }}>
        <ChainManager />
      </View>
      <DashboardTabBar
        active="admin"
        centerBadge={data?.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}
