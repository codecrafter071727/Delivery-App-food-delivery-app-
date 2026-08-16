import axios from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import type { AppNotification, NotificationListResult } from '@/lib/notification/types';
import { storageDeleteItem, storageGetItem, storageSetItem } from '@/lib/storage';

function kitchenAppVersion() {
  return (
    Constants.expoConfig?.version?.trim() ||
    Constants.nativeAppVersion?.trim() ||
    '1.0.0'
  );
}

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';
const DEVICE_STORE_KEY = 'kitchen_push_device';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  code?: string;
};

export type KitchenDevice = {
  deviceId: string;
  platform: 'ios' | 'android' | 'web';
  tokenMasked: string;
  appVersion: string | null;
  lastSeenAt?: string;
  createdAt?: string;
};

export type StoredKitchenDevice = KitchenDevice & {
  restaurantId: string;
};

export type KitchenInboxResult = NotificationListResult & {
  unreadCount: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function throwPushError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      throw new Error(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const code = data?.code;
    if (
      code === 'NOTIFICATION_SERVICE_UNAVAILABLE' ||
      error.response.status === 503
    ) {
      const err = new Error(
        'Inbox is temporarily unavailable. Try again in a moment. (NOTIFICATION_SERVICE_UNAVAILABLE)'
      ) as Error & { status?: number; code?: string };
      err.status = 503;
      err.code = 'NOTIFICATION_SERVICE_UNAVAILABLE';
      throw err;
    }
    if (code === 'DEVICE_NOT_FOUND') {
      const err = new Error(
        'This device is not registered for alerts. (DEVICE_NOT_FOUND)'
      ) as Error & { status?: number; code?: string };
      err.status = 404;
      err.code = code;
      throw err;
    }
    const message =
      data?.message || data?.error || `Request failed (${error.response.status})`;
    if (message.toLowerCase().includes('csrf')) {
      throw new Error(
        'Security token expired. Close and reopen the app, then try again.'
      );
    }
    const suffix = code ? ` (${code})` : ` (${error.response.status})`;
    const err = new Error(`${message}${suffix}`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = error.response.status;
    err.code = code;
    throw err;
  }
  if (error instanceof Error) throw error;
  throw new Error(fallback);
}

function mapNotification(raw: Record<string, unknown>): AppNotification {
  return {
    id: String(raw.id ?? raw._id ?? ''),
    title: String(raw.title ?? 'Notification'),
    body: String(raw.message ?? raw.body ?? ''),
    type: String(raw.type ?? 'system'),
    isRead: Boolean(raw.isRead),
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
    data:
      raw.data && typeof raw.data === 'object'
        ? (raw.data as Record<string, unknown>)
        : undefined,
  };
}

function mapDevice(raw: Record<string, unknown>): KitchenDevice | null {
  const deviceId = String(raw.deviceId ?? raw._id ?? raw.id ?? '').trim();
  if (!deviceId) return null;
  const platform = String(raw.platform ?? Platform.OS);
  return {
    deviceId,
    platform:
      platform === 'ios' || platform === 'android' || platform === 'web'
        ? platform
        : Platform.OS === 'ios'
          ? 'ios'
          : Platform.OS === 'android'
            ? 'android'
            : 'web',
    tokenMasked: String(raw.tokenMasked ?? '••••'),
    appVersion: raw.appVersion ? String(raw.appVersion) : null,
    lastSeenAt: raw.lastSeenAt ? String(raw.lastSeenAt) : undefined,
    createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
  };
}

export async function loadStoredKitchenDevice(): Promise<StoredKitchenDevice | null> {
  const raw = await storageGetItem(DEVICE_STORE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredKitchenDevice;
    if (!parsed?.deviceId || !parsed.restaurantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveStoredKitchenDevice(device: StoredKitchenDevice) {
  await storageSetItem(DEVICE_STORE_KEY, JSON.stringify(device));
}

export async function clearStoredKitchenDevice() {
  await storageDeleteItem(DEVICE_STORE_KEY);
}

export function kitchenPushPlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export async function resolveKitchenPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const Notifications = await import('expo-notifications');
    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') return null;

    try {
      const token = await Notifications.getDevicePushTokenAsync();
      if (typeof token.data === 'string' && token.data.trim().length >= 10) {
        return token.data.trim();
      }
    } catch {
      // Expo Go / missing credentials — try Expo token next.
    }

    const extra = Constants.expoConfig?.extra as
      | { eas?: { projectId?: string } }
      | undefined;
    const projectId = extra?.eas?.projectId;
    const expoToken = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return expoToken.data?.trim() || null;
  } catch {
    return null;
  }
}

export const kitchenInboxApi = {
  listNotifications: async (
    restaurantId: string,
    params?: { page?: number; limit?: number; unread?: boolean }
  ): Promise<KitchenInboxResult> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/notifications`,
        {
          params: {
            page: params?.page ?? 1,
            limit: params?.limit ?? 20,
            ...(params?.unread ? { unread: '1' } : {}),
          },
        }
      );
      const root = asRecord(res.data?.data) ?? {};
      const rows = Array.isArray(root.notifications) ? root.notifications : [];
      const page = Number(root.page) || params?.page || 1;
      const limit = Number(root.limit) || params?.limit || 20;
      const total = Number(root.total) || rows.length;
      const totalPages =
        Number(root.totalPages) || Math.max(1, Math.ceil(total / limit));
      const unreadCount = Number(root.unreadCount) || 0;
      return {
        notifications: rows
          .map((row) => mapNotification(asRecord(row) ?? {}))
          .filter((row) => row.id),
        unreadCount,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
        },
      };
    } catch (error) {
      throwPushError(error, 'Failed to load notifications');
    }
  },

  registerDevice: async (
    restaurantId: string,
    input: { token: string; deviceId?: string }
  ): Promise<KitchenDevice> => {
    try {
      const res = await api.post<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/devices`,
        {
          platform: kitchenPushPlatform(),
          token: input.token,
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
          appVersion: kitchenAppVersion().slice(0, 32),
        }
      );
      const mapped = mapDevice(asRecord(res.data?.data) ?? {});
      if (!mapped) throw new Error('Device registered but the response was empty.');
      await saveStoredKitchenDevice({ ...mapped, restaurantId });
      return mapped;
    } catch (error) {
      throwPushError(error, 'Failed to register this device');
    }
  },

  unregisterDevice: async (
    restaurantId: string,
    deviceId: string
  ): Promise<void> => {
    try {
      await api.delete(
        `${RESTAURANT_BASE}/${restaurantId}/devices/${encodeURIComponent(deviceId)}`
      );
      const stored = await loadStoredKitchenDevice();
      if (stored?.deviceId === deviceId) await clearStoredKitchenDevice();
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        await clearStoredKitchenDevice();
        return;
      }
      if (code === 'DEVICE_NOT_FOUND') {
        await clearStoredKitchenDevice();
        return;
      }
      throwPushError(error, 'Failed to unregister this device');
    }
  },
};
