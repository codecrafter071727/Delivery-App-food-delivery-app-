/**
 * Rider location + live tracking DTOs.
 * Gateway: /api/v1/delivery-service
 */

export type TrackingProvider = 'google' | 'haversine' | string;

export type DemandIntensity = 'low' | 'medium' | 'high' | 'very_high' | string;

export type TrackingDestinationKind = 'restaurant' | 'customer' | 'arrived' | string;

export type PartnerLiveLocation = {
  partnerId?: string;
  latitude: number;
  longitude: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  updatedAt?: string;
  ageSeconds?: number;
  stale?: boolean;
  source?: string;
  lowAccuracy?: boolean;
};

export type LocationPingResult = {
  accepted: boolean;
  throttled: boolean;
  recordedAt?: string;
  nextPingAfterMs: number;
  staleAfterMs?: number;
  activeDeliveryId?: string | null;
  lowAccuracy: boolean;
  location?: PartnerLiveLocation | null;
};

export type PartnerHomeLocation = {
  latitude: number;
  longitude: number;
  address?: string;
  zoneId?: string | null;
  updatedAt?: string;
};

export type HeatmapZone = {
  zoneId?: string;
  name?: string;
  city?: string;
  latitude: number;
  longitude: number;
  distanceKm?: number;
  surgeMultiplier?: number;
  activePartners?: number;
  openDeliveries?: number;
  demandScore?: number;
  intensity: DemandIntensity;
};

export type HeatmapCell = {
  latitude: number;
  longitude: number;
  demand: number;
  intensity: DemandIntensity;
};

export type NearbyDemandHeatmap = {
  origin: { latitude: number; longitude: number };
  radiusKm: number;
  generatedAt?: string;
  zones: HeatmapZone[];
  cells: HeatmapCell[];
};

export type GpsHeartbeatResult = {
  alive: boolean;
  heartbeatAt?: string;
  nextHeartbeatMs: number;
  onDelivery: boolean;
  activeDeliveryId?: string | null;
  location?: PartnerLiveLocation | null;
};

export type LocationHistoryPoint = {
  latitude: number;
  longitude: number;
  timestamp?: string;
  speed?: number;
};

export type LocationHistory = {
  deliveryId: string;
  orderId?: string;
  status?: string;
  count: number;
  polyline?: string;
  points: LocationHistoryPoint[];
};

export type TrackingLatLng = {
  latitude: number;
  longitude: number;
  address?: string;
  kind?: TrackingDestinationKind;
};

export type TrackingGeofence = {
  pickupMeters: number;
  dropMeters: number;
  atPickup: boolean;
  atDrop: boolean;
};

export type TrackingPartnerInfo = {
  partnerId?: string;
  name?: string;
  photo?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  rating?: number;
  phoneMasked?: string;
};

export type OrderTracking = {
  orderId: string;
  deliveryId?: string;
  status: string;
  dutyHint?: string;
  etaSeconds?: number | null;
  etaAt?: string | null;
  distanceMeters?: number | null;
  polyline?: string;
  pickup?: TrackingLatLng | null;
  drop?: TrackingLatLng | null;
  riderLocation?: PartnerLiveLocation | null;
  partner?: TrackingPartnerInfo | null;
  geofence?: TrackingGeofence | null;
  provider?: TrackingProvider;
  trafficFactor?: number;
  durationInTraffic?: boolean;
};

export type TrackingEta = {
  orderId: string;
  etaSeconds?: number | null;
  etaAt?: string | null;
  distanceMeters?: number | null;
  trafficFactor?: number;
  destination?: TrackingDestinationKind;
  provider?: TrackingProvider;
  durationInTraffic?: boolean;
};

export type TrackingRoute = {
  orderId: string;
  polyline?: string;
  points: TrackingLatLng[];
  distanceMeters?: number | null;
  etaSeconds?: number | null;
  destination?: TrackingLatLng | null;
  trafficFactor?: number;
  provider?: TrackingProvider;
  durationInTraffic?: boolean;
};

export const IDLE_PING_MS = 8_000;
export const TRIP_PING_MS = 4_000;
export const IDLE_HEARTBEAT_MS = 15_000;
export const TRIP_HEARTBEAT_MS = 4_000;
export const LOW_ACCURACY_METERS = 80;

export const LOCATION_ERROR_COPY: Record<string, string> = {
  UNAUTHORIZED: 'Session expired. Please log in again.',
  FORBIDDEN: 'This trip is not assigned to you.',
  PARTNER_OFFLINE: 'Go online first to share GPS and receive orders.',
  MOCK_LOCATION: 'Turn off mock GPS / fake location, then try again.',
  LOCATION_NOT_FOUND: 'Enable GPS and send your location once.',
  LOCATION_REQUIRED: 'Ping GPS or set your home location first.',
  DELIVERY_NOT_FOUND: 'Active delivery not found. Pull to refresh.',
  TRACKING_COMPLETE: 'This trip is finished.',
  TRACKING_INCOMPLETE: 'Pickup or drop pin is missing. Retry in a moment.',
};

export function intensityColor(intensity?: DemandIntensity | null): string {
  const key = String(intensity ?? '').toLowerCase();
  if (key === 'very_high' || key === 'veryhigh') return '#B91C1C';
  if (key === 'high') return '#EA4B14';
  if (key === 'medium') return '#EAB308';
  return '#22C55E';
}

export function formatEtaSeconds(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 'Arrived';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m} min`;
  return `${s}s`;
}

export function formatDistanceMeters(meters?: number | null): string {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function isLiveTrafficEta(input?: {
  provider?: string | null;
  durationInTraffic?: boolean | null;
}): boolean {
  return (
    String(input?.provider ?? '').toLowerCase() === 'google' &&
    Boolean(input?.durationInTraffic)
  );
}

export function etaLabel(input?: {
  provider?: string | null;
  durationInTraffic?: boolean | null;
}): string {
  return isLiveTrafficEta(input) ? 'Live traffic' : 'Approx. ETA';
}

export function mpsToKmh(speedMps?: number | null): number | undefined {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) {
    return undefined;
  }
  return Math.min(200, Math.max(0, speedMps * 3.6));
}

/** Compass degrees 0–360. Expo uses -1 when heading is unavailable. */
export function clampHeading(heading?: number | null): number | undefined {
  if (heading == null || !Number.isFinite(heading) || heading < 0) {
    return undefined;
  }
  const normalized = ((heading % 360) + 360) % 360;
  return Number(normalized.toFixed(1));
}

export function formatLocationAge(updatedAt?: string, ageSeconds?: number) {
  const seconds =
    ageSeconds ??
    (updatedAt
      ? Math.max(0, Math.round((Date.now() - Date.parse(updatedAt)) / 1000))
      : null);
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 15) return 'Live';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
