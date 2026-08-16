import { useCallback, useEffect, useState } from 'react';

import { warmGatewaySession } from '@/lib/gateway/api';

export type GatewayProbe = {
  reachable: boolean | null;
  readyStatus?: string;
  degraded: boolean;
  checking: boolean;
  retry: () => void;
};

const RETRY_UNREACHABLE_MS = 12_000;

/** Splash / login: probe GET /health then GET /health/ready, then CSRF. */
export function useGatewayProbe(enabled = true): GatewayProbe {
  const [probe, setProbe] = useState<Omit<GatewayProbe, 'retry'>>({
    reachable: null,
    checking: true,
    degraded: false,
  });

  const run = useCallback(async () => {
    if (!enabled) return;
    setProbe((current) => ({ ...current, checking: true }));
    const result = await warmGatewaySession();
    setProbe({
      reachable: result.reachable,
      readyStatus: result.readyStatus,
      degraded: result.degraded,
      checking: false,
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void run();
  }, [enabled, run]);

  useEffect(() => {
    if (!enabled || probe.reachable !== false) return;
    const timer = setTimeout(() => {
      void run();
    }, RETRY_UNREACHABLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, probe.reachable, run]);

  return {
    ...probe,
    retry: () => {
      void run();
    },
  };
}
