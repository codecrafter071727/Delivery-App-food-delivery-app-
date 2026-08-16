/**
 * Delivery partner app routes — keep all hrefs here so new screens
 * only need one registration (route file + tab entry if needed).
 */

export const DELIVERY_ROUTES = {
  home: '/delivery',
  profile: '/delivery/profile',
  documents: '/delivery/documents',
  orders: '/delivery/orders',
  analytics: '/delivery/analytics',
  earnings: '/delivery/earnings',
  restaurants: '/delivery/restaurants',
  notifications: '/delivery/notifications',
  support: '/delivery/support',
  shifts: '/delivery/shifts',
  hubs: '/delivery/hubs',
  heatmap: '/delivery/heatmap',
  setup: '/delivery/setup',
} as const;

export type DeliveryRoute =
  (typeof DELIVERY_ROUTES)[keyof typeof DELIVERY_ROUTES];

export type DeliveryTabKey =
  | 'home'
  | 'profile'
  | 'documents'
  | 'orders'
  | 'analytics'
  | 'earnings'
  | 'restaurants'
  | 'notifications'
  | 'support'
  | 'shifts'
  | 'hubs'
  | 'heatmap';

export type DeliveryTabItem = {
  key: DeliveryTabKey;
  label: string;
  href: DeliveryRoute;
};

/** Primary bottom navbar tabs. */
export const DELIVERY_BOTTOM_TABS: DeliveryTabItem[] = [
  { key: 'home', label: 'Home', href: DELIVERY_ROUTES.home },
  { key: 'orders', label: 'Orders', href: DELIVERY_ROUTES.orders },
  { key: 'earnings', label: 'Earnings', href: DELIVERY_ROUTES.earnings },
  { key: 'analytics', label: 'Analytics', href: DELIVERY_ROUTES.analytics },
];

/** Quick links shown on the Home dashboard. */
export const DELIVERY_HOME_SHORTCUTS: DeliveryTabItem[] = [
  { key: 'documents', label: 'Documents', href: DELIVERY_ROUTES.documents },
  { key: 'restaurants', label: 'Restaurants', href: DELIVERY_ROUTES.restaurants },
  { key: 'shifts', label: 'Shifts', href: DELIVERY_ROUTES.shifts },
  { key: 'hubs', label: 'Hubs', href: DELIVERY_ROUTES.hubs },
  { key: 'heatmap', label: 'Demand', href: DELIVERY_ROUTES.heatmap },
  { key: 'support', label: 'Support', href: DELIVERY_ROUTES.support },
];

/** @deprecated Use DELIVERY_BOTTOM_TABS / DELIVERY_HOME_SHORTCUTS */
export const DELIVERY_TABS: DeliveryTabItem[] = [
  ...DELIVERY_BOTTOM_TABS,
  { key: 'profile', label: 'Profile', href: DELIVERY_ROUTES.profile },
  ...DELIVERY_HOME_SHORTCUTS,
  {
    key: 'notifications',
    label: 'Notifications',
    href: DELIVERY_ROUTES.notifications,
  },
];

export function isDeliveryHomePath(pathname: string) {
  return (
    pathname === DELIVERY_ROUTES.home ||
    pathname === '/delivery/' ||
    pathname.endsWith('/delivery')
  );
}

export function isDeliveryBottomTabPath(pathname: string) {
  return DELIVERY_BOTTOM_TABS.some(
    (tab) =>
      pathname === tab.href ||
      (tab.href === DELIVERY_ROUTES.home && isDeliveryHomePath(pathname))
  );
}
