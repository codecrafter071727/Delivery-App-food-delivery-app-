import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { refreshCsrfToken } from '@/lib/api';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { resolvePostAuthRoute } from '@/lib/navigation/post-auth';
import { useAuthStore } from '@/store/auth-store';

/**
 * Auth screens layout. Always mounts Stack; redirects authed users via router.replace.
 */
export default function AuthLayout() {
  const router = useRouter();
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);

  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (isHydrated && !token) {
      refreshCsrfToken().catch(() => {
        // Warm-up only; register/login will surface errors if this fails.
      });
    }
  }, [isHydrated, token]);

  useEffect(() => {
    if (!isHydrated || !token) {
      setResolving(false);
      return;
    }

    let active = true;
    setResolving(true);
    const effectiveRole = user?.role ?? role;

    void resolvePostAuthRoute(effectiveRole)
      .then((route) => {
        if (!active) return;
        router.replace(route);
      })
      .catch(() => {
        if (!active) return;
        router.replace(
          effectiveRole === 'delivery'
            ? DELIVERY_ROUTES.home
            : '/restaurant-setup'
        );
      })
      .finally(() => {
        if (active) setResolving(false);
      });

    return () => {
      active = false;
    };
  }, [isHydrated, token, user?.id, user?.role, role, router]);

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#FFFFFF' },
        }}
      />
      {!isHydrated || (token && resolving) ? (
        <View
          pointerEvents="auto"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FFFFFF',
          }}
        >
          <ActivityIndicator color={authTheme.brand} size="large" />
        </View>
      ) : null}
    </View>
  );
}
