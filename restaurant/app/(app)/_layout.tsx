import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { RestaurantLiveSync } from '@/components/dashboard/RestaurantLiveSync';
import { KitchenConfigGate } from '@/components/dashboard/KitchenConfigGate';
import { KitchenPushSync } from '@/components/dashboard/KitchenPushSync';
import {
  portalMismatchRedirect,
  resolvePostAuthRoute,
} from '@/lib/navigation/post-auth';
import { useAuthStore } from '@/store/auth-store';

type Gate = 'loading' | 'restaurant-setup' | 'delivery-setup' | 'ready';

/**
 * Auth + portal gate for signed-in screens.
 * Always mounts <Stack /> — early returns without a navigator crash Expo Router.
 */
export default function AppLayout() {
  const router = useRouter();
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const segments = useSegments();

  const [gate, setGate] = useState<Gate>('loading');
  const resolvedForToken = useRef<string | null>(null);
  const redirectingRef = useRef(false);

  const effectiveRole = user?.role ?? role;

  useEffect(() => {
    if (!isHydrated) return;

    if (!token) {
      setGate('loading');
      resolvedForToken.current = null;
      return;
    }

    if (resolvedForToken.current === token) {
      return;
    }

    if (effectiveRole === 'delivery') {
      resolvedForToken.current = token;
      setGate('ready');
      return;
    }

    let active = true;
    setGate('loading');

    void resolvePostAuthRoute(effectiveRole)
      .then((route) => {
        if (!active) return;
        resolvedForToken.current = token;
        if (route === '/restaurant-setup') setGate('restaurant-setup');
        else setGate('ready');
      })
      .catch(() => {
        if (!active) return;
        resolvedForToken.current = token;
        setGate('restaurant-setup');
      });

    return () => {
      active = false;
    };
  }, [isHydrated, token, user?.id, user?.role, role, effectiveRole]);

  useEffect(() => {
    if (gate !== 'loading' || !token) return;
    const timer = setTimeout(() => {
      resolvedForToken.current = token;
      setGate('ready');
    }, 10000);
    return () => clearTimeout(timer);
  }, [gate, token]);

  useEffect(() => {
    if (!isHydrated || !token) return;
    if (gate !== 'restaurant-setup') return;
    if (effectiveRole === 'delivery') return;

    const onRestaurantSetup = segments.includes('restaurant-setup');
    if (onRestaurantSetup) return;

    let active = true;
    void resolvePostAuthRoute(effectiveRole)
      .then((route) => {
        if (!active) return;
        resolvedForToken.current = token;
        setGate(route === '/restaurant-setup' ? 'restaurant-setup' : 'ready');
      })
      .catch(() => {
        if (!active) return;
        resolvedForToken.current = token;
        setGate('ready');
      });

    return () => {
      active = false;
    };
  }, [segments.join('/'), gate, isHydrated, token, effectiveRole]);

  // Imperative redirects — keep Stack mounted to avoid layout-context crashes.
  useEffect(() => {
    if (!isHydrated) return;
    if (redirectingRef.current) return;

    const go = (href: string) => {
      redirectingRef.current = true;
      router.replace(href as never);
      // Allow future redirects after navigation settles
      setTimeout(() => {
        redirectingRef.current = false;
      }, 400);
    };

    if (!token) {
      go('/login');
      return;
    }

    if (gate === 'loading') return;

    const onRestaurantSetup = segments.includes('restaurant-setup');
    const onStaffInvite =
      segments.includes('staff') && segments.includes('invite');
    const onDeliverySetup =
      segments.includes('delivery-setup') ||
      (segments.includes('delivery') && segments.includes('setup'));

    const portalRedirect = portalMismatchRedirect(effectiveRole, segments);
    if (portalRedirect) {
      go(portalRedirect);
      return;
    }

    if (
      effectiveRole === 'restaurant' &&
      gate === 'restaurant-setup' &&
      !onRestaurantSetup &&
      !onStaffInvite
    ) {
      go('/restaurant-setup');
      return;
    }

    if (effectiveRole === 'delivery' && onDeliverySetup) {
      go('/delivery');
      return;
    }

    if (
      effectiveRole === 'restaurant' &&
      gate === 'ready' &&
      onRestaurantSetup
    ) {
      go('/dashboard');
    }
  }, [
    isHydrated,
    token,
    gate,
    effectiveRole,
    segments.join('/'),
    router,
  ]);

  const showBlockingLoader =
    !isHydrated || !token || gate === 'loading';

  return (
    <View style={{ flex: 1, backgroundColor: '#FFF7F2' }}>
      {gate === 'ready' && effectiveRole === 'restaurant' ? (
        <>
          <RestaurantLiveSync />
          <KitchenConfigGate />
          <KitchenPushSync />
        </>
      ) : null}
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: '#FFF7F2' },
        }}
      />
      {showBlockingLoader ? (
        <View
          pointerEvents="auto"
          style={{
            ...StyleSheetAbsoluteFill,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#FFF7F2',
          }}
        >
          <ActivityIndicator color={authTheme.brand} size="large" />
        </View>
      ) : null}
    </View>
  );
}

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};
