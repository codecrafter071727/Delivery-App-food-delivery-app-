import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { partnerSupportApi } from '@/lib/delivery-partner/support-api';
import type { CreateSupportTicketPayload } from '@/lib/delivery-partner/support-types';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerSupportKeys = {
  all: [...deliveryPartnerKeys.all, 'support'] as const,
  hub: () => [...partnerSupportKeys.all, 'hub'] as const,
};

/** Partner support hub (contact, FAQ, tickets). Mock until APIs ship. */
export function usePartnerSupportHub(enabled = true) {
  const isActive = useAppIsActive();

  return useQuery({
    queryKey: partnerSupportKeys.hub(),
    queryFn: () => partnerSupportApi.getHub(),
    enabled,
    staleTime: LIVE_INTERVALS.deliverySupport / 2,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliverySupport,
      isActive
    ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });
}

export function useCreateSupportTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateSupportTicketPayload) =>
      partnerSupportApi.createTicket(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: partnerSupportKeys.hub(),
      });
    },
  });
}
