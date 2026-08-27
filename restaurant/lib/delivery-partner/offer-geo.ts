/** Haversine + road ETA for rider offer popup (matches delivery-service defaults). */

const ROAD_DISTANCE_MULTIPLIER = 1.25;
const AVERAGE_RIDER_SPEED_KMH = 22;
const TRAFFIC_BUFFER_MINUTES = 3;

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatTripKm(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km) || km < 0) return null;
  if (km < 0.05) return '< 50 m';
  if (km < 0.1) return `${Math.round(km * 1000)} m`;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/** Aerial km → approximate road km + travel minutes. */
export function estimateLegEtaMinutes(aerialKm: number | null | undefined): number | null {
  if (aerialKm == null || !Number.isFinite(aerialKm) || aerialKm < 0) return null;
  const roadKm = aerialKm * ROAD_DISTANCE_MULTIPLIER;
  const speed = Math.max(5, AVERAGE_RIDER_SPEED_KMH);
  const travelMinutes = (roadKm / speed) * 60;
  return Math.max(1, Math.ceil(travelMinutes + TRAFFIC_BUFFER_MINUTES));
}

export function formatEtaMinutes(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `~${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
}

export function formatKmWithEta(
  km: number | null | undefined,
  etaMinutes?: number | null
): string | null {
  const kmLabel = formatTripKm(km);
  const etaLabel = formatEtaMinutes(
    etaMinutes ?? estimateLegEtaMinutes(km)
  );
  if (kmLabel && etaLabel) return `${kmLabel} · ${etaLabel}`;
  return kmLabel ?? etaLabel;
}
