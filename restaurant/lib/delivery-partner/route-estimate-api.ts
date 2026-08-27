import { api, assertApiBaseUrl } from '@/lib/api';
import { getApiErrorMessage, PartnerApiError } from '@/lib/errors';

const ME_BASE = '/api/v1/delivery-service/partners/me';

export type RouteEstimateProvider = 'google' | 'haversine';

export type RouteEstimateLeg = {
  id?: string;
  distanceMeters: number;
  distanceKm: number;
  etaSeconds: number;
  etaMinutes: number;
  source: 'directions' | 'distance_matrix' | 'haversine';
  provider: RouteEstimateProvider;
};

export type RouteEstimatePoint = {
  latitude: number;
  longitude: number;
};

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function mapLeg(raw: unknown): RouteEstimateLeg | null {
  const row = asRecord(raw);
  const distanceMeters = pickNumber(row, ['distanceMeters', 'distance_meters']);
  const distanceKm = pickNumber(row, ['distanceKm', 'distance_km']);
  const etaSeconds = pickNumber(row, ['etaSeconds', 'eta_seconds']);
  const etaMinutes = pickNumber(row, ['etaMinutes', 'eta_minutes']);
  if (distanceMeters == null || distanceKm == null) return null;
  const sourceRaw = pickString(row, ['source']) ?? 'haversine';
  const source =
    sourceRaw === 'directions' || sourceRaw === 'distance_matrix'
      ? sourceRaw
      : 'haversine';
  const providerRaw = pickString(row, ['provider']) ?? 'haversine';
  return {
    id: pickString(row, ['id']),
    distanceMeters,
    distanceKm,
    etaSeconds: etaSeconds ?? Math.round(distanceKm * 180),
    etaMinutes: etaMinutes ?? Math.max(1, Math.ceil((etaSeconds ?? 60) / 60)),
    source,
    provider: providerRaw === 'google' ? 'google' : 'haversine',
  };
}

/**
 * Google road distance for offer legs (rider→restaurant, restaurant→customer).
 * Uses delivery-service MapsRoutingService (Directions → Matrix → haversine).
 */
export async function fetchRouteEstimate(input: {
  vehicleType?: string;
  legs: Array<{
    id?: string;
    origin: RouteEstimatePoint;
    destination: RouteEstimatePoint;
  }>;
}): Promise<RouteEstimateLeg[]> {
  assertApiBaseUrl();
  try {
    const res = await api.post<Envelope<{ legs?: unknown[] }>>(
      `${ME_BASE}/route-estimate`,
      {
        vehicleType: input.vehicleType ?? 'bike',
        legs: input.legs,
      }
    );
    const data = asRecord(res.data?.data ?? res.data);
    const list = Array.isArray(data.legs) ? data.legs : [];
    return list.map(mapLeg).filter((leg): leg is RouteEstimateLeg => Boolean(leg));
  } catch (error) {
    throw new PartnerApiError(
      getApiErrorMessage(error, 'Could not estimate road distance')
    );
  }
}
