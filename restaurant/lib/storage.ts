import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Durable key/value storage that never crashes when native modules are missing.
 *
 * Priority:
 * 1) Web → localStorage
 * 2) Native → SecureStore
 * 3) In-memory fallback (session only)
 *
 * Avoids @react-native-async-storage "Native module is null / legacy storage"
 * crashes seen on some Expo Go / New Architecture builds.
 */
const memory = new Map<string, string>();

function webLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    // Smoke-test (private mode can throw)
    const probe = '__tokajo_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

async function secureGet(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(key, value);
    return true;
  } catch {
    return false;
  }
}

async function secureDelete(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export async function storageGetItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    const ls = webLocalStorage();
    if (ls) {
      try {
        return ls.getItem(key);
      } catch {
        return memory.get(key) ?? null;
      }
    }
    return memory.get(key) ?? null;
  }

  const secure = await secureGet(key);
  if (secure != null) {
    memory.set(key, secure);
    return secure;
  }

  return memory.get(key) ?? null;
}

export async function storageSetItem(key: string, value: string): Promise<void> {
  memory.set(key, value);

  if (Platform.OS === 'web') {
    const ls = webLocalStorage();
    if (ls) {
      try {
        ls.setItem(key, value);
      } catch {
        // memory already set
      }
    }
    return;
  }

  await secureSet(key, value);
}

export async function storageDeleteItem(key: string): Promise<void> {
  memory.delete(key);

  if (Platform.OS === 'web') {
    const ls = webLocalStorage();
    if (ls) {
      try {
        ls.removeItem(key);
      } catch {
        // ignore
      }
    }
    return;
  }

  await secureDelete(key);
}
