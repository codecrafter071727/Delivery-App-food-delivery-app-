export type OwnerOrderItem = {
  id?: string;
  name: string;
  quantity: number;
  price?: number;
  specialInstructions?: string;
};

export type OwnerOrderAddress = {
  formattedAddress?: string;
  street?: string;
  area?: string;
  city?: string;
  state?: string;
  pincode?: string;
  contactName?: string;
  contactPhone?: string;
};

export type OwnerOrder = {
  id: string;
  orderNumber: string;
  status: string;
  items: OwnerOrderItem[];
  total?: number;
  fulfillmentLabel: string;
  fulfillmentTone: 'table' | 'delivery' | 'pickup';
  createdAt?: string;
  updatedAt?: string;
  customerName?: string;
  customerPhone?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  subtotal?: number;
  deliveryFee?: number;
  tax?: number;
  discount?: number;
  specialInstructions?: string;
  deliveryAddress?: OwnerOrderAddress;
  rejectionReason?: string;
  scheduledFor?: string;
  isDelayed?: boolean;
  prepMinutes?: number;
  itemCount?: number;
  delayMinutes?: number;
  acceptBy?: string;
  promisedReadyAt?: string;
  /** Rider trip status from `delivery:status` (order status stays OFD until receive). */
  deliveryTripStatus?: string;
};

export type DashboardInsight = {
  title: string;
  subtitle: string;
  trendPercent: number;
};

export type DashboardRevenueBar = {
  label: string;
  value: number;
};

export type DashboardMetrics = {
  /** From analytics overview: totalRevenue */
  grossRevenue: number | null;
  revenueTrendPercent: number | null;
  yesterdayRevenue: number | null;
  /** From analytics/revenue series when available */
  revenueBars: number[];
  /** Labeled series for the dashboard chart (API only) */
  revenueSeries: DashboardRevenueBar[];
  /** From analytics overview: totalOrders */
  totalOrders: number | null;
  /** From analytics overview: avgRating */
  rating: number | null;
  ratingMax: number;
  totalRatings: number | null;
  /** Not on restaurant-service overview — kept for the dashboard card. */
  avgDeliveryMinutes: number | null;
  isOnline: boolean;
};

export type DashboardQuickActions = {
  activeOrders: number;
  menuItems: number;
  activePromos: number;
  /** From review-service stats */
  totalReviews: number;
};

export type DashboardData = {
  restaurantId: string;
  restaurantName: string;
  city?: string;
  logoUrl?: string;
  insight: DashboardInsight;
  metrics: DashboardMetrics;
  quickActions: DashboardQuickActions;
  pendingOrders: OwnerOrder[];
};
