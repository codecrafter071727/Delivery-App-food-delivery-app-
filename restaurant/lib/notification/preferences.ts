import {
  storageGetItem,
  storageSetItem,
} from '@/lib/storage';
import type {
  AppNotification,
  NotificationPreferenceKey,
  NotificationPreferences,
} from '@/lib/notification/types';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/notification/types';

const PREFS_STORAGE_KEY = 'delivery.notification.preferences.v1';

export async function loadNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await storageGetItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export async function saveNotificationPreferences(
  prefs: NotificationPreferences
): Promise<void> {
  await storageSetItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
}

/** Map API notification type → preference category. */
export function preferenceKeyForType(
  type: string
): NotificationPreferenceKey {
  const t = type.toLowerCase();
  if (
    t.includes('order') ||
    t.includes('deliver') ||
    t.includes('assign') ||
    t.includes('pickup') ||
    t.includes('trip')
  ) {
    return 'orders';
  }
  if (
    t.includes('pay') ||
    t.includes('earn') ||
    t.includes('wallet') ||
    t.includes('payout') ||
    t.includes('incentive') ||
    t.includes('tip')
  ) {
    return 'earnings';
  }
  if (t.includes('support') || t.includes('ticket') || t.includes('help')) {
    return 'support';
  }
  if (
    t.includes('promo') ||
    t.includes('offer') ||
    t.includes('deal') ||
    t.includes('campaign') ||
    t.includes('marketing')
  ) {
    return 'promo';
  }
  return 'system';
}

export function isNotificationAllowed(
  notification: AppNotification,
  prefs: NotificationPreferences
): boolean {
  return prefs[preferenceKeyForType(notification.type)] !== false;
}
