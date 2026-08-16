import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { DeliveryLiveSync } from '@/components/delivery/DeliveryLiveSync';
import { PlatformPushSync } from '@/components/delivery/profile/PlatformPushSync';
import { usePartnerLocationSync } from '@/lib/delivery-partner/use-partner-location-sync';
import { useDeliveryNotificationSync } from '@/lib/notification/use-notification-sync';
import { useAuthStore } from '@/store/auth-store';

/**
 * Delivery partner portal routes live under /delivery/*.
 * Always mounts Stack (required by Expo Router). Restaurant sessions redirect out.
 */
export default function DeliveryLayout() {
  const router = useRouter();
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const role = useAuthStore((s) => s.user?.role ?? s.role);
  const isDelivery = isHydrated && role === 'delivery';

  useDeliveryNotificationSync(isDelivery);
  usePartnerLocationSync(isDelivery);

  useEffect(() => {
    if (!isHydrated) return;
    if (role !== 'delivery') {
      router.replace('/dashboard');
    }
  }, [isHydrated, role, router]);

  return (
    <>
      <DeliveryLiveSync enabled={isDelivery} />
      <PlatformPushSync enabled={isDelivery} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: '#F6F6F7' },
        }}
      />
    </>
  );
}
