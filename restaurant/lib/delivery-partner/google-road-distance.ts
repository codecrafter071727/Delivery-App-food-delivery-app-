import axios from 'axios';

import { GOOGLE_MAPS_API_KEY } from '@/lib/google-maps';

export type GoogleRoadLeg = {
  id?: string;
  distanceMeters: number;
  distanceKm: number;
  etaSeconds: number;
  etaMinutes: number;
  source: 'routes' | 'directions' | 'distance_matrix';
  provider: 'google';
};

export type RoadPoint = {
  latitude: number;
  longitude: number;
};

type RoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    legs?: Array<{
      distanceMeters?: number;
      duration?: string;
    }>;
  }>;
  error?: { message?: string; status?: string };
};

type DirectionsResponse = {
  status?: string;
  error_message?: string;
  routes?: Array<{
    legs?: Array<{
      distance?: { value?: number };
      duration?: { value?: number };
      duration_in_traffic?: { value?: number };
    }>;
  }>;
};

type MatrixResponse = {
  status?: string;
  error_message?: string;
  rows?: Array<{
    elements?: Array<{
      status?: string;
      distance?: { value?: number };
      duration?: { value?: number };
      duration_in_traffic?: { value?: number };
    }>;
  }>;
};

function validPoint(p?: RoadPoint | null): p is RoadPoint {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

function parseDurationSeconds(raw?: string | null): number | null {
  if (!raw) return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(raw.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toLeg(
  id: string | undefined,
  meters: number,
  seconds: number,
  source: GoogleRoadLeg['source']
): GoogleRoadLeg {
  const distanceKm = Math.round((meters / 1000) * 100) / 100;
  const etaSeconds = Math.max(60, Math.round(seconds));
  return {
    id,
    distanceMeters: Math.round(meters),
    distanceKm,
    etaSeconds,
    etaMinutes: Math.max(1, Math.ceil(etaSeconds / 60)),
    source,
    provider: 'google',
  };
}

function warnRoad(msg: string, extra?: Record<string, unknown>) {
  if (__DEV__) {
    console.warn(`[offer-road] ${msg}`, extra ?? '');
  }
}

/** New Routes API — same X-Goog-Api-Key pattern as Places (works with Expo key). */
async function fetchRoutesLeg(
  origin: RoadPoint,
  destination: RoadPoint,
  id?: string
): Promise<GoogleRoadLeg | null> {
  const { data } = await axios.post<RoutesResponse>(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    {
      origin: {
        location: {
          latLng: {
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
        },
      },
      destination: {
        location: {
          latLng: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE',
      computeAlternativeRoutes: false,
      languageCode: 'en-IN',
      units: 'METRIC',
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration',
      },
      timeout: 12_000,
    }
  );

  const route = data.routes?.[0];
  const meters = route?.distanceMeters ?? route?.legs?.[0]?.distanceMeters;
  const seconds =
    parseDurationSeconds(route?.duration) ??
    parseDurationSeconds(route?.legs?.[0]?.duration);
  if (meters == null || !Number.isFinite(meters) || meters <= 0) {
    warnRoad('Routes API empty', { id, error: data.error?.message });
    return null;
  }
  return toLeg(
    id,
    meters,
    seconds ?? (meters / 1000 / 22) * 3600,
    'routes'
  );
}

async function fetchDirectionsLeg(
  origin: RoadPoint,
  destination: RoadPoint,
  id?: string
): Promise<GoogleRoadLeg | null> {
  const { data } = await axios.get<DirectionsResponse>(
    'https://maps.googleapis.com/maps/api/directions/json',
    {
      params: {
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        mode: 'driving',
        key: GOOGLE_MAPS_API_KEY,
      },
      timeout: 12_000,
    }
  );
  const leg = data.routes?.[0]?.legs?.[0];
  const meters = leg?.distance?.value;
  const seconds =
    leg?.duration_in_traffic?.value ?? leg?.duration?.value;
  if (data.status !== 'OK' || meters == null) {
    warnRoad('Directions failed', {
      id,
      status: data.status,
      error: data.error_message,
    });
    return null;
  }
  return toLeg(
    id,
    meters,
    seconds ?? (meters / 1000 / 22) * 3600,
    'directions'
  );
}

async function fetchMatrixLeg(
  origin: RoadPoint,
  destination: RoadPoint,
  id?: string
): Promise<GoogleRoadLeg | null> {
  const { data } = await axios.get<MatrixResponse>(
    'https://maps.googleapis.com/maps/api/distancematrix/json',
    {
      params: {
        origins: `${origin.latitude},${origin.longitude}`,
        destinations: `${destination.latitude},${destination.longitude}`,
        mode: 'driving',
        key: GOOGLE_MAPS_API_KEY,
      },
      timeout: 12_000,
    }
  );
  const el = data.rows?.[0]?.elements?.[0];
  const meters = el?.distance?.value;
  const seconds =
    el?.duration_in_traffic?.value ?? el?.duration?.value;
  if (data.status !== 'OK' || el?.status !== 'OK' || meters == null) {
    warnRoad('Distance Matrix failed', {
      id,
      status: data.status,
      element: el?.status,
      error: data.error_message,
    });
    return null;
  }
  return toLeg(
    id,
    meters,
    seconds ?? (meters / 1000 / 22) * 3600,
    'distance_matrix'
  );
}

async function fetchOneRoadLeg(input: {
  id?: string;
  origin: RoadPoint;
  destination: RoadPoint;
}): Promise<GoogleRoadLeg | null> {
  if (!validPoint(input.origin) || !validPoint(input.destination)) return null;
  try {
    const viaRoutes = await fetchRoutesLeg(
      input.origin,
      input.destination,
      input.id
    );
    if (viaRoutes) return viaRoutes;
  } catch (err) {
    warnRoad('Routes API error', {
      id: input.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    const viaDirections = await fetchDirectionsLeg(
      input.origin,
      input.destination,
      input.id
    );
    if (viaDirections) return viaDirections;
  } catch (err) {
    warnRoad('Directions error', {
      id: input.id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    return await fetchMatrixLeg(input.origin, input.destination, input.id);
  } catch (err) {
    warnRoad('Matrix error', {
      id: input.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Driving road km via Expo `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
 * Prefers Routes API (header key, same as Places), then Directions, then Matrix.
 * Enable: Routes API, Directions API, Distance Matrix API on the key.
 */
export async function fetchGoogleRoadLegs(
  legs: Array<{
    id?: string;
    origin: RoadPoint;
    destination: RoadPoint;
  }>
): Promise<GoogleRoadLeg[]> {
  if (!GOOGLE_MAPS_API_KEY) {
    warnRoad('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY missing');
    return [];
  }
  if (!legs.length) return [];
  const settled = await Promise.all(legs.map((leg) => fetchOneRoadLeg(leg)));
  return settled.filter((leg): leg is GoogleRoadLeg => Boolean(leg));
}

export function isGoogleMapsKeyConfigured(): boolean {
  return Boolean(GOOGLE_MAPS_API_KEY);
}
