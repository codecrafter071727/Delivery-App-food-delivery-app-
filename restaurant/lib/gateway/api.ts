import { api, refreshCsrfToken } from '@/lib/api';
import { getApiErrorMessage } from '@/lib/errors';

export type GatewayHealth = {
  success?: boolean;
  status: string;
  service?: string;
  uptime?: number;
  timestamp?: string;
};

export type GatewayReady = GatewayHealth & {
  services?: Record<string, { state?: string; status?: string }>;
};

export type SocketToken = {
  socketToken: string;
  expiresIn: number;
};

export type GatewayWarmResult = {
  reachable: boolean;
  readyStatus?: string;
  degraded: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function unwrapRecord(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  const nested = asRecord(root.data);
  return Object.keys(nested).length ? { ...root, ...nested } : root;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function isHealthyStatus(status?: string, success?: boolean): boolean {
  if (success === true) return true;
  const normalized = (status ?? '').toLowerCase();
  return (
    normalized === 'ok' ||
    normalized === 'ready' ||
    normalized === 'up' ||
    normalized === 'healthy' ||
    normalized === 'degraded'
  );
}

function mapHealth(payload: unknown, label: string): GatewayHealth {
  const record = unwrapRecord(payload);
  const status =
    pickString(record, ['status', 'state']) ??
    (record.success === true ? 'ok' : '');
  if (!isHealthyStatus(status, record.success === true)) {
    throw new Error(`${label} failed`);
  }
  return {
    success: record.success === true || undefined,
    status: status || 'ok',
    service: pickString(record, ['service']),
    uptime: pickNumber(record, ['uptime']),
    timestamp: pickString(record, ['timestamp']),
  };
}

/** GET /health — gateway process is up. */
export async function getGatewayHealth(): Promise<GatewayHealth> {
  try {
    const { data } = await api.get<unknown>('/health', { timeout: 10000 });
    return mapHealth(data, 'Gateway health check');
  } catch (error) {
    throw new Error(getApiErrorMessage(error, 'Cannot reach TOKAJO servers.'));
  }
}

/** GET /health/ready — downstream circuit states (still 200 when degraded). */
export async function getGatewayReady(): Promise<GatewayReady> {
  try {
    const { data } = await api.get<unknown>('/health/ready', {
      timeout: 12000,
    });
    const health = mapHealth(data, 'Gateway readiness check');
    const record = unwrapRecord(data);
    const services = asRecord(record.services) as GatewayReady['services'];
    return { ...health, services };
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, 'Delivery servers are still starting up.')
    );
  }
}

/**
 * POST /api/v1/socket-token
 * Short-lived Socket.IO credential (TTL ~10 min). Required on native —
 * the gateway rejects raw `auth.userId`.
 */
export async function mintSocketToken(): Promise<SocketToken> {
  try {
    const { data } = await api.post<unknown>('/api/v1/socket-token', {});
    const record = unwrapRecord(data);
    const socketToken =
      pickString(record, ['socketToken', 'token', 'accessToken']) ?? '';
    const expiresIn =
      pickNumber(record, ['expiresIn', 'expires_in', 'ttl', 'expiresInSeconds']) ??
      600;

    if (!socketToken) {
      throw new Error('Server did not return a socket token');
    }

    return {
      socketToken,
      expiresIn: Math.max(60, expiresIn),
    };
  } catch (error) {
    throw new Error(
      getApiErrorMessage(
        error,
        'Could not start live updates. Check your connection and try again.'
      )
    );
  }
}

/**
 * Splash / portal warm-up: liveness, readiness, then CSRF for mutating calls.
 * Degraded ready still counts as reachable (same as Swiggy — app opens, live
 * features retry in the background).
 */
export async function warmGatewaySession(): Promise<GatewayWarmResult> {
  try {
    await getGatewayHealth();
  } catch {
    return { reachable: false, degraded: false };
  }

  let readyStatus = 'unknown';
  let degraded = false;
  try {
    const ready = await getGatewayReady();
    readyStatus = ready.status;
    degraded = ready.status.toLowerCase() === 'degraded';
  } catch {
    readyStatus = 'unknown';
  }

  await refreshCsrfToken(true).catch(() => undefined);

  return { reachable: true, readyStatus, degraded };
}
