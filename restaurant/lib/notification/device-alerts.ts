import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { AppNotification } from '@/lib/notification/types';
import { storageGetItem, storageSetItem } from '@/lib/storage';

const SEEN_IDS_KEY = 'delivery.notification.seenIds.v1';
const CHANNEL_ID = 'tokajo-delivery-alerts';

type NotificationsModule = typeof import('expo-notifications');

/**
 * Expo Go (SDK 53+) throws on Android if expo-notifications is imported.
 * Device tray alerts only work in a development / production build.
 */
export function isExpoGoRuntime() {
  return Constants.appOwnership === 'expo';
}

function canUseNativeNotifications() {
  if (Platform.OS === 'web') return false;
  if (isExpoGoRuntime()) return false;
  return true;
}

let notificationsModule: NotificationsModule | null | undefined;
let handlerReady = false;
let configured = false;

function loadNotificationsModule(): NotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;
  if (!canUseNativeNotifications()) {
    notificationsModule = null;
    return null;
  }

  try {
    // Lazy require so Expo Go never evaluates the native push shim.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-notifications') as NotificationsModule;
    notificationsModule = mod;
    if (!handlerReady) {
      mod.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
      handlerReady = true;
    }
    return mod;
  } catch {
    notificationsModule = null;
    return null;
  }
}

export async function ensureDeviceNotificationReady(): Promise<boolean> {
  const Notifications = loadNotificationsModule();
  if (!Notifications) return false;

  try {
    if (!configured) {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
          name: 'Delivery alerts',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 150, 250],
          lightColor: '#7A0E22',
          sound: 'default',
        });
      }
      configured = true;
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    return status === 'granted';
  } catch {
    return false;
  }
}

async function loadSeenIds(): Promise<Set<string>> {
  try {
    const raw = await storageGetItem(SEEN_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(ids: Set<string>): Promise<void> {
  const list = [...ids].slice(-200);
  await storageSetItem(SEEN_IDS_KEY, JSON.stringify(list));
}

export async function presentDeviceNotification(
  item: AppNotification
): Promise<void> {
  const Notifications = loadNotificationsModule();
  if (!Notifications) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: item.title || 'TOKAJO',
      body: item.body || 'You have a new update',
      data: {
        notificationId: item.id,
        type: item.type,
        ...(item.data ?? {}),
      },
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null),
    },
    trigger: null,
  });
}

/**
 * First sync: mark existing items as seen (no spam).
 * Later syncs: show system tray alerts for brand-new unread items
 * (skipped automatically in Expo Go).
 */
export async function syncDeviceAlertsForNotifications(
  items: AppNotification[],
  options?: { allowed?: (item: AppNotification) => boolean }
): Promise<number> {
  if (!canUseNativeNotifications()) {
    // Still track seen ids so a future dev build doesn't spam old items.
    const seen = await loadSeenIds();
    for (const item of items) {
      if (item.id) seen.add(item.id);
    }
    await saveSeenIds(seen);
    return 0;
  }

  const ready = await ensureDeviceNotificationReady();
  if (!ready) return 0;

  const seen = await loadSeenIds();
  const isFirstPass = seen.size === 0;
  let presented = 0;

  for (const item of items) {
    if (!item.id) continue;
    if (seen.has(item.id)) continue;

    seen.add(item.id);

    if (isFirstPass) continue;
    if (item.isRead) continue;
    if (options?.allowed && !options.allowed(item)) continue;

    try {
      await presentDeviceNotification(item);
      presented += 1;
    } catch {
      // Ignore single present failures
    }
  }

  await saveSeenIds(seen);
  return presented;
}

export async function markNotificationIdsSeen(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const seen = await loadSeenIds();
  for (const id of ids) seen.add(id);
  await saveSeenIds(seen);
}

/** No-op subscription in Expo Go; real listener in native builds. */
export function addNotificationOpenListener(
  onOpen: () => void
): { remove: () => void } {
  const Notifications = loadNotificationsModule();
  if (!Notifications) {
    return { remove: () => undefined };
  }

  try {
    return Notifications.addNotificationResponseReceivedListener(() => {
      onOpen();
    });
  } catch {
    return { remove: () => undefined };
  }
}
