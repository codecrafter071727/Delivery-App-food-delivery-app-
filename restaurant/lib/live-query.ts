import { focusManager, onlineManager } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

/** Global pause after any 429 so screens don't keep hammering the API. */
let rateLimitUntil = 0;

export function isRateLimitedError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: string }).message ?? '').toLowerCase();
  const status = (error as { response?: { status?: number } }).response?.status;
  return (
    status === 429 ||
    message.includes('too many request') ||
    message.includes('rate limit') ||
    message.includes('slow down')
  );
}

export function noteRateLimited(error?: unknown) {
  if (error != null && !isRateLimitedError(error)) return;
  // Cool down ~75s after a rate-limit hit (longer than any screen poll).
  rateLimitUntil = Math.max(rateLimitUntil, Date.now() + 75_000);
}

export function isGloballyBackingOff() {
  return Date.now() < rateLimitUntil;
}

export function getRateLimitRemainingMs() {
  return Math.max(0, rateLimitUntil - Date.now());
}

/**
 * Poll only while the app is open.
 * When rate-limited: pause short polls entirely, stretch long polls to 90s+.
 */
export function liveRefetchInterval(baseMs: number, isActive: boolean) {
  if (!isActive) return false;
  if (isGloballyBackingOff()) {
    // Don't stack retries on hot endpoints during cooldown.
    if (baseMs <= 15_000) return false;
    return Math.max(baseMs * 2, 90_000);
  }
  return baseMs;
}

/**
 * Safe live-update cadence for restaurant + delivery portals.
 * Orders stay relatively fresh; heavy aggregate screens stay slower
 * so they don't compete and trigger 429s.
 */
export const LIVE_INTERVALS = {
  /** Kitchen board — primary live surface */
  orders: 12_000,
  ordersUrgent: 6_000,
  ordersBackoff: 45_000,
  /** Dashboard metrics (pending orders patched live from orders sync) */
  dashboard: 60_000,
  menu: 60_000,
  offers: 60_000,
  analytics: 120_000,
  reviews: 75_000,
  partners: 45_000,
  partnersAvailable: 30_000,
  notifications: 60_000,
  settings: 90_000,
  duty: 20_000,
  /** Delivery partner portal */
  deliveryActive: 8_000,
  deliveryMe: 20_000,
  deliveryHistory: 30_000,
  deliveryAnalytics: 60_000,
  deliveryEarnings: 45_000,
  deliveryRestaurants: 45_000,
  deliverySupport: 60_000,
  deliveryStatus: 10_000,
  deliveryShifts: 45_000,
  deliveryAttendance: 60_000,
  deliveryHubs: 20_000,
  deliveryHeatmap: 20_000,
  deliveryTracking: 6_000,
  deliveryHistoryTrail: 20_000,
} as const;

export function useAppIsActive() {
  const [isActive, setIsActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setIsActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  return isActive;
}

/**
 * Wire React Query to React Native AppState so refetchOnWindowFocus works
 * (orders/menu/offers/dashboard refresh when you return to the app).
 */
export function setupLiveQueryFocus() {
  focusManager.setEventListener((handleFocus) => {
    if (Platform.OS === 'web') {
      const onFocus = () => handleFocus(true);
      const onBlur = () => handleFocus(false);
      window.addEventListener('focus', onFocus);
      window.addEventListener('blur', onBlur);
      return () => {
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
      };
    }

    const subscription = AppState.addEventListener('change', (state) => {
      handleFocus(state === 'active');
    });
    return () => subscription.remove();
  });

  // Basic online signal for refetchOnReconnect (web). Native stays online=true.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    onlineManager.setEventListener((setOnline) => {
      const onOnline = () => setOnline(true);
      const onOffline = () => setOnline(false);
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
      return () => {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      };
    });
  }
}
