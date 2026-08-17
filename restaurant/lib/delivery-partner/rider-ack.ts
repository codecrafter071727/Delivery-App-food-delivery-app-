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
    case 'GEOFENCE_NOT_MET':
    case 'OUTSIDE_GEOFENCE':
      return 'Move closer to the pin, then try again.';
    case 'LOCATION_REQUIRED':
      return 'Turn on live GPS, then try this step again.';
    case 'PICKUP_VERIFY_REQUIRED':
      return 'Verify pickup with OTP, a photo, or the item checklist first.';
    case 'SIGNATURE_REQUIRED':
      return 'Capture the customer signature, then complete delivery.';
    case 'UPLOAD_FAILED':
      return 'Could not upload the photo. Try again.';
    case 'INVALID_OTP':
      return 'That OTP is incorrect. Ask the customer to share it again.';
    case 'PROOF_REQUIRED':
      return 'Add the delivery OTP or a proof photo to complete.';
    case 'RTO_ATTEMPTS_MAX':
      return 'Contact attempts used up. Return the order or mark it failed.';
    case 'RTO_ATTEMPTS_REQUIRED':
      return 'Log two “customer not answering” attempts first.';
    case 'RTO_TIMER_REQUIRED':
      return 'Start the 5-minute wait after the second attempt.';
    case 'RTO_TIMER_ACTIVE':
      return 'Wait for the 5-minute timer to finish, then return the order.';
    case 'MASKED_CALL_UNAVAILABLE':
      return 'Masked calling is not set up. Use in-trip chat instead.';
    case 'MASKED_CALL_FAILED':
      return 'The call did not connect. Try again or send a chat.';
    case 'PHONE_UNAVAILABLE':
      return 'No phone on this order. Use chat.';
    case 'PARTNER_PHONE_MISSING':
      return 'Add your phone on Profile so masked calls can connect.';
    case 'CALL_RATE_LIMITED':
      return 'Too many calls this hour. Wait and try again, or use chat.';
    case 'CHAT_RATE_LIMITED':
      return 'Too many messages. Wait a moment.';
    case 'CHAT_CLOSED':
      return 'Chat is closed for this trip.';
    case 'COD_LIMIT_EXCEEDED':
      return 'COD limit reached. Remit cash before accepting more COD orders.';
    case 'BANK_NOT_VERIFIED':
      return 'Verify bank (penny-drop) before instant payout.';
    case 'BANK_DETAILS_REQUIRED':
      return 'Add a bank account in Profile before payouts.';
    case 'BELOW_MINIMUM':
      return 'Amount is below the minimum.';
    case 'INSUFFICIENT_BALANCE':
      return 'Not enough payable earnings for this payout.';
    case 'DAILY_CAP_REACHED':
      return 'Daily instant cap reached. Wait for weekly payout.';
    case 'DAILY_COUNT_REACHED':
      return 'Daily instant count reached. Try again tomorrow.';
    case 'FEE_EXCEEDS_AMOUNT':
      return 'Fee would wipe this payout. Request a larger amount.';
    case 'INSUFFICIENT_COD_CASH':
      return 'That remit is more than cash in hand.';
    case 'NO_COD_DUE':
      return 'No COD cash to remit.';
    case 'NOT_COD':
      return 'This order is prepaid — no doorstep collection.';
    case 'ALREADY_COLLECTED_CASH':
      return 'Cash was already recorded for this trip.';
    case 'COD_ALREADY_SETTLED':
      return 'This COD is already marked paid via UPI.';
    case 'UPI_QR_UNAVAILABLE':
      return 'Platform UPI QR is unavailable. Collect cash or retry.';
    case 'PAYOUT_NOT_FOUND':
      return 'That payout is no longer available.';
    case 'IDEMPOTENCY_CONFLICT':
      return 'This request key was used on another account. Retry.';
    case 'DELIVERY_CAPACITY_FULL':
      return 'You already have a full batch. Finish a trip first.';
    case 'ILLEGAL_TRANSITION':
      return 'This step is not available for the current trip status.';
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
    case 'INCENTIVE_NOT_FOUND':
      return 'This incentive is no longer available.';
    case 'INCENTIVE_NOT_OPEN':
      return 'This program is paused or has ended.';
    case 'OPT_IN_NOT_REQUIRED':
      return 'You are already enrolled in this program.';
    case 'INCENTIVE_NOT_ELIGIBLE':
      return 'You are not eligible for this bonus right now.';
    case 'REWARD_NOT_FOUND':
      return 'That reward is no longer in the catalog.';
    case 'INSUFFICIENT_POINTS':
      return 'Not enough reward points to redeem this.';
    case 'OUT_OF_STOCK':
      return 'This reward is out of stock. Try another one.';
    case 'NO_ZONE':
      return 'Set your delivery zone on Home to see the leaderboard.';
    case 'ZONE_NOT_FOUND':
      return 'Your zone is missing. Update location on Home and retry.';
    case 'WARNING_NOT_FOUND':
      return 'This warning is no longer available.';
    case 'WARNING_NOT_OPEN':
      return 'This warning is already acknowledged or expired.';
    case 'FORBIDDEN':
      return 'You cannot acknowledge this warning.';
    default:
      return undefined;
  }
}

export function formatTripError(error: unknown, fallback: string): string {
  const code = getApiErrorCode(error);
  return socketErrorCopy(code) || getApiErrorMessage(error, fallback);
}
