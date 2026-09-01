import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { deliveryPartnerKeys } from '@/lib/delivery-partner/hooks';
import { setPartnerCommissionPercent } from '@/lib/delivery-partner/partner-earnings';

const PRICING_KEY = [...deliveryPartnerKeys.all, 'pricing-rules'] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

async function fetchPricingRules() {
  const { data } = await api.get<unknown>(
    '/api/v1/delivery-service/partners/me/config/pricing-rules'
  );
  const record = asRecord(data);
  const inner = asRecord(record.data ?? record);
  const fare = asRecord(inner.fare);
  const platformCommissionPct = pickNumber(fare, [
    'platformCommissionPct',
    'commissionPercent',
  ]);
  const partnerSharePct = pickNumber(fare, ['partnerSharePct']);
  const commission =
    platformCommissionPct ??
    (partnerSharePct != null ? Math.max(0, 100 - partnerSharePct) : undefined);
  if (commission != null) setPartnerCommissionPercent(commission);
  return { platformCommissionPct: commission, partnerSharePct };
}

export function usePartnerPricingRules(enabled = true) {
  return useQuery({
    queryKey: PRICING_KEY,
    queryFn: fetchPricingRules,
    enabled,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
}
