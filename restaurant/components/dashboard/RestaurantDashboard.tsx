import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar';
import { DashboardHeader } from '@/components/dashboard/DashboardHeader';
import { KitchenDutyCard } from '@/components/dashboard/KitchenDutyCard';
import { KitchenKycBanner } from '@/components/dashboard/KitchenKycBanner';
import { TodayStatsCard } from '@/components/dashboard/TodayStatsCard';
import { PendingOrdersSection } from '@/components/dashboard/PendingOrdersSection';
import { QuickActionsGrid } from '@/components/dashboard/QuickActionsGrid';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useDashboardStats } from '@/lib/dashboard/hooks';
import { isRestaurantProfileComplete } from '@/lib/navigation/post-auth';
import { useUnreadNotificationCount } from '@/lib/notification/hooks';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { restaurantOwnerApi } from '@/lib/restaurant/api';
import {
  restaurantOutletKeys,
  useKitchenDuty,
  useRestaurantServiceHealth,
} from '@/lib/restaurant/hooks';
import { isListingLive } from '@/lib/restaurant/listing-status';
import { getRestaurantVerificationBadge } from '@/lib/restaurant/verification';
import type { KitchenDutySnapshot } from '@/lib/restaurant/types';
import { useAuthStore } from '@/store/auth-store';

function dutyHeadline(duty?: KitchenDutySnapshot) {
  if (!duty) return undefined;
  if (!isListingLive(duty.status)) {
    return 'Listing not live';
  }
  if (duty.duty === 'paused') {
    const reason =
      duty.pauseReason === 'too_busy'
        ? 'too busy'
        : duty.pauseReason === 'staffing'
          ? 'short staff'
          : duty.pauseReason === 'packaging'
            ? 'packing delay'
            : duty.pauseReason === 'closing_soon'
              ? 'closing soon'
              : duty.pauseReason;
    return reason ? `Paused · ${reason}` : 'Kitchen paused';
  }
  if (duty.duty === 'online') {
    return duty.openNow ? 'Open now' : 'Online · closed hours';
  }
  return 'Kitchen offline';
}

export function RestaurantDashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const { data, isLoading, isRefetching, refetch, error } = useDashboardStats(
    profileComplete === true
  );
  const restaurant = useMyRestaurantId();
  const duty = useKitchenDuty(
    restaurant.data?.id,
    profileComplete === true
  );
  const serviceHealth = useRestaurantServiceHealth(profileComplete === true);
  const unreadQuery = useUnreadNotificationCount({
    enabled: profileComplete === true,
    refetchOnMount: true,
  });
  const verification = getRestaurantVerificationBadge(
    restaurant.data?.listingStatus ?? restaurant.data?.status
  );
  const dutyLabel = dutyHeadline(duty.data);
  const dutyOnline =
    isListingLive(duty.data?.status) &&
    duty.data?.duty === 'online' &&
    duty.data.isOnline === true;

  const headerDuty = {
    dutyLabel:
      serviceHealth.data && !serviceHealth.data.ok
        ? 'Kitchen unavailable'
        : dutyLabel,
    dutyOnline:
      serviceHealth.data && !serviceHealth.data.ok ? false : dutyOnline,
  };

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email?.split('@')[0] ||
    'Partner';

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) setProfileComplete(true);
    }, 8000);

    restaurantOwnerApi
      .getMyRestaurant()
      .then((my) => {
        if (!active) return;
        setProfileComplete(isRestaurantProfileComplete(my));
      })
      .catch(() => {
        if (!active) return;
        setProfileComplete(true);
      })
      .finally(() => clearTimeout(timer));

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (profileComplete === false) {
      router.replace('/restaurant-setup');
    }
  }, [profileComplete, router]);

  if (profileComplete === null || profileComplete === false || (isLoading && !data)) {
    return (
      <View style={[styles.screen, styles.center]}>
        <StatusBar style="dark" />
        <ActivityIndicator color={authTheme.brand} size="large" />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <DashboardHeader
          name={displayName}
          unreadNotifications={unreadQuery.data ?? 0}
          verificationLabel={verification.label}
          verificationColor={verification.color}
          verificationSoft={verification.soft}
          dutyLabel={headerDuty.dutyLabel}
          dutyOnline={headerDuty.dutyOnline}
          onProfilePress={() => router.replace('/admin')}
          onNotificationsPress={() => router.push('/notifications')}
        />
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={authTheme.brand} />
        </View>
        <DashboardTabBar active="stats" onNavigate={(href) => router.replace(href)} />
      </View>
    );
  }

  const dashboard = data!;

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
              void duty.refetch();
              void serviceHealth.refetch();
              void queryClient.invalidateQueries({
                queryKey: restaurantOutletKeys.all,
              });
            }}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
      >
        <DashboardHeader
          name={displayName}
          restaurantName={dashboard.restaurantName}
          restaurantCity={dashboard.city}
          logoUrl={dashboard.logoUrl}
          unreadNotifications={unreadQuery.data ?? 0}
          verificationLabel={verification.label}
          verificationColor={verification.color}
          verificationSoft={verification.soft}
          dutyLabel={headerDuty.dutyLabel}
          dutyOnline={headerDuty.dutyOnline}
          onProfilePress={() => router.replace('/admin')}
          onNotificationsPress={() => router.push('/notifications')}
        />

        {serviceHealth.data && !serviceHealth.data.ok ? (
          <View style={styles.healthBanner}>
            <Text style={styles.healthWarn}>
              {serviceHealth.data.message ??
                'Restaurant service is down. Orders may not update until it recovers.'}
            </Text>
          </View>
        ) : null}

        <View style={styles.body}>
          {restaurant.data?.id ? (
            <KitchenDutyCard
              restaurantId={restaurant.data.id}
              compact
              onHoursPress={() => router.replace('/settings')}
            />
          ) : null}
          <KitchenKycBanner
            restaurantId={restaurant.data?.id}
            onPress={() => router.push('/onboarding')}
          />
          <TodayStatsCard
            restaurantId={restaurant.data?.id}
            metrics={dashboard.metrics}
            onRatingPress={() => router.push('/reviews')}
          />
          <PendingOrdersSection
            orders={dashboard.pendingOrders}
            onQueuePress={() => router.replace('/orders')}
            onOrderPress={(order) => {
              router.push(`/order/${encodeURIComponent(order.id)}`);
            }}
          />
          <QuickActionsGrid
            actions={dashboard.quickActions}
            onOrdersPress={() => router.replace('/orders')}
            onMenuPress={() => router.replace('/menu')}
            onPromosPress={() => router.replace('/offers')}
            onAnalyticsPress={() => router.push('/analytics')}
            onReviewsPress={() => router.push('/reviews')}
            onPartnersPress={() => router.push('/partners')}
          />
        </View>
      </ScrollView>

      <DashboardTabBar
        active="stats"
        centerBadge={dashboard.quickActions.activeOrders}
        onNavigate={(href) => router.replace(href)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: authTheme.surface,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
  },
  healthBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FECACA',
  },
  healthWarn: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.error,
    lineHeight: 18,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
});
