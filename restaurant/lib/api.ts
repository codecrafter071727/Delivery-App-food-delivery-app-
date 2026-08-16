import axios, { AxiosHeaders } from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getToken } from '@/lib/auth/storage';
import { notifyUnauthorized } from '@/lib/auth/unauthorized';
import {
  clearSessionCookies,
  getStoredSessionCookies,
  persistSessionCookies,
} from '@/lib/session-cookies';

/** Cookie session marker stored when API uses Set-Cookie instead of JWT. */
export const SESSION_AUTH_TOKEN = 'session';

const DEFAULT_API_BASE_URL = 'http://10.12.14.3:4000';

function pickHttpUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const raw of candidates) {
    const value = raw?.trim();
    if (value && /^https?:\/\//i.test(value)) {
      return value.replace(/\/+$/, '');
    }
  }
  return null;
}

function resolveApiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiUrl?: string } | undefined;
  return (
    pickHttpUrl(process.env.EXPO_PUBLIC_API_URL, extra?.apiUrl) ??
    DEFAULT_API_BASE_URL
  );
}

export const API_BASE_URL = resolveApiBaseUrl();

export function assertApiBaseUrl(): void {
  if (!/^https?:\/\//i.test(API_BASE_URL)) {
    throw new Error(
      'API URL is not configured. Add EXPO_PUBLIC_API_URL=http://10.12.14.3:4000 to .env and restart Expo with npx expo start -c.'
    );
  }
}

const isWeb = Platform.OS === 'web';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000,
  // Android Expo Go treats XHR + withCredentials as a network failure.
  // Native already forwards `_sid` / `_csrf` via the Cookie header.
  withCredentials: isWeb,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

let csrfToken: string | null = null;
let csrfPromise: Promise<string> | null = null;

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** Fetch CSRF via axios so the cookie jar is shared with later POSTs on mobile. */
export async function refreshCsrfToken(force = false): Promise<string> {
  if (!force && csrfToken) return csrfToken;
  if (csrfPromise) return csrfPromise;

  csrfPromise = (async () => {
    try {
      const { data, headers } = await api.get<unknown>('/api/csrf-token');
      const record =
        data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const nested =
        record.data && typeof record.data === 'object'
          ? (record.data as Record<string, unknown>)
          : {};
      const fromHeader = headers?.['x-csrf-token'] ?? headers?.['X-CSRF-Token'];
      const token =
        (typeof nested.csrfToken === 'string' && nested.csrfToken) ||
        (typeof record.csrfToken === 'string' && record.csrfToken) ||
        (typeof record.token === 'string' && record.token) ||
        (typeof fromHeader === 'string' && fromHeader) ||
        '';

      if (!token.trim()) {
        throw new Error('Server did not return a security token');
      }

      csrfToken = token.trim();
      return csrfToken;
    } catch (error) {
      csrfToken = null;
      throw error;
    } finally {
      csrfPromise = null;
    }
  })();

  return csrfPromise;
}

export function clearCsrfToken(): void {
  csrfToken = null;
}

export async function clearApiSession(): Promise<void> {
  clearCsrfToken();
  await clearSessionCookies();
}

/** Quick connectivity check — GET /health (liveness). */
export async function checkApiConnection(): Promise<boolean> {
  try {
    const response = await api.get<{ success?: boolean; status?: string }>(
      '/health',
      { timeout: 10000 }
    );
    return (
      response.status >= 200 &&
      response.status < 300 &&
      (response.data?.success === true ||
        response.data?.status === 'ok' ||
        response.data?.status === 'ready' ||
        response.data?.status === 'degraded')
    );
  } catch {
    return false;
  }
}

function applyCsrfHeader(headers: AxiosHeaders, token: string) {
  headers.set('X-CSRF-Token', token);
  headers.set('x-csrf-token', token);
}

function isAuthFailure(status: number | undefined, message: string): boolean {
  if (status !== 401) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('authentication') ||
    lower.includes('unauthorized') ||
    lower.includes('log in') ||
    lower.includes('not authenticated') ||
    lower.includes('invalid token') ||
    lower.includes('jwt') ||
    lower.includes('token expired')
  );
}

api.interceptors.request.use(async (config) => {
  const headers = AxiosHeaders.from(config.headers);
  const authToken = await getToken();
  const sessionCookies = await getStoredSessionCookies();

  // Always send the cookie jar when present — CSRF double-submit needs `_csrf`
  // even when auth is Bearer JWT.
  if (sessionCookies) {
    headers.set('Cookie', sessionCookies);
  }
  if (authToken && authToken !== SESSION_AUTH_TOKEN) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const method = config.method?.toLowerCase();
  const isMutating = method && MUTATING_METHODS.has(method);

  if (isMutating) {
    const token = await refreshCsrfToken(false);
    applyCsrfHeader(headers, token);
  }

  // Drop default JSON content-type for FormData so RN can set multipart boundary.
  if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
    const contentType = headers.getContentType();
    if (!contentType || contentType.includes('application/json')) {
      headers.delete('Content-Type');
    }
  }

  config.headers = headers;
  config.withCredentials = isWeb;
  return config;
});

api.interceptors.response.use(
  async (response) => {
    await persistSessionCookies(response);
    return response;
  },
  async (error) => {
    const original = error.config;
    const message =
      error.response?.data?.message ?? error.response?.data?.error ?? '';
    const status = error.response?.status;

    const isCsrfError =
      typeof message === 'string' &&
      message.toLowerCase().includes('csrf') &&
      original &&
      !original._csrfRetry;

    if (isCsrfError) {
      original._csrfRetry = true;
      clearCsrfToken();
      const token = await refreshCsrfToken(true);
      const headers = AxiosHeaders.from(original.headers);
      applyCsrfHeader(headers, token);
      original.headers = headers;
      original.withCredentials = isWeb;
      return api(original);
    }

    if (
      original &&
      !original._authLogout &&
      isAuthFailure(status, String(message))
    ) {
      original._authLogout = true;
      await clearApiSession();
      await notifyUnauthorized();
    }

    return Promise.reject(error);
  }
);

declare module 'axios' {
  export interface AxiosRequestConfig {
    _csrfRetry?: boolean;
    _authLogout?: boolean;
  }
}
