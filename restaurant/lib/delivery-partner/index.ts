/**
 * Delivery partner domain — API, hooks, types, navigation.
 *
 * Folder map:
 *   api.ts          — HTTP client for /partners/*
 *   hooks.ts        — TanStack Query wrappers
 *   types.ts        — shared DTOs
 *   navigation.ts   — /delivery/* routes + tab config
 *   analytics-*     — performance / earnings / incentives
 *   restaurants-*   — partner restaurants
 *   support-*       — help / tickets (mock until API)
 *   tracking-*      — GPS ping, heartbeat, heatmap, trip map/ETA
 *   rider-gateway   — persistent Socket.IO (socket-token + /socket.io/)
 */

export * from '@/lib/delivery-partner/types';
export * from '@/lib/delivery-partner/navigation';
export * from '@/lib/delivery-partner/analytics-types';
export * from '@/lib/delivery-partner/restaurants-types';
export * from '@/lib/delivery-partner/support-types';
export * from '@/lib/delivery-partner/documents-types';
export * from '@/lib/delivery-partner/bank-types';
export {
  deliveryPartnerApi,
  formatDeliveryAddress,
  deliveryStatusLabel,
  normalizeDeliveryStatus,
  isAssignableStatus,
  nextDeliveryAction,
  resolveTripStep,
  mapPartnerBatch,
} from '@/lib/delivery-partner/api';
export {
  partnerAnalyticsApi,
  formatPercent,
  formatRating,
  formatHours,
  formatIncentiveAmount,
  formatCurrency,
  lastNDays,
} from '@/lib/delivery-partner/analytics-api';
export {
  partnerRestaurantsApi,
  USE_MOCK_PARTNER_RESTAURANTS,
  formatDistanceKm,
  formatRestaurantRating,
  formatLastOrder,
  isRestaurantActive,
} from '@/lib/delivery-partner/restaurants-api';
export {
  partnerSupportApi,
  USE_MOCK_PARTNER_SUPPORT,
} from '@/lib/delivery-partner/support-api';
export { partnerBankApi, formatBankError, shareTaxPdf } from '@/lib/delivery-partner/bank-api';
export * from '@/lib/delivery-partner/hooks';
export * from '@/lib/delivery-partner/bank-hooks';
export * from '@/lib/delivery-partner/analytics-hooks';
export * from '@/lib/delivery-partner/restaurants-hooks';
export * from '@/lib/delivery-partner/support-hooks';
export { partnerLocationTracker } from '@/lib/delivery-partner/location-tracker';
export {
  usePartnerLocationSync,
  useLocationSyncSnapshot,
} from '@/lib/delivery-partner/use-partner-location-sync';
export { partnerTrackingApi } from '@/lib/delivery-partner/tracking-api';
export * from '@/lib/delivery-partner/tracking-types';
export * from '@/lib/delivery-partner/tracking-hooks';
export {
  emitRiderEvent,
  emitRiderHeartbeat,
  emitRiderLocation,
  getRiderGatewayStatus,
  isRiderSocketConnected,
  startRiderGateway,
} from '@/lib/delivery-partner/rider-gateway';
export {
  REJECT_REASON_CODES,
  toRejectReasonCode,
} from '@/lib/delivery-partner/rider-gateway-types';
export {
  canFallbackToRest,
  formatTripError,
  socketErrorCopy,
} from '@/lib/delivery-partner/rider-ack';
export type {
  RiderGatewayEvent,
  RiderGatewayStatus,
  RejectReasonCode,
} from '@/lib/delivery-partner/rider-gateway-types';
export {
  useRiderGatewaySocket,
  useRiderGatewayStatus,
  useRiderOrderRoom,
} from '@/lib/delivery-partner/use-rider-gateway';
