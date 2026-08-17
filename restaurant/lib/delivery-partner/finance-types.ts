/**
 * Rider wallet, payouts, COD — GET/POST /partners/me/{wallet,payouts,cod,earnings/:id}
 */

export type WalletCodSnapshot = {
  cashInHand: number;
  limit: number;
  remainingCapacity: number;
  blocked: boolean;
  remitDueToday: boolean;
};

export type PartnerWallet = {
  currency: string;
  earningsBalance: number;
  pendingPayouts: number;
  lifetimeEarnings: number;
  cashInHand: number;
  nextWeeklyPayoutAt?: string;
  instantEligible: boolean;
  cod?: WalletCodSnapshot;
};

export type WalletTxnType =
  | 'delivery_credit'
  | 'payout_debit'
  | 'cod_collect'
  | 'cod_remit'
  | 'cod_adjust'
  | 'incentive_credit'
  | 'referral_credit'
  | string;

export type WalletTransaction = {
  id: string;
  type: WalletTxnType;
  direction?: 'credit' | 'debit' | string;
  amount: number;
  feeAmount?: number;
  netAmount?: number;
  currency: string;
  status?: string;
  deliveryId?: string;
  orderId?: string;
  payoutId?: string;
  remittanceId?: string;
  note?: string;
  createdAt?: string;
};

export type WalletTransactionsResult = {
  items: WalletTransaction[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type CodPending = {
  currency: string;
  cashInHand: number;
  limit: number;
  remainingCapacity: number;
  blocked: boolean;
  remitDueToday: boolean;
  remittedLifetime: number;
  minRemit: number;
  maxRemit: number;
  todayCollected?: number;
  todayCount?: number;
};

export type CodLimitStatus = {
  cashInHand: number;
  limit: number;
  remainingCapacity: number;
  usedPercent: number;
  blocked: boolean;
  remitDueToday: boolean;
  blocksNewCodOrders: boolean;
  code?: string;
  message?: string;
};

export type CodRemitMethod = 'hub_cash' | 'upi' | 'bank_deposit';

export const COD_REMIT_METHODS: { code: CodRemitMethod; label: string }[] = [
  { code: 'hub_cash', label: 'Hub cash drop' },
  { code: 'upi', label: 'UPI to platform' },
  { code: 'bank_deposit', label: 'Bank deposit' },
];

export type CodRemitPayload = {
  amount?: number;
  method: CodRemitMethod;
  reference?: string;
  note?: string;
};

export type CodRemittance = {
  remittanceId: string;
  amount: number;
  method: string;
  reference?: string;
  note?: string;
  status: string;
  cashBefore?: number;
  cashAfter?: number;
  remittedAt?: string;
};

export type CodRemittanceHistory = {
  items: CodRemittance[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type CodUpiQr = {
  deliveryId: string;
  orderId?: string;
  amount: number;
  currency: string;
  upiIntent?: string;
  qrImageUrl?: string | null;
  qrId?: string | null;
  expiresAt?: string;
  source?: string;
  settledVia?: string | null;
};

export type CodUpiSettlement = {
  deliveryId: string;
  orderId?: string;
  amount: number;
  settledVia: string;
  cashInHandDelta: number;
  cashInHand: number;
  txnRef?: string;
  collectedAt?: string;
};

export type TripEarningsBreakdown = {
  baseFare?: number;
  distanceFare?: number;
  surge?: number;
  waitTime?: number;
  tip?: number;
  incentive?: number;
  platformFee?: number;
  tds?: number;
};

export type TripEarnings = {
  deliveryId: string;
  orderId?: string;
  status?: string;
  deliveredAt?: string;
  actualDistanceKm?: number;
  waitMinutes?: number;
  currency: string;
  breakdown: TripEarningsBreakdown;
  gross: number;
  net: number;
};

export type PartnerPayoutStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'on_hold'
  | string;

export type PartnerPayout = {
  payoutId: string;
  kind: string;
  status: PartnerPayoutStatus;
  period?: string;
  grossAmount: number;
  feeAmount: number;
  tdsAmount: number;
  netAmount: number;
  bankAccountMasked?: string;
  ifscCode?: string;
  gatewayPayoutId?: string | null;
  failureReason?: string | null;
  gatewayAvailable?: boolean;
  requestedAt?: string;
  paidAt?: string | null;
};

export type PartnerPayoutsResult = {
  items: PartnerPayout[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type InstantEligibility = {
  eligible: boolean;
  reasons: string[];
  availableBalance: number;
  minAmount: number;
  maxAmount: number;
  feePercent: number;
  feeMin: number;
  estimatedFee: number;
  estimatedNet: number;
  dailyRemainingAmount?: number;
  dailyRemainingCount?: number;
  bankOnFile: boolean;
  bankVerified: boolean;
  kycActive: boolean;
  nextWeeklyPayoutAt?: string;
};

export type PayoutSchedule = {
  cycle: string;
  weekday?: string;
  timezone?: string;
  nextPayoutDate?: string;
  nextPayoutAt?: string;
  cutoff?: string;
  currentPeriodLabel?: string;
  instantMin?: number;
  instantFeePercent?: number;
  instantFeeMin?: number;
  instantDailyCap?: number;
  instantDailyCount?: number;
};

export function isCodPayment(method?: string) {
  const key = (method ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  return key === 'cod' || key === 'cash' || key === 'cash_on_delivery';
}

export function payoutStatusLabel(status?: string) {
  const key = (status ?? '').toLowerCase();
  if (key === 'paid') return 'Paid';
  if (key === 'processing') return 'Processing';
  if (key === 'pending') return 'Pending gateway';
  if (key === 'failed') return 'Failed';
  if (key === 'on_hold') return 'On hold';
  return key ? key.replace(/_/g, ' ') : 'Unknown';
}

export function walletTxnLabel(type?: string) {
  const key = (type ?? '').toLowerCase();
  if (key === 'delivery_credit') return 'Trip earning';
  if (key === 'payout_debit') return 'Payout';
  if (key === 'cod_collect') return 'COD collected';
  if (key === 'cod_remit') return 'COD remitted';
  if (key === 'cod_adjust') return 'COD adjustment';
  if (key === 'incentive_credit') return 'Incentive';
  if (key === 'referral_credit') return 'Referral bonus';
  return key ? key.replace(/_/g, ' ') : 'Ledger';
}

export function eligibilityReasonCopy(code?: string) {
  switch ((code ?? '').toUpperCase()) {
    case 'PARTNER_NOT_ACTIVE':
      return 'KYC must be approved before payouts.';
    case 'PARTNER_SUSPENDED':
      return 'Account is suspended.';
    case 'BANK_DETAILS_REQUIRED':
      return 'Add a bank account in Profile.';
    case 'BANK_NOT_VERIFIED':
      return 'Verify bank (penny-drop) before instant payout.';
    case 'BELOW_MINIMUM':
      return 'Balance is below the instant minimum.';
    case 'DAILY_CAP_REACHED':
      return 'Daily instant cap reached. Wait for weekly payout.';
    case 'DAILY_COUNT_REACHED':
      return 'Daily instant count reached.';
    default:
      return code || 'Not eligible for instant payout.';
  }
}
