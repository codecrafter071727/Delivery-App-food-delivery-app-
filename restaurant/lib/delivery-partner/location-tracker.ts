import * as Location from 'expo-location';
import { AppState, type AppStateStatus } from 'react-native';

import { partnerTrackingApi } from '@/lib/delivery-partner/tracking-api';
import {
  IDLE_HEARTBEAT_MS,
  IDLE_PING_MS,
  LOW_ACCURACY_METERS,
  TRIP_HEARTBEAT_MS,
  TRIP_PING_MS,
  type GpsHeartbeatResult,
  type LocationPingResult,
} from '@/lib/delivery-partner/tracking-types';
import type { PartnerGpsCoords } from '@/lib/delivery-partner/types';
import { getApiErrorCode } from '@/lib/errors';
import {
  isGloballyBackingOff,
  isRateLimitedError,
  noteRateLimited,
} from '@/lib/live-query';

const WATCH_TIME_INTERVAL_MS = 2_000;
const DISTANCE_INTERVAL_M = 8;

export type LocationSyncSnapshot = {
  coords: PartnerGpsCoords | null;
  onDelivery: boolean;
  activeDeliveryId: string | null;
  nextPingAfterMs: number;
  nextHeartbeatMs: number;
  lowAccuracy: boolean;
  stale: boolean;
  mockBlocked: boolean;
  offlineBlocked: boolean;
  locationRequired: boolean;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  recordedAt?: string;
};

function isValidCoords(coords: PartnerGpsCoords) {
  const { latitude, longitude } = coords;
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0)
  );
}

function fromExpoPosition(pos: Location.LocationObject): PartnerGpsCoords {
  const mocked = Boolean(
    (pos as { mocked?: boolean }).mocked ??
      (pos.coords as { mocked?: boolean }).mocked
  );
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? undefined,
    speed: pos.coords.speed,
    heading: pos.coords.heading,
    altitude: pos.coords.altitude,
    timestamp: pos.timestamp,
    mocked,
  };
}

function defaultSnapshot(): LocationSyncSnapshot {
  return {
    coords: null,
    onDelivery: false,
    activeDeliveryId: null,
    nextPingAfterMs: IDLE_PING_MS,
    nextHeartbeatMs: IDLE_HEARTBEAT_MS,
    lowAccuracy: false,
    stale: false,
    mockBlocked: false,
    offlineBlocked: false,
    locationRequired: false,
  };
}

/**
 * Online rider GPS: watch locally, ping + heartbeat on server intervals.
 * POST /partners/me/location  +  POST /tracking/gps-heartbeat
 */
class PartnerLocationTracker {
  private watchSub: Location.LocationSubscription | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSub: { remove: () => void } | null = null;
  private running = false;
  private starting: Promise<void> | null = null;
  private pingInFlight = false;
  private heartbeatInFlight = false;
  private latest: PartnerGpsCoords | null = null;
  private snapshot: LocationSyncSnapshot = defaultSnapshot();
  private coordListeners = new Set<(coords: PartnerGpsCoords | null) => void>();
  private snapshotListeners = new Set<(snap: LocationSyncSnapshot) => void>();

  isRunning() {
    return this.running;
  }

  getLastKnown(): PartnerGpsCoords | null {
    return this.latest ?? this.snapshot.coords;
  }

