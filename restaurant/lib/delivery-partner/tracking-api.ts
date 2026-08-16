import axios from 'axios';

import { api, assertApiBaseUrl } from '@/lib/api';
import { getApiErrorCode, getApiErrorMessage, PartnerApiError } from '@/lib/errors';
import {
  IDLE_HEARTBEAT_MS,
  IDLE_PING_MS,
  LOCATION_ERROR_COPY,
  TRIP_HEARTBEAT_MS,
  TRIP_PING_MS,
  clampHeading,
  mpsToKmh,
  type GpsHeartbeatResult,
  type LocationHistory,
  type LocationHistoryPoint,
  type LocationPingResult,
  type NearbyDemandHeatmap,
  type OrderTracking,
  type PartnerHomeLocation,
  type PartnerLiveLocation,
  type TrackingEta,
  type TrackingGeofence,
  type TrackingLatLng,
  type TrackingRoute,
} from '@/lib/delivery-partner/tracking-types';
import type { PartnerGpsCoords } from '@/lib/delivery-partner/types';
import { canFallbackToRest } from '@/lib/delivery-partner/rider-ack';
import { emitRiderEvent, isRiderSocketConnected } from '@/lib/delivery-partner/rider-gateway';

const ME_BASE = '/api/v1/delivery-service/partners/me';
const TRACKING_BASE = '/api/v1/delivery-service/tracking';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  code?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function pickBool(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return undefined;
}

