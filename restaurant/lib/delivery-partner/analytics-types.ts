/**
 * Partner analytics — GET /partners/me/performance + earnings + incentives.
 */

export type PartnerRatingBucket = {
  label: string;
  /** Star value e.g. 5, 4, 3, or 0 for "<3" */
  stars?: number;
  count: number;
  percent?: number;
};

export type PartnerPerformance = {
  totalDeliveries: number;
  avgRating: number;
  completionRate: number;
  acceptanceRate: number;
  onTimeRate: number;
  cancellationRate: number;
  currentStreak: number;
  /** From API only — never invent on the client */
  performanceScore?: number;
  scoreLabel?: string;
  ratingCount?: number;
  /** Real star histogram from API — omit when backend doesn't send it */
  ratingDistribution?: PartnerRatingBucket[];
  /** Milestone targets from API if provided */
  streakMilestones?: number[];
  raw?: Record<string, unknown>;
};

export type PartnerDailyEarning = {
  date: string;
  label: string;
  orders: number;
  earnings: number;
  baseEarnings?: number;
  incentives?: number;
  tips?: number;
};

export type PartnerPayoutAccount = {
  bankAccountNo?: string;
  ifscCode?: string;
  upiId?: string;
  accountHolderName?: string;
  bankName?: string;
};

/** GET /partners/me/earnings — IST today / ISO week / calendar month. */
export type EarningsPeriodKey = 'today' | 'week' | 'month' | 'lifetime';

export type EarningsPeriod = {
  from?: string;
  to?: string;
  totalEarnings: number;
  baseEarnings: number;
  incentives: number;
  tips: number;
  deductions: number;
  totalDeliveries: number;
  onlineHours: number;
};

export type PartnerEarningsSummary = {
  timezone?: string;
  today: EarningsPeriod;
  week: EarningsPeriod;
  month: EarningsPeriod;
  lifetime: { totalEarnings: number; totalDeliveries: number };
  currency: string;
  payout?: PartnerPayoutAccount;
  raw?: Record<string, unknown>;
};

export type PartnerDailyEarningsResult = {
  days: number;
  points: PartnerDailyEarning[];
};

/** GET /partners/me/incentives — bonus / incentive programs */
export type PartnerIncentive = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  type?: string;
  amount?: number;
  currency?: string;
  progress?: number;
  target?: number;
  progressLabel?: string;
  startsAt?: string;
  endsAt?: string;
  raw?: Record<string, unknown>;
};

export type PartnerIncentivesResult = {
  incentives: PartnerIncentive[];
};

export type EarningsPeriodDays = 1 | 7 | 30 | 90;
