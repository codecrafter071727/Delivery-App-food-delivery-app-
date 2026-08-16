import { Platform } from 'react-native';

import { storageGetItem, storageSetItem } from '@/lib/storage';

const DEVICE_ID_KEY = 'partner_auth_device_id';

/** Stable device id for social login / session binding. */
export async function getAuthDeviceId(): Promise<string> {
  const existing = await storageGetItem(DEVICE_ID_KEY);
  if (existing?.trim()) return existing.trim();

  const id = `${Platform.OS}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  await storageSetItem(DEVICE_ID_KEY, id);
  return id;
}

export function authClientSource(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}