function unwrap(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!Object.keys(record).length) return payload;
  if ('data' in record) return record.data;
  return payload;
}

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const record = asRecord(data);
  const nested =
    record.zones ??
    record.cells ??
    record.points ??
    record.items ??
    record.results ??
    record.list ??
    record.data;
  if (Array.isArray(nested)) return nested;
  return [];
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    params?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<Envelope<T>> {
  const { method = 'GET', body, params } = options;
  assertApiBaseUrl();
  try {
    const response = await api.request<Envelope<T> | T>({
      url: path,
      method,
      data: method === 'GET' || method === 'DELETE' ? undefined : (body ?? {}),
      params,
    });
    const payload = response.data as Envelope<T> | T;
    if (
      payload &&
      typeof payload === 'object' &&
      ('data' in (payload as object) || 'success' in (payload as object))
    ) {
      return payload as Envelope<T>;
    }
    return { success: true, data: payload as T };
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      throw new PartnerApiError(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    throw new PartnerApiError(
      getApiErrorMessage(error, 'Request failed'),
      getApiErrorCode(error)
    );
  }
}

export function formatLocationError(error: unknown, fallback: string): string {
  const code =
    error instanceof PartnerApiError ? error.code : getApiErrorCode(error);
  if (code && LOCATION_ERROR_COPY[code]) return LOCATION_ERROR_COPY[code];
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback;
  return message || fallback;
}

export function mapLiveLocation(raw: unknown): PartnerLiveLocation | null {
  const record = asRecord(unwrap(raw));
  const nested = asRecord(record.location ?? record);
  const source = Object.keys(nested).length ? nested : record;
  const latitude =
    pickNumber(source, ['latitude', 'lat']) ??
    pickNumber(record, ['latitude', 'lat']);
  const longitude =
    pickNumber(source, ['longitude', 'lng', 'lon']) ??
    pickNumber(record, ['longitude', 'lng', 'lon']);
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return {
    partnerId: pickString(source, ['partnerId', 'id']),
    latitude,
    longitude,
    heading: pickNumber(source, ['heading', 'bearing']) ?? null,
    speed: pickNumber(source, ['speed']) ?? null,
    accuracy: pickNumber(source, ['accuracy']) ?? null,
    updatedAt: pickString(source, ['updatedAt', 'recordedAt', 'timestamp']),
    ageSeconds: pickNumber(source, ['ageSeconds']),
    stale: pickBool(source, ['stale']),
    source: pickString(source, ['source']),
    lowAccuracy: pickBool(source, ['lowAccuracy']),
  };
}

function mapLatLng(raw: unknown): TrackingLatLng | null {
  const record = asRecord(raw);
  const latitude = pickNumber(record, ['latitude', 'lat']);
  const longitude = pickNumber(record, ['longitude', 'lng', 'lon']);
  if (latitude == null || longitude == null) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return {
    latitude,
    longitude,
    address: pickString(record, ['address', 'label']),
    kind: pickString(record, ['kind', 'type', 'destination']),
  };
}

function mapGeofence(raw: unknown): TrackingGeofence | null {
  const record = asRecord(raw);
  if (!Object.keys(record).length) return null;
  return {
    pickupMeters: pickNumber(record, ['pickupMeters', 'pickupRadius']) ?? 150,
    dropMeters: pickNumber(record, ['dropMeters', 'dropRadius']) ?? 100,
    atPickup: pickBool(record, ['atPickup', 'insidePickup']) ?? false,
    atDrop: pickBool(record, ['atDrop', 'insideDrop']) ?? false,
  };
}

export function mapLocationPing(raw: unknown): LocationPingResult {
  const record = asRecord(unwrap(raw));
  const onDelivery = Boolean(
    pickString(record, ['activeDeliveryId']) ||
      pickBool(record, ['onDelivery'])
  );
  return {
    accepted: pickBool(record, ['accepted']) ?? true,
    throttled: pickBool(record, ['throttled']) ?? false,
    recordedAt: pickString(record, ['recordedAt']),
    nextPingAfterMs:
      pickNumber(record, ['nextPingAfterMs', 'nextPingMs']) ??
      (onDelivery ? TRIP_PING_MS : IDLE_PING_MS),
    staleAfterMs: pickNumber(record, ['staleAfterMs']),
    activeDeliveryId: pickString(record, ['activeDeliveryId']) ?? null,
    lowAccuracy: pickBool(record, ['lowAccuracy']) ?? false,
    location: mapLiveLocation(record.location ?? record),
  };
}

function mapHomeLocation(raw: unknown): PartnerHomeLocation {
  const record = asRecord(unwrap(raw));
  return {
    latitude: pickNumber(record, ['latitude', 'lat']) ?? 0,
    longitude: pickNumber(record, ['longitude', 'lng']) ?? 0,
    address: pickString(record, ['address']),
    zoneId: pickString(record, ['zoneId']) ?? null,
    updatedAt: pickString(record, ['updatedAt']),
  };
}

function mapHeatmap(raw: unknown): NearbyDemandHeatmap {
  const record = asRecord(unwrap(raw));
  const originRecord = asRecord(record.origin);
  const originLat =
    pickNumber(originRecord, ['latitude', 'lat']) ??
    pickNumber(record, ['latitude', 'lat']) ??
    0;
  const originLng =
    pickNumber(originRecord, ['longitude', 'lng']) ??
    pickNumber(record, ['longitude', 'lng']) ??
    0;

  const zones = extractList(record.zones ?? record)
    .map((row) => {
      const item = asRecord(row);
      const latitude = pickNumber(item, ['latitude', 'lat']);
      const longitude = pickNumber(item, ['longitude', 'lng']);
      if (latitude == null || longitude == null) return null;
      return {
        zoneId: pickString(item, ['zoneId', 'id']),
        name: pickString(item, ['name', 'label']),
        city: pickString(item, ['city']),
        latitude,
        longitude,
        distanceKm: pickNumber(item, ['distanceKm', 'distance']),
        surgeMultiplier: pickNumber(item, ['surgeMultiplier', 'surge']),
        activePartners: pickNumber(item, ['activePartners']),
        openDeliveries: pickNumber(item, ['openDeliveries']),
        demandScore: pickNumber(item, ['demandScore', 'score']),
        intensity: (pickString(item, ['intensity']) ?? 'low').toLowerCase(),
      };
    })
    .filter((z): z is NonNullable<typeof z> => Boolean(z));

  const cellsSource = Array.isArray(record.cells) ? record.cells : [];
  const cells = cellsSource
    .map((row) => {
      const item = asRecord(row);
      const latitude = pickNumber(item, ['latitude', 'lat']);
      const longitude = pickNumber(item, ['longitude', 'lng']);
      if (latitude == null || longitude == null) return null;
      return {
        latitude,
        longitude,
        demand: pickNumber(item, ['demand', 'count']) ?? 0,
        intensity: (pickString(item, ['intensity']) ?? 'low').toLowerCase(),
      };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  return {
    origin: { latitude: originLat, longitude: originLng },
    radiusKm: pickNumber(record, ['radiusKm', 'radius']) ?? 8,
    generatedAt: pickString(record, ['generatedAt']),
    zones,
    cells,
  };
}

export function mapHeartbeat(raw: unknown): GpsHeartbeatResult {
  const record = asRecord(unwrap(raw));
  const onDelivery = pickBool(record, ['onDelivery']) ?? false;
  return {
    alive: pickBool(record, ['alive']) ?? true,
    heartbeatAt: pickString(record, ['heartbeatAt']),
    nextHeartbeatMs:
      pickNumber(record, ['nextHeartbeatMs', 'nextHeartbeatAfterMs']) ??
      (onDelivery ? TRIP_HEARTBEAT_MS : IDLE_HEARTBEAT_MS),
    onDelivery,
    activeDeliveryId: pickString(record, ['activeDeliveryId']) ?? null,
    location: mapLiveLocation(record.location),
  };
}

function mapHistoryPoint(raw: unknown): LocationHistoryPoint | null {
  const point = mapLatLng(raw);
  if (!point) return null;
  const record = asRecord(raw);
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    timestamp: pickString(record, ['timestamp', 'recordedAt', 'updatedAt']),
    speed: pickNumber(record, ['speed']),
  };
}

function mapHistory(raw: unknown): LocationHistory {
  const record = asRecord(unwrap(raw));
  const points = extractList(record.points)
    .map(mapHistoryPoint)
    .filter((p): p is LocationHistoryPoint => Boolean(p));
  return {
    deliveryId: pickString(record, ['deliveryId', 'id']) ?? '',
    orderId: pickString(record, ['orderId']),
    status: pickString(record, ['status']),
    count: pickNumber(record, ['count']) ?? points.length,
    polyline: pickString(record, ['polyline']),
    points,
  };
}

export function mapOrderTracking(raw: unknown): OrderTracking {
  const record = asRecord(unwrap(raw));
  const rider = mapLiveLocation(
    record.riderLocation ?? record.location ?? record.partnerLocation
  );
  return {
    orderId: pickString(record, ['orderId']) ?? '',
    deliveryId: pickString(record, ['deliveryId']),
    status: pickString(record, ['status']) ?? '',
    dutyHint: pickString(record, ['dutyHint', 'hint', 'statusLabel']),
    etaSeconds: pickNumber(record, ['etaSeconds', 'eta']),
    etaAt: pickString(record, ['etaAt']),
    distanceMeters: pickNumber(record, ['distanceMeters', 'distance']),
    polyline: pickString(record, ['polyline']),
    pickup: mapLatLng(record.pickup ?? record.restaurant ?? record.origin),
    drop: mapLatLng(record.drop ?? record.customer ?? record.destination),
    riderLocation: rider,
    partner: (() => {
      const p = asRecord(record.partner);
      if (!Object.keys(p).length) return null;
      return {
        partnerId: pickString(p, ['partnerId', 'id']),
        name: pickString(p, ['name']),
        photo: pickString(p, ['photo', 'photoUrl', 'avatar']),
        vehicleType: pickString(p, ['vehicleType']),
        vehicleNumber: pickString(p, ['vehicleNumber']),
        rating: pickNumber(p, ['rating']),
        phoneMasked: pickString(p, ['phoneMasked', 'phone']),
      };
    })(),
    geofence: mapGeofence(record.geofence),
    provider: pickString(record, ['provider']),
    trafficFactor: pickNumber(record, ['trafficFactor']),
    durationInTraffic: pickBool(record, ['durationInTraffic']),
  };
}

function mapEta(raw: unknown): TrackingEta {
  const record = asRecord(unwrap(raw));
  return {
    orderId: pickString(record, ['orderId']) ?? '',
    etaSeconds: pickNumber(record, ['etaSeconds', 'eta']),
    etaAt: pickString(record, ['etaAt']),
    distanceMeters: pickNumber(record, ['distanceMeters', 'distance']),
    trafficFactor: pickNumber(record, ['trafficFactor']),
    destination: pickString(record, ['destination']),
    provider: pickString(record, ['provider']),
    durationInTraffic: pickBool(record, ['durationInTraffic']),
  };
}

function mapRoute(raw: unknown): TrackingRoute {
  const record = asRecord(unwrap(raw));
  const points = extractList(record.points)
    .map(mapLatLng)
    .filter((p): p is TrackingLatLng => Boolean(p));
  return {
    orderId: pickString(record, ['orderId']) ?? '',
    polyline: pickString(record, ['polyline']),
    points,
    distanceMeters: pickNumber(record, ['distanceMeters', 'distance']),
    etaSeconds: pickNumber(record, ['etaSeconds']),
    destination: mapLatLng(record.destination),
    trafficFactor: pickNumber(record, ['trafficFactor']),
    provider: pickString(record, ['provider']),
    durationInTraffic: pickBool(record, ['durationInTraffic']),
  };
}

export function toLocationPingBody(point: PartnerGpsCoords): Record<string, unknown> {
  const body: Record<string, unknown> = {
    latitude: point.latitude,
    longitude: point.longitude,
    isMock: false,
  };
  const heading = clampHeading(point.heading);
  if (heading != null) {
    body.heading = heading;
    body.bearing = heading;
  }
  const speed = mpsToKmh(point.speed);
  if (speed != null) body.speed = Number(speed.toFixed(1));
  if (point.accuracy != null && Number.isFinite(point.accuracy)) {
    body.accuracy = point.accuracy;
  }
  if (point.timestamp != null && Number.isFinite(point.timestamp)) {
    body.timestamp = new Date(point.timestamp).toISOString();
  } else {
    body.timestamp = new Date().toISOString();
  }
  return body;
}

export const partnerTrackingApi = {
  /** POST /partners/me/location — socket `partner:location` when live. */
  pushLocation: async (coords: PartnerGpsCoords): Promise<LocationPingResult> => {
    const body = toLocationPingBody(coords);
    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('partner:location', body, 8000);
        return mapLocationPing(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }
    const res = await request<unknown>(`${ME_BASE}/location`, {
      method: 'POST',
      body,
    });
    return mapLocationPing(res.data ?? res);
  },

  /** GET /partners/me/location/last */
  getLastLocation: async (): Promise<PartnerLiveLocation> => {
    const res = await request<unknown>(`${ME_BASE}/location/last`);
    const mapped = mapLiveLocation(res.data ?? res);
    if (!mapped) {
      throw new PartnerApiError(
        LOCATION_ERROR_COPY.LOCATION_NOT_FOUND,
        'LOCATION_NOT_FOUND'
      );
    }
    return mapped;
  },

  /** PUT /partners/me/home-location */
  saveHomeLocation: async (payload: {
    latitude: number;
    longitude: number;
    address?: string;
    zoneId?: string;
  }): Promise<PartnerHomeLocation> => {
    const body: Record<string, unknown> = {
      latitude: payload.latitude,
      longitude: payload.longitude,
    };
    if (payload.address?.trim()) {
      body.address = payload.address.trim().slice(0, 300);
    }
    if (payload.zoneId?.trim()) body.zoneId = payload.zoneId.trim();
    const res = await request<unknown>(`${ME_BASE}/home-location`, {
      method: 'PUT',
      body,
    });
    return mapHomeLocation(res.data ?? res);
  },

  /** GET /partners/me/nearby-orders-heatmap */
  getNearbyHeatmap: async (): Promise<NearbyDemandHeatmap> => {
    const res = await request<unknown>(`${ME_BASE}/nearby-orders-heatmap`);
    return mapHeatmap(res.data ?? res);
  },

  /** POST /tracking/gps-heartbeat */
  heartbeat: async (coords?: PartnerGpsCoords | null): Promise<GpsHeartbeatResult> => {
    const body =
      coords &&
      Number.isFinite(coords.latitude) &&
      Number.isFinite(coords.longitude)
        ? (() => {
            const next: Record<string, unknown> = {
              latitude: coords.latitude,
              longitude: coords.longitude,
            };
            const heading = clampHeading(coords.heading);
            if (heading != null) next.heading = heading;
            const speed = mpsToKmh(coords.speed);
            if (speed != null) next.speed = Number(speed.toFixed(1));
            if (coords.accuracy != null && Number.isFinite(coords.accuracy)) {
              next.accuracy = coords.accuracy;
            }
            return next;
          })()
        : {};
    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('partner:heartbeat', body, 8000);
        return mapHeartbeat(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }
    const res = await request<unknown>(`${TRACKING_BASE}/gps-heartbeat`, {
      method: 'POST',
      body,
    });
    return mapHeartbeat(res.data ?? res);
  },

  /** GET /tracking/location-history/:deliveryId */
  getLocationHistory: async (deliveryId: string): Promise<LocationHistory> => {
    const id = deliveryId.trim();
    if (!id) throw new PartnerApiError('Delivery id is required.');
    const res = await request<unknown>(`${TRACKING_BASE}/location-history/${id}`);
    return mapHistory(res.data ?? res);
  },

  /** GET /tracking/order/:orderId */
  getOrderTracking: async (orderId: string): Promise<OrderTracking> => {
    const id = orderId.trim();
    if (!id) throw new PartnerApiError('Order id is required.');
    const res = await request<unknown>(`${TRACKING_BASE}/order/${id}`);
    return mapOrderTracking(res.data ?? res);
  },

  /** GET /tracking/status/:deliveryId */
  getTrackingStatus: async (deliveryId: string): Promise<OrderTracking> => {
    const id = deliveryId.trim();
    if (!id) throw new PartnerApiError('Delivery id is required.');
    const res = await request<unknown>(`${TRACKING_BASE}/status/${id}`);
    return mapOrderTracking(res.data ?? res);
  },

  /** GET /tracking/live-location/:orderId */
  getLiveLocation: async (orderId: string): Promise<PartnerLiveLocation> => {
    const id = orderId.trim();
    if (!id) throw new PartnerApiError('Order id is required.');
    const res = await request<unknown>(`${TRACKING_BASE}/live-location/${id}`);
    const mapped = mapLiveLocation(res.data ?? res);
    if (!mapped) {
      throw new PartnerApiError(
        LOCATION_ERROR_COPY.LOCATION_NOT_FOUND,
        'LOCATION_NOT_FOUND'
      );
    }
    return mapped;
  },

  /** GET /tracking/eta/:orderId */
  getEta: async (orderId: string): Promise<TrackingEta> => {
    const id = orderId.trim();
    if (!id) throw new PartnerApiError('Order id is required.');
    const res = await request<unknown>(`${TRACKING_BASE}/eta/${id}`);
    return mapEta(res.data ?? res);
  },

  /** GET /tracking/route/:orderId */
  getRoute: async (orderId: string): Promise<TrackingRoute> => {
    const id = orderId.trim();
    if (!id) throw new PartnerApiError('Order id is required.');
    const res = await request<unknown>(`${TRACKING_BASE}/route/${id}`);
    return mapRoute(res.data ?? res);
  },
};
