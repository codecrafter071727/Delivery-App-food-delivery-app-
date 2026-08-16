/**
 * Partner restaurants DTOs.
 * Screen currently uses mock data (`USE_MOCK_PARTNER_RESTAURANTS`).
 * Same shapes map from GET /partners/me/restaurants when the API is ready.
 */

export type PartnerRestaurantStatus = 'active' | 'inactive' | string;

export type PartnerRestaurant = {
  id: string;
  name: string;
  status?: PartnerRestaurantStatus;
  /** Area / locality line, e.g. "Connaught Place, Delhi" */
  location?: string;
  city?: string;
  phone?: string;
  distanceKm?: number;
  /** Pre-formatted daily order range from API, e.g. "12-18" */
  dailyOrdersLabel?: string;
  dailyOrdersMin?: number;
  dailyOrdersMax?: number;
  dailyOrdersAvg?: number;
  rating?: number;
  lastOrderAt?: string;
  /** Relative / display string if API sends it (e.g. "Today, 2:30 PM") */
  lastOrderLabel?: string;
  tags?: string[];
  cuisine?: string[];
  menuUrl?: string;
  restaurantId?: string;
  isTopPerformer?: boolean;
  ordersCount?: number;
  raw?: Record<string, unknown>;
};

export type PartnerRestaurantsSummary = {
  totalRestaurants?: number;
  activeRestaurants?: number;
  /** Pre-formatted avg daily orders across partners, e.g. "48-92" */
  avgDailyOrdersLabel?: string;
  avgDailyOrdersMin?: number;
  avgDailyOrdersMax?: number;
  avgDailyOrders?: number;
  avgRating?: number;
};

export type PartnerRestaurantsResult = {
  restaurants: PartnerRestaurant[];
  summary: PartnerRestaurantsSummary;
  topPerformers: PartnerRestaurant[];
};
