import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getAuthDeviceId } from '@/lib/auth/device';
import { isExpoGoRuntime } from '@/lib/notification/device-alerts';
import { storageDeleteItem, storageGetItem, storageSetItem } from '@/lib/storage';
import type { StoredPushDevice, UserDevice } from '@/lib/user/account-types';

const STORE_KEY = 'user_service_push_device';

export function platformPushPlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

export function platformAppVersion(): string {
  return (
    Constants.expoConfig?.version?.trim() ||
    Constants.nativeAppVersion?.trim() ||
    '1.0.0'
  );
}

export async function loadStoredPushDevice(): Promise<StoredPushDevice | null> {
  const raw = await storageGetItem(STORE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPushDevice;
    if (!parsed?.deviceId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveStoredPushDevice(device: UserDevice): Promise<void> {
  const clientDeviceId = device.clientDeviceId || (await getAuthDeviceId());
  const stored: StoredPushDevice = {
    deviceId: device.deviceId,
    clientDeviceId,
    platform: device.platform,
    tokenMasked: device.tokenMasked,
  };
  await storageSetItem(STORE_KEY, JSON.stringify(stored));
}

export async function clearStoredPushDevice(): Promise<void> {
  await storageDeleteItem(STORE_KEY);
}

/**
 * Native FCM/APNs token. Skips Expo Go (Android SDK 53 throws on import).
 * Never invents a token.
 */
export async function resolvePlatformPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (isExpoGoRuntime()) return null;

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
      const native = await Notifications.getDevicePushTokenAsync();
      if (typeof native.data === 'string' && native.data.trim().length >= 10) {
        return native.data.trim();
      }
    } catch {
      // Missing FCM/APNs credentials — try Expo token next.
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

export function isThisPushDevice(
  device: UserDevice,
  stored: StoredPushDevice | null,
  authDeviceId?: string
) {
  if (stored && device.deviceId === stored.deviceId) return true;
  if (authDeviceId && device.clientDeviceId === authDeviceId) return true;
  if (stored && device.clientDeviceId === stored.clientDeviceId) return true;
  return false;
}
