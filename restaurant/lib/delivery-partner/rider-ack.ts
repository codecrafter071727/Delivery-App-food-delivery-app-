import { PartnerApiError, getApiErrorCode, getApiErrorMessage } from '@/lib/errors';

const FALLBACK_CODES = new Set([
  'SOCKET_OFFLINE',
  'SOCKET_TIMEOUT',
  'DUTY_UNAVAILABLE',
  'UNKNOWN_SOCKET_EVENT',
]);

export type RiderSocketAck = {
  ok?: boolean;
  success?: boolean;
  code?: string;
  message?: string;
  data?: unknown;
};

export function canFallbackToRest(error: unknown): boolean {
  const code = getApiErrorCode(error);
  if (code && FALLBACK_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return (
    message.includes('live connection') ||
    message.includes('timed out') ||
    message.includes('not connected')
  );
}

export function ackToError(ack: RiderSocketAck | undefined): PartnerApiError {
  const code = ack?.code?.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const message =
    ack?.message?.trim() ||
    socketErrorCopy(code) ||
    'Action failed. Please try again.';
  return new PartnerApiError(message, code);
}

export function socketErrorCopy(code?: string): string | undefined {
  switch (code) {
    case 'OFFER_EXPIRED':
      return 'This order timed out. Wait for the next one.';
    case 'OFFER_TAKEN':
      return 'Another rider took this order.';
    case 'PARTNER_NOT_ACTIVE':
      return 'Your account is still under review. You can go online after KYC is approved.';
    case 'PARTNER_SUSPENDED':
      return 'Your account is suspended. Contact support.';
    case 'ACTIVE_DELIVERY':
      return 'Finish your current trip before going offline.';
    case 'PARTNER_OFFLINE':
      return 'Go online to start receiving orders.';
    case 'OUTSIDE_GEOFENCE':
      return 'Move closer to the pin, then try again.';
    case 'INVALID_OTP':
      return 'That OTP is incorrect. Ask the customer to share it again.';
    case 'PROOF_REQUIRED':
      return 'Add the delivery OTP or a proof photo to complete.';
    case 'COD_LIMIT_EXCEEDED':
      return 'COD limit reached. Remit cash before accepting more COD orders.';
    case 'DELIVERY_CAPACITY_FULL':
      return 'You already have a full batch. Finish a trip first.';
    case 'ILLEGAL_TRANSITION':
      return 'This step is not available for the current trip status.';
    case 'CHAT_RATE_LIMITED':
      return 'Too many messages. Wait a moment.';
    case 'CHAT_CLOSED':
      return 'Chat is closed for this trip.';
    case 'DELIVERY_NOT_FOUND':
      return 'This trip is no longer available.';
    case 'BATCH_EXPIRED':
      return 'This stacked order timed out.';
    case 'BATCH_INCOMPLETE':
      return 'One order in the stack was reassigned. Wait for the next offer.';
    case 'BATCH_NOT_ACCEPTED':
      return 'Accept the stacked orders first, then confirm the route.';
    case 'SEQUENCE_INVALID':
      return 'Pickup must come before drop for every order in the stack.';
    case 'BATCH_NOT_FOUND':
      return 'This stacked assignment is no longer available.';
    case 'INVALID_STATUS':
      return 'That history filter is not valid. Try All, Delivered, or Cancelled.';
    case 'VALIDATION_ERROR':
      return 'Please check the details and try again.';
    default:
      return undefined;
  }
}

export function formatTripError(error: unknown, fallback: string): string {
  const code = getApiErrorCode(error);
  return socketErrorCopy(code) || getApiErrorMessage(error, fallback);
}
