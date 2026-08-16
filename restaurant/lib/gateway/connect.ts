import { Platform } from 'react-native';
import { io, type Socket } from 'socket.io-client';

import { API_BASE_URL } from '@/lib/api';
import { mintSocketToken } from '@/lib/gateway/api';
import { getStoredSessionCookies } from '@/lib/session-cookies';

export function readCookieValue(
  jar: string | null | undefined,
  name: string
): string | undefined {
  if (!jar) return undefined;
  for (const part of jar.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    const raw = trimmed.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

async function buildSocketAuth(): Promise<{
  auth: Record<string, string>;
  cookies: string | null;
  expiresIn: number;
}> {
  const cookies = await getStoredSessionCookies();
  const sid = readCookieValue(cookies, '_sid');
  const minted = await mintSocketToken();

  return {
    cookies,
    expiresIn: minted.expiresIn,
    auth: {
      socketToken: minted.socketToken,
      ...(sid ? { sid, sessionId: sid } : {}),
    },
  };
}

async function remintSocketAuth(socket: Socket): Promise<number | undefined> {
  try {
    const next = await buildSocketAuth();
    socket.auth = next.auth;
    return next.expiresIn;
  } catch {
    return undefined;
  }
}

/**
 * Open `{GATEWAY}/socket.io/` with production auth:
 * `auth.socketToken` (mobile) + `_sid` cookie / `auth.sid` (web + native header).
 * Never connect with raw `userId` alone.
 */
export async function connectGatewaySocket(): Promise<{
  socket: Socket;
  expiresIn: number;
}> {
  const { auth, cookies, expiresIn } = await buildSocketAuth();
  const isWeb = Platform.OS === 'web';

  const socket = io(API_BASE_URL, {
    path: '/socket.io/',
    transports: ['websocket', 'polling'],
    withCredentials: isWeb,
    extraHeaders: cookies ? { Cookie: cookies } : undefined,
    auth,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    randomizationFactor: 0.4,
    timeout: 20000,
    autoConnect: true,
    forceNew: true,
  });

  socket.io.on('reconnect_attempt', () => {
    void remintSocketAuth(socket);
  });

  return { socket, expiresIn };
}

/** Wait until the socket is connected, or fail so callers can retry cleanly. */
export function waitForSocketConnect(
  socket: Socket,
  timeoutMs = 18000
): Promise<void> {
  if (socket.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const onConnect = () => finish();
    const onError = (err: { message?: string }) => {
      const message = String(err?.message ?? 'Realtime connection failed');
      if (message.toUpperCase().includes('UNAUTHORIZED')) {
        finish(new Error('Live session expired. Reconnecting…'));
      }
    };

    const timer = setTimeout(() => {
      finish(new Error('Live updates timed out. Check your internet and try again.'));
    }, timeoutMs);

    socket.once('connect', onConnect);
    socket.on('connect_error', onError);
  });
}
