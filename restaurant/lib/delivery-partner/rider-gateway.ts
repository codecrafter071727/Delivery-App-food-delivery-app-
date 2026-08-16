import { AppState } from 'react-native';
import type { Socket } from 'socket.io-client';

import {
  connectGatewaySocket,
  waitForSocketConnect,
} from '@/lib/gateway/connect';
import type {
  RiderGatewayEvent,
  RiderGatewayStatus,
  RiderLocationEmit,
} from '@/lib/delivery-partner/rider-gateway-types';

const INBOUND: RiderGatewayEvent[] = [
  'delivery:new',
  'delivery:assigned',
  'delivery:assignment-expiring',
  'delivery:cancelled',
  'delivery:updated',
  'delivery:status',
  'notification:new',
  'earnings:updated',
  'wallet:credited',
  'chat:new-message',
  'typing',
  'partner:location',
  'tracking:location',
  'tracking:eta',
];

type RiderListener = (event: RiderGatewayEvent, payload: unknown) => void;
type StatusListener = (status: RiderGatewayStatus) => void;

let socket: Socket | null = null;
let wanted = false;
let startGeneration = 0;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let status: RiderGatewayStatus = 'idle';
const trackedOrders = new Set<string>();
const listeners = new Set<RiderListener>();
const statusListeners = new Set<StatusListener>();
let appSub: { remove: () => void } | null = null;

function setStatus(next: RiderGatewayStatus) {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener(next);
}

function clearTimers() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function emitLocal(event: RiderGatewayEvent, payload: unknown) {
  for (const listener of listeners) {
    listener(event, payload);
  }
}

function rejoinRooms() {
  if (!socket?.connected) return;
  for (const orderId of trackedOrders) {
    socket.emit('track:order', orderId);
  }
}

function bindSocket(next: Socket) {
  next.on('connect', () => {
    setStatus('connected');
    rejoinRooms();
  });

  next.on('disconnect', (reason: string) => {
    if (!wanted) {
      setStatus('idle');
      return;
    }
    setStatus('connecting');
    if (reason === 'io server disconnect') {
      scheduleRestart(1500);
    }
  });

  for (const event of INBOUND) {
    next.on(event, (payload: unknown) => {
      emitLocal(event, payload);
    });
  }

  next.on('connect_error', (err: { message?: string }) => {
    if (!wanted) return;
    setStatus('connecting');
    const unauthorized = String(err?.message ?? '')
      .toUpperCase()
      .includes('UNAUTHORIZED');
    if (unauthorized) scheduleRestart(2000);
  });
}

function scheduleRestart(delayMs: number) {
  if (!wanted || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void restart();
  }, delayMs);
}

async function start(generation: number) {
  if (!wanted) return;
  setStatus('connecting');
  try {
    const connected = await connectGatewaySocket();
    if (generation !== startGeneration || !wanted) {
      connected.socket.disconnect();
      return;
    }

    try {
      await waitForSocketConnect(connected.socket);
    } catch {
      connected.socket.disconnect();
      if (generation !== startGeneration || !wanted) return;
      setStatus('offline');
      scheduleRestart(4000);
      return;
    }

    if (generation !== startGeneration || !wanted) {
      connected.socket.disconnect();
      return;
    }

    socket = connected.socket;
    bindSocket(socket);
    setStatus(socket.connected ? 'connected' : 'connecting');
    rejoinRooms();

    const refreshMs = Math.max(30_000, (connected.expiresIn - 120) * 1000);
    refreshTimer = setTimeout(() => {
      void restart();
    }, refreshMs);
  } catch {
    if (generation !== startGeneration || !wanted) return;
    setStatus('offline');
    scheduleRestart(5000);
  }
}

function stopSocket() {
  clearTimers();
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

async function restart() {
  stopSocket();
  if (!wanted) {
    setStatus('idle');
    return;
  }
  const generation = ++startGeneration;
  await start(generation);
}

function ensureAppFocus() {
  if (appSub) return;
  appSub = AppState.addEventListener('change', (state) => {
    if (state !== 'active' || !wanted) return;
    if (socket?.connected) {
      rejoinRooms();
      setStatus('connected');
      return;
    }
    void restart();
  });
}

export function subscribeRiderGateway(listener: RiderListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeRiderGatewayStatus(listener: StatusListener) {
  statusListeners.add(listener);
  listener(status);
  return () => {
    statusListeners.delete(listener);
  };
}

export function getRiderGatewayStatus(): RiderGatewayStatus {
  if (socket?.connected) return 'connected';
  return status;
}

export function isRiderSocketConnected() {
  return Boolean(socket?.connected);
}

export function startRiderGateway(enabled: boolean) {
  ensureAppFocus();
  if (!enabled) {
    wanted = false;
    stopSocket();
    setStatus('idle');
    return;
  }
  if (wanted && (socket?.connected || status === 'connecting')) {
    return;
  }
  wanted = true;
  void restart();
}

export function trackRiderOrder(orderId: string | undefined) {
  const id = orderId?.trim();
  if (!id) return;
  trackedOrders.add(id);
  if (socket?.connected) socket.emit('track:order', id);
}

export function untrackRiderOrder(orderId: string | undefined) {
  const id = orderId?.trim();
  if (!id) return;
  trackedOrders.delete(id);
}

function toLocationPayload(coords: RiderLocationEmit) {
  return {
    lat: coords.latitude,
    lng: coords.longitude,
    latitude: coords.latitude,
    longitude: coords.longitude,
    heading: coords.heading ?? undefined,
    speed: coords.speed ?? undefined,
    accuracy: coords.accuracy ?? undefined,
  };
}

/** Same job as POST /partners/me/location — live GPS stream. */
export function emitRiderLocation(coords: RiderLocationEmit | null | undefined) {
  if (!socket?.connected || !coords) return;
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
    return;
  }
  socket.emit('partner:location', toLocationPayload(coords));
}

/** Keep GPS/duty alive while online. REST heartbeat remains the fallback. */
export function emitRiderHeartbeat(coords?: RiderLocationEmit | null) {
  if (!socket?.connected) return;
  if (
    coords &&
    Number.isFinite(coords.latitude) &&
    Number.isFinite(coords.longitude)
  ) {
    socket.emit('partner:heartbeat', toLocationPayload(coords));
    return;
  }
  socket.emit('partner:heartbeat', {});
}
