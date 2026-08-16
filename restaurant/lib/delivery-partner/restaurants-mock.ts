/**
 * Temporary mock data for Partner Restaurants.
 *
 * Flip `USE_MOCK_PARTNER_RESTAURANTS` to `false` in restaurants-api.ts
 * once GET /partners/me/restaurants (or equivalent) is live.
 */

import type { PartnerRestaurantsResult } from '@/lib/delivery-partner/restaurants-types';

export const MOCK_PARTNER_RESTAURANTS: PartnerRestaurantsResult = {
  summary: {
    totalRestaurants: 6,
    activeRestaurants: 5,
    avgDailyOrdersLabel: '48-92',
    avgDailyOrdersMin: 48,
    avgDailyOrdersMax: 92,
    avgRating: 4.7,
  },
  restaurants: [
    {
      id: 'mock-mcd',
      name: "McDonald's",
      status: 'active',
      location: 'Connaught Place, Delhi',
      phone: '+91 11-2345-6789',
      distanceKm: 2.3,
      dailyOrdersLabel: '12-18',
      dailyOrdersMin: 12,
      dailyOrdersMax: 18,
      rating: 4.8,
      lastOrderLabel: 'Today, 2:30 PM',
      tags: ['Fast Food', 'Burgers', 'Popular'],
      isTopPerformer: true,
    },
    {
      id: 'mock-kfc',
      name: 'KFC India',
      status: 'active',
      location: 'Karol Bagh, Delhi',
      phone: '+91 11-3456-7890',
      distanceKm: 1.8,
      dailyOrdersLabel: '15-22',
      dailyOrdersMin: 15,
      dailyOrdersMax: 22,
      rating: 4.6,
      lastOrderLabel: 'Today, 1:15 PM',
      tags: ['Chicken', 'Fast Food', 'Popular'],
      isTopPerformer: true,
    },
    {
      id: 'mock-dominos',
      name: "Domino's Pizza",
      status: 'active',
      location: 'Rajouri Garden, Delhi',
      phone: '+91 11-4567-8901',
      distanceKm: 3.1,
      dailyOrdersLabel: '18-25',
      dailyOrdersMin: 18,
      dailyOrdersMax: 25,
      rating: 4.7,
      lastOrderLabel: 'Today, 12:45 PM',
      tags: ['Pizza', 'Italian', 'Popular'],
      isTopPerformer: true,
    },
    {
      id: 'mock-burger-king',
      name: 'Burger King',
      status: 'active',
      location: 'Saket, Delhi',
      phone: '+91 11-5678-9012',
      distanceKm: 4.2,
      dailyOrdersLabel: '8-14',
      dailyOrdersMin: 8,
      dailyOrdersMax: 14,
      rating: 4.4,
      lastOrderLabel: 'Yesterday, 8:20 PM',
      tags: ['Burgers', 'Fast Food'],
    },
    {
      id: 'mock-paneer',
      name: 'Paneer Palace',
      status: 'inactive',
      location: 'Sector 12, Delhi',
      phone: '+91 11-7777-8888',
      distanceKm: 2.8,
      dailyOrdersLabel: '10-16',
      dailyOrdersMin: 10,
      dailyOrdersMax: 16,
      rating: 4.5,
      lastOrderLabel: '3 days ago',
      tags: ['Vegetarian', 'North Indian'],
    },
    {
      id: 'mock-sushi',
      name: 'Sushi Master',
      status: 'active',
      location: 'Hauz Khas, Delhi',
      phone: '+91 11-8888-9999',
      distanceKm: 5.1,
      dailyOrdersLabel: '6-12',
      dailyOrdersMin: 6,
      dailyOrdersMax: 12,
      rating: 4.9,
      lastOrderLabel: 'Today, 11:00 AM',
      tags: ['Japanese', 'Sushi'],
    },
  ],
  topPerformers: [
    {
      id: 'mock-mcd',
      name: "McDonald's",
      status: 'active',
      dailyOrdersLabel: '12-18',
      rating: 4.8,
      isTopPerformer: true,
    },
    {
      id: 'mock-kfc',
      name: 'KFC India',
      status: 'active',
      dailyOrdersLabel: '15-22',
      rating: 4.6,
      isTopPerformer: true,
    },
    {
      id: 'mock-dominos',
      name: "Domino's Pizza",
      status: 'active',
      dailyOrdersLabel: '18-25',
      rating: 4.7,
      isTopPerformer: true,
    },
  ],
};

export function getMockPartnerRestaurants(): PartnerRestaurantsResult {
  return MOCK_PARTNER_RESTAURANTS;
}
