import { api } from '@/lib/api';
import { restaurantAnalyticsApi } from '@/lib/analytics/api';
import { trendInsight } from '@/lib/dashboard/format';
import type { DashboardData, OwnerOrder } from '@/lib/dashboard/types';
import { restaurantOrderApi, getCachedRestaurantOrders } from '@/lib/order/owner-api';
import { restaurantOwnerApi } from '@/lib/restaurant/api';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  data?: T;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function numberField(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

async function getMenuItemCount(restaurantId: string): Promise<number> {
  try {
    const res = await api.get<Envelope<unknown>>(
      `${RESTAURANT_BASE}/${restaurantId}/items`
    );
    const raw = res.data?.data ?? res.data;
    return Array.isArray(raw) ? raw.length : 0;
  } catch {
    return 0;
  }
}

async function getActivePromoCount(restaurantId: string): Promise<number> {
  try {
    const res = await api.get<Envelope<unknown>>(
      `${RESTAURANT_BASE}/${restaurantId}/offers`
    );
    const raw = res.data?.data ?? res.data;
    if (!Array.isArray(raw)) return 0;
    return raw.filter((row) => {
      const offer = asRecord(row);
      const active = offer.isActive ?? offer.active ?? offer.status;
      if (typeof active === 'boolean') return active;
      if (typeof active === 'string') {
        return active.toLowerCase() === 'active' || active.toLowerCase() === 'live';
      }
      return true;
    }).length;
  } catch {
    return 0;
  }
}

export const dashboardApi = {
  getDashboard: async (): Promise<DashboardData | null> => {
    const restaurant = await restaurantOwnerApi.getMyRestaurant();
    if (!restaurant?.id) return null;

    const record = restaurant as Record<string, unknown>;

    // Prefer kitchen-board cache when live sync already loaded it (avoids
    // a duplicate /orders call on every dashboard poll).
    const [
      analytics,
      revenue,
      menuItems,
      activePromos,
    ] = await Promise.all([
      restaurantAnalyticsApi
        .getOverview(restaurant.id)
        .catch(() => null),
      restaurantAnalyticsApi
        .getRevenue(restaurant.id, 'week')
        .catch(() => null),
      getMenuItemCount(restaurant.id),
      getActivePromoCount(restaurant.id),
    ]);

    const cachedOrders = getCachedRestaurantOrders(restaurant.id);
    const pendingOrders = cachedOrders
      ? cachedOrders.filter((order) =>
          ['pending', 'placed', 'pending_payment'].includes(order.status)
        )
      : await restaurantOrderApi
          .getPendingOrders(restaurant.id)
          .catch(() => [] as OwnerOrder[]);

    const currentOrderCount = numberField(record, [
      'currentOrderCount',
      'activeOrders',
      'liveOrders',
    ]);

    const grossRevenue = analytics?.totalRevenue ?? null;
    const avgDeliveryMinutes = null;
    const totalOrders = analytics?.totalOrders ?? null;
    const rating =
      analytics?.avgRating && analytics.avgRating > 0
        ? analytics.avgRating
        : null;
    const totalRatings =
      analytics?.totalRatings && analytics.totalRatings > 0
        ? analytics.totalRatings
        : null;

    const series = (revenue?.points ?? [])
      .filter((point) => Number.isFinite(point.revenue) && point.revenue >= 0)
      .slice(-7)
      .map((point) => ({
        label: point.label,
        value: point.revenue,
      }));

    const revenueBars = series.map((point) => point.value);
    const insightCopy = trendInsight(0);
    const activeOrders = Math.max(currentOrderCount, pendingOrders.length);

    const address = asRecord(record.address);
    const city =
      String(address.city ?? record.city ?? '').trim() || undefined;

    return {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      city,
      logoUrl: restaurant.logoUrl,
      insight: {
        title: insightCopy.title,
        subtitle: insightCopy.subtitle,
        trendPercent: 0,
      },
      metrics: {
        grossRevenue,
        revenueTrendPercent: null,
        yesterdayRevenue: null,
        revenueBars,
        revenueSeries: series,
        totalOrders,
        rating,
        ratingMax: 5,
        totalRatings,
        avgDeliveryMinutes,
        isOnline: record.isOnline === true,
      },
      quickActions: {
        activeOrders,
        menuItems,
        activePromos,
        totalReviews: totalRatings ?? 0,
      },
      pendingOrders: pendingOrders.slice(0, 6),
    };
  },
};
