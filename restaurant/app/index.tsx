import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';

import { AuthLoadingScreen } from '@/components/auth/AuthLoadingScreen';
import { useGatewayProbe } from '@/lib/gateway/hooks';
import {
  resolvePostAuthRoute,
  type PostAuthRoute,
} from '@/lib/navigation/post-auth';
import { useAuthStore } from '@/store/auth-store';

type Target = '/login' | PostAuthRoute;

export default function Index() {
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.role);
  const user = useAuthStore((s) => s.user);
  const gateway = useGatewayProbe(isHydrated);

  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    if (!isHydrated) return;

    if (!token) {
      setTarget('/login');
      return;
    }

    let active = true;
    const effectiveRole = user?.role ?? role;

    void resolvePostAuthRoute(effectiveRole)
      .then((route) => {
        if (!active) return;
        setTarget(route);
      })
      .catch(() => {
        if (!active) return;
        setTarget(
          effectiveRole === 'delivery' ? '/delivery' : '/restaurant-setup'
        );
      });

    return () => {
      active = false;
    };
  }, [isHydrated, token, user?.id, user?.role, role]);

  if (!isHydrated) {
    return <AuthLoadingScreen message="Loading…" />;
  }

  if (gateway.reachable === false) {
    return (
      <AuthLoadingScreen
        error
        retrying={gateway.checking}
        onRetry={gateway.retry}
        message="Can't reach TOKAJO servers. Check your internet and try again."
      />
    );
  }

  if (!target || gateway.reachable == null) {
    return <AuthLoadingScreen message="Connecting to live servers…" />;
  }

  return <Redirect href={target} />;
}
