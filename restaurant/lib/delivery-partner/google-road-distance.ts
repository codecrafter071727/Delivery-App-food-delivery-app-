import { GOOGLE_MAPS_API_KEY } from '@/lib/google-maps';

export type GoogleRoadLeg = {
  id?: string;
  distanceMeters: number;
  distanceKm: number;
  etaSeconds: number;
  etaMinutes: number;
  source: 'directions' | 'distance_matrix';
  provider: 'google';
};

export type RoadPoint = {
  latitude: number;
  longitude: number;
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

async function fetchDirectionsLeg(
  origin: RoadPoint,
  destination: RoadPoint,
  id?: string
): Promise<GoogleRoadLeg | null> {
  const params = new URLSearchParams({
    origin: `${origin.latitude},${origin.longitude}`,
    destination: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    key: GOOGLE_MAPS_API_KEY,
  });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`
  );
  if (!res.ok) return null;
  const json = (await res.json()) as DirectionsResponse;
  const leg = json.routes?.[0]?.legs?.[0];
  const meters = leg?.distance?.value;
  const seconds =
    leg?.duration_in_traffic?.value ?? leg?.duration?.value;
  if (json.status !== 'OK' || meters == null || !Number.isFinite(meters)) {
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
  const params = new URLSearchParams({
    origins: `${origin.latitude},${origin.longitude}`,
    destinations: `${destination.latitude},${destination.longitude}`,
    mode: 'driving',
    key: GOOGLE_MAPS_API_KEY,
  });
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`
  );
  if (!res.ok) return null;
  const json = (await res.json()) as MatrixResponse;
  const el = json.rows?.[0]?.elements?.[0];
  const meters = el?.distance?.value;
  const seconds =
    el?.duration_in_traffic?.value ?? el?.duration?.value;
  if (
    json.status !== 'OK' ||
    el?.status !== 'OK' ||
    meters == null ||
    !Number.isFinite(meters)
  ) {
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
    const viaDirections = await fetchDirectionsLeg(
      input.origin,
      input.destination,
      input.id
    );
    if (viaDirections) return viaDirections;
    return await fetchMatrixLeg(input.origin, input.destination, input.id);
  } catch {
    return null;
  }
}

/**
 * Road km via Expo `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`.
 * Directions first (same as Google Maps), then Distance Matrix.
 * Enable Directions API + Distance Matrix API on that key.
 */
export async function fetchGoogleRoadLegs(
  legs: Array<{
    id?: string;
    origin: RoadPoint;
    destination: RoadPoint;
  }>
): Promise<GoogleRoadLeg[]> {
  if (!GOOGLE_MAPS_API_KEY || !legs.length) return [];
  const settled = await Promise.all(legs.map((leg) => fetchOneRoadLeg(leg)));
  return settled.filter((leg): leg is GoogleRoadLeg => Boolean(leg));
}
