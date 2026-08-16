import { Redirect } from 'expo-router';
import { lazy, Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { useAuthStore } from '@/store/auth-store';

const RestaurantDashboard = lazy(() =>
  import('@/components/dashboard/RestaurantDashboard').then((mod) => ({
    default: mod.RestaurantDashboard,
  }))
);

function DashboardFallback() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#F3F4F6',
      }}
    >
      <ActivityIndicator color={authTheme.brand} size="large" />
    </View>
  );
}

/** Restaurant owner home. Delivery partners use /delivery. */
export default function DashboardScreen() {
  const role = useAuthStore((s) => s.user?.role ?? s.role);
  const isHydrated = useAuthStore((s) => s.isHydrated);

  if (!isHydrated) {
    return <DashboardFallback />;
  }

  if (role === 'delivery') {
    return <Redirect href={DELIVERY_ROUTES.home} />;
  }

  return (
    <Suspense fallback={<DashboardFallback />}>
      <RestaurantDashboard />
    </Suspense>
  );
}
