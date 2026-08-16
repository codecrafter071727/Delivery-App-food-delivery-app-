import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import {
  formatBankError,
  partnerBankApi,
} from '@/lib/delivery-partner/bank-api';
import {
  isValidIfsc,
  normalizeIfsc,
  type SavePartnerBankPayload,
  type UpdateTaxDetailsPayload,
} from '@/lib/delivery-partner/bank-types';

export const partnerBankKeys = {
  all: [...deliveryPartnerKeys.all, 'bank'] as const,
  bank: () => [...partnerBankKeys.all, 'details'] as const,
  ifsc: (code: string) => [...partnerBankKeys.all, 'ifsc', code] as const,
  tax: () => [...partnerBankKeys.all, 'tax'] as const,
  taxDocs: () => [...partnerBankKeys.all, 'tax-documents'] as const,
};

export function usePartnerBank(enabled = true) {
  return useQuery({
    queryKey: partnerBankKeys.bank(),
    queryFn: () => partnerBankApi.getBank(),
    enabled,
    staleTime: 20_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

export function useIfscLookup(ifsc: string, enabled = true) {
  const code = normalizeIfsc(ifsc);
  const valid = isValidIfsc(code);
  return useQuery({
    queryKey: partnerBankKeys.ifsc(code),
    queryFn: () => partnerBankApi.lookupIfsc(code),
    enabled: enabled && valid,
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });
}

export function usePartnerTaxDetails(enabled = true) {
  return useQuery({
    queryKey: partnerBankKeys.tax(),
    queryFn: () => partnerBankApi.getTaxDetails(),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

export function usePartnerTaxDocuments(enabled = true) {
  return useQuery({
    queryKey: partnerBankKeys.taxDocs(),
    queryFn: () => partnerBankApi.listTaxDocuments(),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
    placeholderData: (previous) => previous,
  });
}

export function usePartnerBankMutations() {
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: partnerBankKeys.all }),
      queryClient.invalidateQueries({ queryKey: deliveryPartnerKeys.me() }),
    ]);
  };

  const saveBank = useMutation({
    mutationFn: (payload: SavePartnerBankPayload) =>
      partnerBankApi.saveBank(payload),
    onSuccess: async (bank) => {
      queryClient.setQueryData(partnerBankKeys.bank(), bank);
      await invalidate();
    },
  });

  const sendOtp = useMutation({
    mutationFn: () => partnerBankApi.sendBankOtp(),
  });

  const verifyBank = useMutation({
    mutationFn: () => partnerBankApi.verifyBank(),
    onSuccess: async (bank) => {
      queryClient.setQueryData(partnerBankKeys.bank(), bank);
      await invalidate();
    },
  });

  const updateTax = useMutation({
    mutationFn: (payload: UpdateTaxDetailsPayload) =>
      partnerBankApi.updateTaxDetails(payload),
    onSuccess: async (tax) => {
      queryClient.setQueryData(partnerBankKeys.tax(), tax);
      await queryClient.invalidateQueries({ queryKey: partnerBankKeys.tax() });
    },
  });

  return {
    saveBank,
    sendOtp,
    verifyBank,
    updateTax,
    invalidate,
    formatError: formatBankError,
  };
}

export { formatBankError };