  getSnapshot(): LocationSyncSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (coords: PartnerGpsCoords | null) => void) {
    this.coordListeners.add(listener);
    listener(this.getLastKnown());
    return () => {
      this.coordListeners.delete(listener);
    };
  }

  subscribeSnapshot(listener: (snap: LocationSyncSnapshot) => void) {
    this.snapshotListeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  private emitCoords() {
    const point = this.getLastKnown();
    for (const listener of this.coordListeners) {
      try {
        listener(point);
      } catch {
        // ignore
      }
    }
  }

  private emitSnapshot() {
    for (const listener of this.snapshotListeners) {
      try {
        listener(this.snapshot);
      } catch {
        // ignore
      }
    }
  }

  private patchSnapshot(partial: Partial<LocationSyncSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      coords: partial.coords ?? this.latest ?? this.snapshot.coords,
    };
    this.emitSnapshot();
  }

  async start() {
    if (this.running) return;
    if (this.starting) return this.starting;

    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart() {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      throw new Error(
        'Location permission is required while you are online. Enable it in Settings.'
      );
    }

    const enabled = await Location.hasServicesEnabledAsync();
    if (!enabled) {
      throw new Error('Turn on GPS / location services to stay online.');
    }

    this.running = true;
    this.snapshot = {
      ...defaultSnapshot(),
      coords: this.latest,
    };

    try {
      const last = await partnerTrackingApi.getLastLocation();
      this.patchSnapshot({
        coords: {
          latitude: last.latitude,
          longitude: last.longitude,
          heading: last.heading,
          speed: last.speed,
          accuracy: last.accuracy ?? undefined,
        },
        stale: Boolean(last.stale),
        lowAccuracy: Boolean(last.lowAccuracy),
        recordedAt: last.updatedAt,
        locationRequired: false,
      });
      if (!this.latest) {
        this.latest = this.snapshot.coords;
        this.emitCoords();
      }
    } catch (error) {
      const code = getApiErrorCode(error);
      if (code === 'LOCATION_NOT_FOUND' || code === 'LOCATION_REQUIRED') {
        this.patchSnapshot({ locationRequired: true });
      }
    }

    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      this.latest = fromExpoPosition(pos);
      this.emitCoords();
      await this.pingNow();
      await this.heartbeatNow();
    } catch {
      this.schedulePing(1_000);
      this.scheduleHeartbeat(1_000);
    }

    this.watchSub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: WATCH_TIME_INTERVAL_MS,
        distanceInterval: DISTANCE_INTERVAL_M,
        mayShowUserSettingsDialog: true,
      },
      (pos) => {
        this.latest = fromExpoPosition(pos);
        this.patchSnapshot({
          coords: this.latest,
          lowAccuracy:
            this.snapshot.lowAccuracy ||
            (this.latest.accuracy != null &&
              this.latest.accuracy > LOW_ACCURACY_METERS),
        });
        this.emitCoords();
      }
    );

    this.appStateSub = AppState.addEventListener('change', this.onAppStateChange);
  }

  async stop() {
    this.running = false;
    this.watchSub?.remove();
    this.watchSub = null;
    if (this.pingTimer) {
      clearTimeout(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.snapshot = defaultSnapshot();
    this.emitSnapshot();
  }

  private onAppStateChange = (state: AppStateStatus) => {
    if (!this.running) return;
    if (state === 'active') {
      void this.refreshDeviceGps();
      void this.pingNow();
      void this.heartbeatNow();
    }
  };

  private async refreshDeviceGps() {
    try {
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      this.latest = fromExpoPosition(pos);
      this.emitCoords();
    } catch {
      // keep last known
    }
  }

  private schedulePing(ms: number) {
    if (this.pingTimer) clearTimeout(this.pingTimer);
    if (!this.running) return;
    const wait = Math.max(1_000, ms);
    this.pingTimer = setTimeout(() => {
      void this.pingNow();
    }, wait);
  }

  private scheduleHeartbeat(ms: number) {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (!this.running) return;
    const wait = Math.max(1_000, ms);
    this.heartbeatTimer = setTimeout(() => {
      void this.heartbeatNow();
    }, wait);
  }

  private applyError(error: unknown) {
    const code = getApiErrorCode(error);
    const message =
      error instanceof Error ? error.message : 'Location sync failed';
    this.patchSnapshot({
      lastErrorCode: code,
      lastErrorMessage: message,
      mockBlocked: code === 'MOCK_LOCATION',
      offlineBlocked: code === 'PARTNER_OFFLINE',
      locationRequired:
        code === 'LOCATION_REQUIRED' || code === 'LOCATION_NOT_FOUND',
    });
    if (isRateLimitedError(error)) {
      noteRateLimited(error);
    }
  }

  private applyPing(result: LocationPingResult) {
    const onDelivery = Boolean(result.activeDeliveryId);
    const loc = result.location;
    const accuracy =
      loc?.accuracy ?? this.latest?.accuracy ?? null;
    this.patchSnapshot({
      onDelivery,
      activeDeliveryId: result.activeDeliveryId ?? null,
      nextPingAfterMs: result.nextPingAfterMs || (onDelivery ? TRIP_PING_MS : IDLE_PING_MS),
      lowAccuracy:
        result.lowAccuracy ||
        Boolean(loc?.lowAccuracy) ||
        (accuracy != null && accuracy > LOW_ACCURACY_METERS),
      stale: Boolean(loc?.stale),
      recordedAt: result.recordedAt ?? loc?.updatedAt,
      mockBlocked: false,
      offlineBlocked: false,
      locationRequired: false,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
      coords: loc
        ? {
            latitude: loc.latitude,
            longitude: loc.longitude,
            heading: loc.heading,
            speed: loc.speed,
            accuracy: loc.accuracy ?? undefined,
          }
        : this.latest,
    });
  }

  private applyHeartbeat(result: GpsHeartbeatResult) {
    const onDelivery =
      result.onDelivery || Boolean(result.activeDeliveryId);
    this.patchSnapshot({
      onDelivery,
      activeDeliveryId:
        result.activeDeliveryId ?? this.snapshot.activeDeliveryId,
      nextHeartbeatMs:
        result.nextHeartbeatMs ||
        (onDelivery ? TRIP_HEARTBEAT_MS : IDLE_HEARTBEAT_MS),
      stale: Boolean(result.location?.stale) || this.snapshot.stale,
      lowAccuracy:
        Boolean(result.location?.lowAccuracy) || this.snapshot.lowAccuracy,
      mockBlocked: false,
      offlineBlocked: false,
      lastErrorCode: undefined,
      lastErrorMessage: undefined,
    });
  }

  private async pingNow() {
    if (!this.running || this.pingInFlight) return;
    if (isGloballyBackingOff()) {
      this.schedulePing(this.snapshot.nextPingAfterMs || IDLE_PING_MS);
      return;
    }

    await this.refreshDeviceGps();
    const coords = this.latest;
    if (!coords || !isValidCoords(coords)) {
      this.schedulePing(this.snapshot.nextPingAfterMs || IDLE_PING_MS);
      return;
    }

    this.pingInFlight = true;
    try {
      const result = await partnerTrackingApi.pushLocation(coords);
      this.applyPing(result);
      this.schedulePing(result.nextPingAfterMs || IDLE_PING_MS);
    } catch (error) {
      this.applyError(error);
      const fallback = this.snapshot.onDelivery ? TRIP_PING_MS : IDLE_PING_MS;
      this.schedulePing(fallback);
    } finally {
      this.pingInFlight = false;
    }
  }

  private async heartbeatNow() {
    if (!this.running || this.heartbeatInFlight) return;
    if (isGloballyBackingOff()) {
      this.scheduleHeartbeat(this.snapshot.nextHeartbeatMs || IDLE_HEARTBEAT_MS);
      return;
    }

    this.heartbeatInFlight = true;
    const heartbeatCoords =
      this.latest && isValidCoords(this.latest) ? this.latest : null;
    try {
      const result = await partnerTrackingApi.heartbeat(heartbeatCoords);
      this.applyHeartbeat(result);
      this.scheduleHeartbeat(result.nextHeartbeatMs || IDLE_HEARTBEAT_MS);
    } catch (error) {
      this.applyError(error);
      const fallback = this.snapshot.onDelivery
        ? TRIP_HEARTBEAT_MS
        : IDLE_HEARTBEAT_MS;
      this.scheduleHeartbeat(fallback);
    } finally {
      this.heartbeatInFlight = false;
    }
  }
}

export const partnerLocationTracker = new PartnerLocationTracker();
