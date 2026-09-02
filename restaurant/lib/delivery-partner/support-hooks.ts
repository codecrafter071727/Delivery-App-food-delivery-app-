import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { partnerSupportApi } from '@/lib/delivery-partner/support-api';
import type {
  AddSupportTicketMessagePayload,
  CreateSupportTicketPayload,
} from '@/lib/delivery-partner/support-types';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';

export const partnerSupportKeys = {
  all: [...deliveryPartnerKeys.all, 'support'] as const,
  hub: () => [...partnerSupportKeys.all, 'hub'] as const,
  ticket: (ticketId: string) =>
    [...partnerSupportKeys.all, 'ticket', ticketId] as const,
};

/** Partner support hub (FAQ + tickets from live APIs). */
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

export function usePartnerSupportTicket(ticketId: string | null) {
  const isActive = useAppIsActive();
  return useQuery({
    queryKey: partnerSupportKeys.ticket(ticketId ?? ''),
    queryFn: () => partnerSupportApi.getTicket(ticketId!),
    enabled: Boolean(ticketId),
    staleTime: 10_000,
    refetchInterval: liveRefetchInterval(
      LIVE_INTERVALS.deliverySupport,
      isActive
    ),
    refetchIntervalInBackground: false,
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

export function useAddSupportTicketMessage(ticketId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: AddSupportTicketMessagePayload) =>
      partnerSupportApi.addMessage(ticketId!, payload),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({
        queryKey: partnerSupportKeys.hub(),
      });
      if (ticketId) {
        queryClient.setQueryData(partnerSupportKeys.ticket(ticketId), detail);
      }
    },
  });
}

export function useCloseSupportTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ticketId: string) => partnerSupportApi.closeTicket(ticketId),
    onSuccess: (detail) => {
      void queryClient.invalidateQueries({
        queryKey: partnerSupportKeys.hub(),
      });
      queryClient.setQueryData(partnerSupportKeys.ticket(detail.id), detail);
    },
  });
}
