export type PayoutStatus =
  | 'pending'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'on_hold';

export type RestaurantPayout = {
  id: string;
  period: string;
  kind: 'weekly' | 'instant' | string;
  ordersCount: number;
  grossAmount: number;
  commissionRate: number;
  commissionAmount: number;
  tdsAmount: number;
  feeAmount: number;
  netAmount: number;
  status: PayoutStatus | string;
  bankLast4?: string;
  ifscCode?: string;
  paidAt?: string | null;
  failureReason?: string | null;
  createdAt?: string;
};

export type RestaurantInvoice = {
  invoiceId: string;
  payoutId: string;
  restaurantId?: string;
  period: string;
  invoiceType: string;
  currency: string;
  grossAmount: number;
  commissionAmount: number;
  tdsAmount: number;
  netAmount: number;
  gstOnCommission: number;
  status: string;
  issuedAt?: string;
  paidAt?: string | null;
};

export type FinancePage<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
};

export type CommissionFeeRow = {
  id: string;
  label: string;
  type: 'percent' | 'flat' | string;
  value: number;
  description: string;
};

export type RestaurantCommission = {
  restaurantId: string;
  commissionRate: number;
  commissionPercent: number;
  tdsRate: number;
  tdsPercent: number;
  currency: string;
  effectiveFrom: string | null;
  feeSchedule: CommissionFeeRow[];
  source: 'restaurant_override' | 'platform_default' | string;
};
