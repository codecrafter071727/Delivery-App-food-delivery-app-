import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { OnboardingManager } from '@/components/onboarding/OnboardingManager';
import { useDashboardStats } from '@/lib/dashboard/hooks';

export default function OnboardingScreen() {
  const router = useRouter();
  const { data } = useDashboardStats();

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      <View style={{ flex: 1 }}>
        <OnboardingManager />
      </View>
      <DashboardTabBar
        active="admin"
        centerBadge={data?.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}
