import type { AxiosResponse } from 'axios';

import {
  storageDeleteItem,
  storageGetItem,
  storageSetItem,
} from '@/lib/storage';

const COOKIE_KEY = 'partner_session_cookies';

function parseCookiePair(pair: string): [string, string] | null {
  const trimmed = pair.trim();
  if (!trimmed) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  return [trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim()];
}

function mergeCookieStrings(existing: string | null, incoming: string): string {
  const jar = new Map<string, string>();

  for (const part of (existing ?? '').split(';')) {
    const parsed = parseCookiePair(part);
    if (parsed) jar.set(parsed[0], parsed[1]);
  }

  for (const part of incoming.split(';')) {
    const parsed = parseCookiePair(part);
    if (parsed) jar.set(parsed[0], parsed[1]);
  }

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function readSetCookieHeader(headers: AxiosResponse['headers']): string | null {
  const raw =
    headers['set-cookie'] ??
    headers['Set-Cookie'] ??
    (headers as Record<string, unknown>)['set-cookie'];

  if (!raw) return null;

  const list = Array.isArray(raw) ? raw : [String(raw)];
  const pairs = list
    .map((cookie) => String(cookie).split(';')[0]?.trim())
    .filter(Boolean);

  return pairs.length ? pairs.join('; ') : null;
}

export async function getStoredSessionCookies(): Promise<string | null> {
  return storageGetItem(COOKIE_KEY);
}

export async function persistSessionCookies(
  response: AxiosResponse
): Promise<void> {
  const incoming = readSetCookieHeader(response.headers);
  if (!incoming) return;

  const existing = await getStoredSessionCookies();
  const merged = mergeCookieStrings(existing, incoming);
  await storageSetItem(COOKIE_KEY, merged);
}

export async function clearSessionCookies(): Promise<void> {
  await storageDeleteItem(COOKIE_KEY);
}
