/**
 * Rider performance, ratings, tier, warnings, referrals.
 * GET/POST /partners/me/{performance,acceptance-rate,cancellation-rate,
 * ratings,reviews,tier,warnings,referrals}
 */

export type PerformanceRate = {
  metric: string;
  rate: number;
  threshold: number;
  atRisk: boolean;
  direction: 'higher_is_better' | 'lower_is_better' | string;
  timezone?: string;
  note?: string;
};

export type PartnerRating = {
  ratingId: string;
  deliveryId?: string;
  orderId?: string;
  stars: number;
  comment?: string;
  source?: string;
  reviewerMasked?: string;
  createdAt?: string;
};

export type RatingsPage = {
  items: PartnerRating[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type RatingWindow = {
  count: number;
  avg: number;
};

export type RatingSummary = {
  avgRating: number;
  ratingCount: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  last30Days?: RatingWindow;
  previous30Days?: RatingWindow;
  trend: 'up' | 'down' | 'flat' | 'insufficient' | string;
};

export type PartnerTier = {
  code: string;
  label: string;
  perks: string[];
  overridden: boolean;
  ratingCount?: number;
  totalDeliveries?: number;
};

export type TierRequirement = {
  key: string;
  label: string;
  current: number;
  required: number;
  met: boolean;
};

export type TierCriteria = {
  timezone?: string;
  current: PartnerTier;
  next: Pick<PartnerTier, 'code' | 'label' | 'perks'> | null;
  requirements: TierRequirement[];
  progressPercent: number;
};

export type WarningStatus = 'open' | 'acknowledged' | 'expired' | 'resolved' | string;

export type PartnerWarning = {
  warningId: string;
  code?: string;
  severity?: string;
  status: WarningStatus;
  title: string;
  message?: string;
  strikePoints: number;
  autoIssued: boolean;
  issuedAt?: string;
  expiresAt?: string | null;
  acknowledgedAt?: string | null;
};

export type WarningsPage = {
  items: PartnerWarning[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type ReferralPolicy = {
  kycActivateInr: number;
  firstTripsInr: number;
  firstTripsTarget: number;
};

export type ReferralCode = {
  code: string;
  shareUrl?: string;
  shareText?: string;
  referredCount: number;
  timezone?: string;
  policy?: ReferralPolicy;
};

export type ReferredPartner = {
  refereeId: string;
  name: string;
  phoneMasked?: string;
  onboarding?: string;
  earningStatus?: string;
  deliveries: number;
  tripsTarget: number;
  kycBonusInr: number;
  tripsBonusInr: number;
  totalBonusInr: number;
  referredAt?: string;
  activatedAt?: string;
};

export type ReferralsPage = {
  timezone?: string;
  referredCount: number;
  items: ReferredPartner[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type ReferralCredit = {
  refereeId?: string;
  name?: string;
  kind?: string;
  bonusInr: number;
  creditedAt?: string;
};

export type ReferralEarnings = {
  timezone?: string;
  currency: string;
  totalBonusInr: number;
  kycBonusInr: number;
  tripsBonusInr: number;
  pendingBonusInr: number;
  referredCount: number;
  activeCount: number;
  kycCreditedCount: number;
  tripsCreditedCount: number;
  policy?: ReferralPolicy;
  recent: ReferralCredit[];
};

export function warningSeverityLabel(severity?: string) {
  const key = (severity ?? '').toLowerCase();
  if (key === 'low') return 'Low';
  if (key === 'medium') return 'Medium';
  if (key === 'high') return 'High';
  if (key === 'critical') return 'Critical';
  return key ? key.replace(/_/g, ' ') : 'Notice';
}

export function earningStatusLabel(status?: string) {
  const key = (status ?? '').toLowerCase();
  if (key === 'pending_kyc') return 'Waiting KYC';
  if (key === 'kyc_earned') return 'KYC bonus in';
  if (key === 'trips_in_progress') return 'Trips in progress';
  if (key === 'trips_earned') return 'Trip bonus in';
  return key ? key.replace(/_/g, ' ') : 'Pending';
}

export function onboardingLabel(status?: string) {
  const key = (status ?? '').toLowerCase();
  if (key === 'under_review') return 'Under review';
  if (key === 'active') return 'Active';
  if (key === 'registered') return 'Registered';
  if (key === 'suspended') return 'Suspended';
  if (key === 'deactivated') return 'Deactivated';
  return key ? key.replace(/_/g, ' ') : '—';
}

export function ratingTrendLabel(trend?: string) {
  const key = (trend ?? '').toLowerCase();
  if (key === 'up') return 'Up vs last 30 days';
  if (key === 'down') return 'Down vs last 30 days';
  if (key === 'flat') return 'Flat vs last 30 days';
  if (key === 'insufficient') return 'Need 3 ratings in each 30-day window';
  return key ? key.replace(/_/g, ' ') : '';
}

export function tierTone(code?: string) {
  const key = (code ?? '').toLowerCase();
  if (key === 'platinum') return { fg: '#6D28D9', bg: '#EDE9FE' };
  if (key === 'gold') return { fg: '#B45309', bg: '#FEF3C7' };
  if (key === 'silver') return { fg: '#334155', bg: '#E2E8F0' };
  return { fg: '#9A3412', bg: '#FFEDD5' };
}
