import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { usePartnerDutyStatus } from '@/lib/delivery-partner/availability-hooks';
import { isDutySwitchOn } from '@/lib/delivery-partner/availability-types';
import {
  deliveryPartnerKeys,
  useDeliveryPartnerMe,
} from '@/lib/delivery-partner/hooks';
import {
  partnerLocationTracker,
  type LocationSyncSnapshot,
} from '@/lib/delivery-partner/location-tracker';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { partnerTrackingKeys } from '@/lib/delivery-partner/tracking-hooks';

/**
 * Starts GPS ping + heartbeat while the partner is online.
 * When ping/heartbeat reports activeDeliveryId, refresh the trip and open Orders.
 */
export function usePartnerLocationSync(enabled = true) {
  const me = useDeliveryPartnerMe(enabled);
  const duty = usePartnerDutyStatus(enabled);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const dutyStatus = duty.data?.dutyStatus ?? me.data?.dutyStatus;
  const isOnline = isDutySwitchOn(
    dutyStatus,
    Boolean(me.data?.isOnline ?? me.data?.isAvailable ?? duty.data?.isOnline)
  );
  const shouldTrack = enabled && isOnline && Boolean(me.data?.id);
  const startedRef = useRef(false);
  const lastDeliveryIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!shouldTrack) {
        startedRef.current = false;
        lastDeliveryIdRef.current = null;
        await partnerLocationTracker.stop();
        return;
      }

      if (partnerLocationTracker.isRunning() || startedRef.current) {
        return;
      }

      startedRef.current = true;
      try {
        await partnerLocationTracker.start();
      } catch {
        startedRef.current = false;
      }

      if (cancelled) {
        await partnerLocationTracker.stop();
        startedRef.current = false;
      }
    };

    void run();

    return () => {
      cancelled = true;
      startedRef.current = false;
      void partnerLocationTracker.stop();
    };
  }, [shouldTrack]);

  useEffect(() => {
    if (!shouldTrack) return;

    return partnerLocationTracker.subscribeSnapshot((snap) => {
      const nextId = snap.activeDeliveryId ?? null;
      const prevId = lastDeliveryIdRef.current;
      if (nextId === prevId) return;
      lastDeliveryIdRef.current = nextId;

      void queryClient.invalidateQueries({
        queryKey: deliveryPartnerKeys.active(),
      });
      void queryClient.invalidateQueries({
        queryKey: partnerTrackingKeys.all,
      });
      void queryClient.invalidateQueries({
        queryKey: [...deliveryPartnerKeys.all, 'availability'],
      });

      if (nextId && prevId == null) {
        const onOrders =
          pathname === DELIVERY_ROUTES.orders ||
          pathname?.includes('/delivery/orders');
        if (!onOrders) {
          router.push(DELIVERY_ROUTES.orders as never);
        }
      }
    });
  }, [shouldTrack, queryClient, router, pathname]);
}

export function useLocationSyncSnapshot(): LocationSyncSnapshot | null {
  const [snap, setSnap] = useState<LocationSyncSnapshot | null>(() =>
    partnerLocationTracker.isRunning()
      ? partnerLocationTracker.getSnapshot()
      : null
  );

  useEffect(() => {
    return partnerLocationTracker.subscribeSnapshot(setSnap);
  }, []);

  return snap;
}
