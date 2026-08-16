import type { PartnerRole } from '@/lib/auth/types';
import { deliveryPartnerApi } from '@/lib/delivery-partner/api';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { restaurantOwnerApi } from '@/lib/restaurant/api';
import { peekPendingStaffInvite } from '@/lib/restaurant/staff-invite-storage';
import type { RestaurantOwnerRestaurant } from '@/lib/restaurant/types';
import {
  storageDeleteItem,
  storageGetItem,
  storageSetItem,
} from '@/lib/storage';

export type PostAuthRoute =
  | '/dashboard'
  | '/restaurant-setup'
  | '/staff/invite'
  | typeof DELIVERY_ROUTES.home
  | typeof DELIVERY_ROUTES.setup;

const SETUP_DONE_KEY = 'partner_restaurant_setup_done';
const DELIVERY_SETUP_DONE_KEY = 'partner_delivery_setup_done';

/** Shared screens both roles may open (no portal redirect). */
const SHARED_APP_SEGMENTS = new Set([
  'change-password',
  'verify-email',
]);

/** Restaurant-owner portal route segments under (app). */
const RESTAURANT_PORTAL_SEGMENTS = new Set([
  'dashboard',
  'orders',
  'menu',
  'admin',
  'settings',
  'partners',
  'restaurant-setup',
  'offers',
  'reviews',
  'analytics',
  'staff',
]);

/** Delivery-partner portal route segments under (app). */
const DELIVERY_PORTAL_SEGMENTS = new Set([
  'delivery',
  'delivery-setup',
  'partner-orders',
  'partner-profile',
  'partner-documents',
  'partner-analytics',
  'partner-earnings',
  'partner-restaurants',
  'partner-notifications',
  'partner-support',
]);

/**
 * True when the current Expo Router segments belong to the delivery portal.
 */
export function isDeliveryPortalPath(segments: readonly string[]): boolean {
  return segments.some((seg) => DELIVERY_PORTAL_SEGMENTS.has(seg));
}

/**
 * True when the current Expo Router segments belong to the restaurant portal.
 * Delivery child routes like /delivery/analytics share names with restaurant
 * screens — never treat those as restaurant when `delivery` is in the path.
 */
export function isRestaurantPortalPath(segments: readonly string[]): boolean {
  if (isDeliveryPortalPath(segments)) return false;
  return segments.some((seg) => RESTAURANT_PORTAL_SEGMENTS.has(seg));
}

export function isSharedAppPath(segments: readonly string[]): boolean {
  return segments.some((seg) => SHARED_APP_SEGMENTS.has(seg));
}

/**
 * If the signed-in role does not own the current portal, return the home href
 * they should be redirected to. Otherwise null (stay).
 */
export function portalMismatchRedirect(
  role: PartnerRole,
  segments: readonly string[]
): '/dashboard' | typeof DELIVERY_ROUTES.home | null {
  if (!segments.length || isSharedAppPath(segments)) return null;

  if (role === 'delivery' && isRestaurantPortalPath(segments)) {
    return DELIVERY_ROUTES.home;
  }

  if (role === 'restaurant' && isDeliveryPortalPath(segments)) {
    return '/dashboard';
  }

  return null;
}

/**
 * Once GET /restaurants/my returns a record (id + name), treat onboarding as done.
 */
export function isRestaurantProfileComplete(
  restaurant: RestaurantOwnerRestaurant | null | undefined
): boolean {
  if (!restaurant?.id?.trim()) return false;
  if (!String(restaurant.name ?? '').trim()) return false;
  return true;
}

export async function markRestaurantSetupComplete(restaurantId?: string) {
  await storageSetItem(
    SETUP_DONE_KEY,
    restaurantId?.trim() ? restaurantId.trim() : '1'
  );
}

export async function clearRestaurantSetupFlag() {
  await storageDeleteItem(SETUP_DONE_KEY);
}

export async function markDeliveryPartnerSetupComplete(partnerId?: string) {
  await storageSetItem(
    DELIVERY_SETUP_DONE_KEY,
    partnerId?.trim() ? partnerId.trim() : '1'
  );
}

export async function clearDeliveryPartnerSetupFlag() {
  await storageDeleteItem(DELIVERY_SETUP_DONE_KEY);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function resolvePostAuthRoute(
  role: PartnerRole
): Promise<PostAuthRoute> {
  // Delivery partners always land on the delivery home after login.
  if (role === 'delivery') {
    try {
      const me = await withTimeout(deliveryPartnerApi.getMe(), 8000);
      if (me?.id) {
        await markDeliveryPartnerSetupComplete(me.id);
      }
    } catch {
      // Profile check is optional — never block the home screen.
    }
    return DELIVERY_ROUTES.home;
  }

  try {
    const pendingInvite = await peekPendingStaffInvite();
    if (pendingInvite?.token && pendingInvite.restaurantId) {
      return '/staff/invite';
    }

    const my = await withTimeout(restaurantOwnerApi.getMyRestaurant(), 8000);
    if (isRestaurantProfileComplete(my)) {
      await markRestaurantSetupComplete(my?.id);
      return '/dashboard';
    }
  } catch {
    // Fall through to local flag / setup
  }

  const localDone = await storageGetItem(SETUP_DONE_KEY);
  if (localDone) return '/dashboard';

  return '/restaurant-setup';
}

export function restaurantSetupHref() {
  return '/restaurant-setup';
}
