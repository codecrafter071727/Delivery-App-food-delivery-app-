/**
 * Rider net pay — delivery fee minus platform commission; incentive/tip added as-is.
 * Commission % comes from GET /partners/me/config/pricing-rules when cached.
 */

export const DEFAULT_PARTNER_COMMISSION_PCT = 12;

export type PartnerTripPay = {
  basePay: number;
  incentive: number;
  tip: number;
  netTotal: number;
  commissionPercent: number;
  showIncentive: boolean;
};

let cachedCommissionPct: number | null = null;

export function setPartnerCommissionPercent(pct: number | null) {
  cachedCommissionPct =
    pct != null && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null;
}

export function resolveCommissionPercent(input?: {
  platformCommissionPct?: number;
  partnerSharePct?: number;
}): number {
  if (cachedCommissionPct != null) return cachedCommissionPct;
  if (
    input?.platformCommissionPct != null
    && Number.isFinite(input.platformCommissionPct)
  ) {
    return input.platformCommissionPct;
  }
  if (input?.partnerSharePct != null && Number.isFinite(input.partnerSharePct)) {
    return Math.max(0, 100 - input.partnerSharePct);
  }
  return DEFAULT_PARTNER_COMMISSION_PCT;
}

export function partnerNetFromDeliveryFee(
  deliveryFee: number,
  commissionPercent = DEFAULT_PARTNER_COMMISSION_PCT
): number {
  const rate =
    commissionPercent > 1 ? commissionPercent / 100 : commissionPercent;
  return Math.round(Math.max(0, deliveryFee) * (1 - rate));
}

export function resolvePartnerTripPay(input: {
  deliveryFee?: number;
  partnerEarnings?: number;
  incentiveBonus?: number;
  tipAmount?: number;
  commissionPercent?: number;
  partnerSharePct?: number;
  platformCommissionPct?: number;
}): PartnerTripPay | null {
  const fee = input.deliveryFee;
  const commissionPercent = resolveCommissionPercent({
    platformCommissionPct: input.platformCommissionPct ?? input.commissionPercent,
    partnerSharePct: input.partnerSharePct,
  });
  const basePay =
    input.partnerEarnings ??
    (fee != null && Number.isFinite(fee)
      ? partnerNetFromDeliveryFee(fee, commissionPercent)
      : null);
  if (basePay == null || !Number.isFinite(basePay)) return null;

  const incentive = Math.max(0, input.incentiveBonus ?? 0);
  const tip = Math.max(0, input.tipAmount ?? 0);
  return {
    basePay,
    incentive,
    tip,
    netTotal: basePay + incentive + tip,
    commissionPercent,
    showIncentive: incentive > 0,
  };
}

export function resolvePartnerDisplayEarning(input: {
  deliveryFee?: number;
  partnerEarnings?: number;
  incentiveBonus?: number;
  tipAmount?: number;
}): number | undefined {
  const pay = resolvePartnerTripPay(input);
  return pay?.netTotal;
}
