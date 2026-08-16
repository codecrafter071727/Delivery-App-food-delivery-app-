/** Matches restaurant-service `RevenuePeriod` — never `year` (max range is 90d). */
export type AnalyticsPeriod = 'day' | 'week' | 'month';

export type AnalyticsRange = {
  period: AnalyticsPeriod;
  from: string;
  to: string;
};

export type AnalyticsOverview = {
  ordersToday: number;
  revenueToday: number;
  totalOrders: number;
  totalRevenue: number;
  avgRating: number;
  totalRatings: number;
  activeItems: number;
  totalCategories: number;
  /** Derived: totalRevenue / totalOrders when both are finite and orders > 0. */
  avgOrderValue: number | null;
};

export type RevenuePoint = {
  label: string;
  date?: string;
  revenue: number;
  orders: number;
};

export type RevenueAnalytics = {
  points: RevenuePoint[];
  totalRevenue: number | null;
  totalOrders: number | null;
};

export type TopSellingItem = {
  id?: string;
  name: string;
  orders: number;
  revenue?: number;
  image?: string;
};

export type OrdersHourPoint = {
  hour: number;
  count: number;
  revenue: number;
};

export type OrdersStatusPoint = {
  status: string;
  count: number;
  revenue: number;
};

export type OrdersAnalytics = {
  restaurantId: string;
  from: string;
  to: string;
  timezone: string;
  byHour: OrdersHourPoint[];
  byStatus: OrdersStatusPoint[];
  totals: { orders: number; revenue: number };
};

export type CancellationTotals = {
  orders: number;
  rejected: number;
  cancelled: number;
  cancelledByCustomer: number;
  cancelledByRestaurant: number;
  cancelledBySystem: number;
  rejectRate: number;
  customerCancelRate: number;
  cancelRate: number;
};

export type CancellationsAnalytics = {
  restaurantId: string;
  from: string;
  to: string;
  timezone: string;
  totals: CancellationTotals;
  byRejectReason: Array<{ code: string; count: number }>;
  byCancelledBy: Array<{ by: string; count: number }>;
  daily: Array<{ date: string; orders: number; rejected: number; cancelled: number }>;
};

export type AnalyticsCsvExport = {
  csv: string;
  filename: string;
  rowCount: number;
};

/** @deprecated Use AnalyticsRange. Kept so older call sites compile during the swap. */
export type AnalyticsRangeParams = AnalyticsRange & {
  startDate?: string;
  endDate?: string;
  limit?: number;
};

export type AnalyticsCategorySlice = {
  name: string;
  value: number;
  percent: number;
  color: string;
};
