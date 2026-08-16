import type { AuthUser, PartnerRole } from '@/lib/auth/types';
import { clearSessionCookies } from '@/lib/session-cookies';
import {
  storageDeleteItem,
  storageGetItem,
  storageSetItem,
} from '@/lib/storage';

const TOKEN_KEY = 'partner_auth_token';
const USER_KEY = 'partner_auth_user';
const ROLE_KEY = 'partner_selected_role';

export async function getToken(): Promise<string | null> {
  return storageGetItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await storageSetItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await storageDeleteItem(TOKEN_KEY);
}

export async function getStoredUser(): Promise<AuthUser | null> {
  try {
    const raw = await storageGetItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export async function setStoredUser(user: AuthUser): Promise<void> {
  await storageSetItem(USER_KEY, JSON.stringify(user));
}

export async function clearStoredUser(): Promise<void> {
  await storageDeleteItem(USER_KEY);
}

/** Remember the last role the partner picked so the toggle is pre-selected. */
export async function getStoredRole(): Promise<PartnerRole | null> {
  try {
    const raw = await storageGetItem(ROLE_KEY);
    return raw === 'restaurant' || raw === 'delivery' ? raw : null;
  } catch {
    return null;
  }
}

export async function setStoredRole(role: PartnerRole): Promise<void> {
  await storageSetItem(ROLE_KEY, role);
}

export async function clearAuthStorage(): Promise<void> {
  // Keep ROLE_KEY so the Restaurant/Delivery toggle stays preferred after logout.
  await Promise.all([clearToken(), clearStoredUser(), clearSessionCookies()]);
}
