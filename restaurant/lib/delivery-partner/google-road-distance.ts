import { GOOGLE_MAPS_API_KEY } from '@/lib/google-maps';
import type {
  RouteEstimateLeg,
  RouteEstimatePoint,
} from '@/lib/delivery-partner/route-estimate-api';

type MatrixElement = {
  status?: string;
  distance?: { value?: number };
  duration?: { value?: number };
  duration_in_traffic?: { value?: number };
};

type MatrixResponse = {
  status?: string;
  error_message?: string;
  rows?: Array<{ elements?: MatrixElement[] }>;
};

function validPoint(p?: RouteEstimatePoint | null): p is RouteEstimatePoint {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    !(p.latitude === 0 && p.longitude === 0)
  );
}

/**
 * Direct Google Distance Matrix (Expo key) — fallback when server has no key
 * or returns haversine. Needs Distance Matrix API enabled on the key.
 */
export async function fetchGoogleRoadLegs(
  legs: Array<{
    id?: string;
    origin: RouteEstimatePoint;
    destination: RouteEstimatePoint;
  }>
): Promise<RouteEstimateLeg[]> {
  if (!GOOGLE_MAPS_API_KEY || !legs.length) return [];

  const results: RouteEstimateLeg[] = [];
  for (const leg of legs) {
    if (!validPoint(leg.origin) || !validPoint(leg.destination)) continue;
    const params = new URLSearchParams({
      origins: `${leg.origin.latitude},${leg.origin.longitude}`,
      destinations: `${leg.destination.latitude},${leg.destination.longitude}`,
      mode: 'driving',
      key: GOOGLE_MAPS_API_KEY,
    });
    try {
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`
      );
      if (!res.ok) continue;
      const json = (await res.json()) as MatrixResponse;
      const el = json.rows?.[0]?.elements?.[0];
      if (json.status !== 'OK' || el?.status !== 'OK') continue;
      const meters = el.distance?.value;
      const seconds =
        el.duration_in_traffic?.value ?? el.duration?.value;
      if (meters == null || !Number.isFinite(meters)) continue;
      const distanceKm = Math.round((meters / 1000) * 100) / 100;
      const etaSeconds = seconds ?? Math.round((distanceKm / 22) * 3600);
      results.push({
        id: leg.id,
        distanceMeters: Math.round(meters),
        distanceKm,
        etaSeconds,
        etaMinutes: Math.max(1, Math.ceil(etaSeconds / 60)),
        source: 'distance_matrix',
        provider: 'google',
      });
    } catch {
      // ignore — caller keeps haversine
    }
  }
  return results;
}
