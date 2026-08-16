import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { MenuManager } from '@/components/menu/MenuManager';
import { useDashboardStats } from '@/lib/dashboard/hooks';

export default function MenuScreen() {
  const router = useRouter();
  // Read cached dashboard only — don't re-fetch heavy analytics just for the tab badge.
  const { data } = useDashboardStats(false);

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <View style={{ flex: 1 }}>
        <MenuManager />
      </View>
      <DashboardTabBar
        active="menu"
        centerBadge={data?.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}
