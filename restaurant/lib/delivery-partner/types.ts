/**
 * Delivery partner self-service — profile + deliveries.
 * Gateway: /api/v1/delivery-service
 */

import type { PartnerDutyStatus } from '@/lib/delivery-partner/availability-types';
import type {
  PartnerDocumentType,
  PartnerDocumentsMap,
} from '@/lib/delivery-partner/documents-types';

export type {
  PartnerDocument,
  PartnerDocumentStatus,
  PartnerDocumentType,
  PartnerDocumentsMap,
} from '@/lib/delivery-partner/documents-types';

export {
  PARTNER_DOC_TYPES,
  countVerifiedDocuments,
  normalizeDocStatus,
  normalizeDocType,
} from '@/lib/delivery-partner/documents-types';

export type VehicleType =
  | 'motorcycle'
  | 'scooter'
  | 'electric_scooter'
  | 'bicycle'
  | 'car';

export const VEHICLE_TYPE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: 'motorcycle', label: 'Motorcycle / Bike' },
  { value: 'scooter', label: 'Scooter' },
  { value: 'electric_scooter', label: 'Electric Scooter' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'car', label: 'Car' },
];

export type DeliveryPartnerRegisterPayload = {
  firstName: string;
  lastName?: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  vehicleType: VehicleType;
  vehicleNumber?: string;
  aadharNumber?: string;
  acceptedTerms: boolean;
  inviteToken?: string;
};

/** GET /partners/invite/validate */
export type PartnerInviteValidation = {
  valid: boolean;
  token: string;
  restaurantId?: string;
  restaurantName?: string;
  inviteEmail?: string;
  invitePhone?: string;
  status?: string;
  expiresAt?: string;
  message?: string;
  raw?: Record<string, unknown>;
};

export type PartnerVehicleDetails = {
  type?: string;
  number?: string;
  model?: string;
  color?: string;
};

export type PartnerPayoutDetails = {
  bankAccountNo?: string;
  ifscCode?: string;
  upiId?: string;
  accountHolderName?: string;
  bankName?: string;
};

export type PartnerProfileStats = {
  totalDeliveries?: number;
  avgRating?: number;
  completionRate?: number;
  acceptanceRate?: number;
};

export type DeliveryPartnerProfile = {
  id: string;
  userId?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dateOfBirth?: string;
  photoUrl?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  vehicle?: PartnerVehicleDetails;
  payout?: PartnerPayoutDetails;
  stats?: PartnerProfileStats;
  status?: string;
  dutyStatus?: PartnerDutyStatus;
  isOnline?: boolean;
  isAvailable?: boolean;
  zoneId?: string;
  onlineSince?: string;
  /** KYC docs from GET /partners/me — keyed by docType */
  documents?: PartnerDocumentsMap;
};

export type UpdatePartnerProfilePayload = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  vehicleType?: string;
  vehicleNumber?: string;
  vehicleModel?: string;
  vehicleColor?: string;
  bankAccountNo?: string;
  ifscCode?: string;
  upiId?: string;
};

export type UploadPartnerDocumentPayload = {
  docType: PartnerDocumentType;
  uri: string;
  fileName?: string;
  mimeType?: string;
};

/** Lifecycle status for a partner delivery assignment. */
export type PartnerDeliveryStatus =
  | 'assigned'
  | 'accepted'
  | 'rejected'
  | 'arrived'
  | 'picked_up'
  | 'out_for_delivery'
  | 'at_customer'
  | 'delivered'
  | 'cancelled'
  | string;

export type PartnerDeliveryAddress = {
  label?: string;
  line1?: string;
  line2?: string;
  city?: string;
  pincode?: string;
  lat?: number;
  lng?: number;
};

/** Optional live customer GPS if the backend streams it on the assignment. */
export type PartnerLivePoint = {
  lat: number;
  lng: number;
  updatedAt?: string;
  accuracy?: number;
};

export type PartnerDelivery = {
  id: string;
  orderId?: string;
  orderNumber?: string;
  restaurantId?: string;
  status: PartnerDeliveryStatus;
  restaurantName?: string;
  restaurantPhone?: string;
  restaurantAddress?: PartnerDeliveryAddress;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: PartnerDeliveryAddress;
  /** Live customer GPS when API provides it; falls back to deliveryAddress coords. */
  customerLiveLocation?: PartnerLivePoint;
  itemsSummary?: string;
  itemCount?: number;
  amount?: number;
  currency?: string;
  paymentMethod?: string;
  settledVia?: string | null;
  cashCollected?: boolean;
  distanceKm?: number;
  etaMinutes?: number;
  earning?: number;
  notes?: string;
  assignedAt?: string;
  acceptedAt?: string;
  arrivedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  createdAt?: string;
  updatedAt?: string;
  batchId?: string;
  nextAction?: string;
  canReject?: boolean;
  canCancel?: boolean;
  canReportIssue?: boolean;
  waitStartedAt?: string;
  waitEndedAt?: string;
  waitMinutes?: number;
  orderNotReadyCount?: number;
  kitchenReadyAt?: string;
  pickupVerified?: boolean;
  otpVerified?: boolean;
  signatureUrl?: string;
  signatureCapturedAt?: string;
  proofPhotoUrl?: string;
  contactAttemptCount?: number;
  rtoTimerEndsAt?: string;
  rtoRemainingSeconds?: number;
  canReturnToRestaurant?: boolean;
  canFail?: boolean;
  failedAt?: string;
  failReasonCode?: string;
  failReason?: string;
  offerExpiresAt?: string;
  timeoutSeconds?: number;
  raw?: Record<string, unknown>;
};

export type DeliveryHistoryResult = {
  deliveries: PartnerDelivery[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
};

export type DeliveryTimelineStep = {
  key: string;
  label: string;
  at?: string | null;
  completed: boolean;
};

export type DeliveryTimeline = {
  deliveryId: string;
  orderId?: string;
  status?: string;
  waitMinutes?: number | null;
  steps: DeliveryTimelineStep[];
};

export type DeliveryEventKind = 'timeline' | 'issue' | 'contact' | 'dispatch';

export type DeliveryEvent = {
  kind: DeliveryEventKind;
  key: string;
  label: string;
  at?: string | null;
  actor?: string | null;
  detail?: string | null;
};

export type DeliveryEventsResult = {
  deliveryId?: string;
  count: number;
  events: DeliveryEvent[];
};

export type PartnerBatchStop = {
  seq: number;
  deliveryId: string;
  orderId?: string;
  restaurantId?: string;
  leg: 'pickup' | 'drop';
  label: string;
  latitude?: number;
  longitude?: number;
  address?: string | null;
  metersFromPrev?: number;
};

export type PartnerBatchMember = {
  deliveryId: string;
  orderId?: string;
  restaurantId?: string;
  restaurantName?: string;
  status: string;
  deliveryFee?: number;
  partnerEarnings?: number;
  deliveryAddress?: string;
};

export type PartnerBatch = {
  batchId: string;
  status: string;
  partnerId?: string;
  deliveryIds: string[];
  deliveries: PartnerBatchMember[];
  sequence: PartnerBatchStop[];
  sequenceConfirmed: boolean;
  sequenceConfirmedAt?: string | null;
  suggested?: boolean;
  estimatedDistanceKm?: number;
  estimatedMinutes?: number;
  offeredAt?: string;
  acceptedAt?: string | null;
  offerExpiresAt?: string;
  timeoutSeconds?: number;
  canAccept: boolean;
  canConfirmSequence: boolean;
  nextAction?: string;
};

export type ConfirmBatchSequencePayload =
  | { confirm: boolean }
  | { stops: { deliveryId: string; leg: 'pickup' | 'drop' }[] };

export const CANCEL_REASON_CODES = [
  { code: 'vehicle_breakdown', label: 'Vehicle breakdown' },
  { code: 'personal_emergency', label: 'Personal emergency' },
  { code: 'restaurant_closed', label: 'Restaurant closed' },
  { code: 'order_wrong', label: 'Wrong / incomplete order' },
  { code: 'customer_cancelled', label: 'Customer cancelled' },
  { code: 'unsafe', label: 'Felt unsafe' },
  { code: 'other', label: 'Other' },
] as const;

export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number]['code'];

export const TRIP_ISSUE_CODES = [
  { code: 'wrong_address', label: 'Wrong address' },
  { code: 'customer_unreachable', label: 'Customer unreachable' },
  { code: 'item_damaged', label: 'Item damaged' },
  { code: 'item_missing', label: 'Item missing' },
  { code: 'customer_refused', label: 'Customer refused' },
  { code: 'payment_issue', label: 'Payment issue' },
  { code: 'other', label: 'Other' },
] as const;

export type TripIssueCode = (typeof TRIP_ISSUE_CODES)[number]['code'];

export type PickupVerifyPayload = {
  otp?: string;
  photoUrl?: string;
  itemChecklistOk?: boolean;
};

export type CancelDeliveryPayload = {
  reasonCode: CancelReasonCode;
  reason?: string;
};

export type ReportIssuePayload = {
  issueCode: TripIssueCode;
  note?: string;
};

export type UnreachableChannel = 'call' | 'chat';

export type CustomerUnreachablePayload = {
  channel?: UnreachableChannel;
  note?: string;
};

export const RETURN_REASON_CODES = [
  { code: 'customer_unreachable', label: 'No one at the drop' },
  { code: 'customer_refused', label: 'Customer refused' },
  { code: 'wrong_address', label: 'Wrong address' },
  { code: 'item_damaged', label: 'Item damaged' },
  { code: 'payment_issue', label: 'Payment issue' },
  { code: 'other', label: 'Other' },
] as const;

export type ReturnReasonCode = (typeof RETURN_REASON_CODES)[number]['code'];

export type ReturnToRestaurantPayload = {
  reasonCode: ReturnReasonCode;
  reason?: string;
};

export const FAIL_REASON_CODES = [
  { code: 'customer_unreachable', label: 'No one at the drop' },
  { code: 'customer_refused', label: 'Customer refused' },
  { code: 'wrong_address', label: 'Wrong address' },
  { code: 'item_damaged', label: 'Item damaged' },
  { code: 'payment_issue', label: 'Payment issue' },
  { code: 'restaurant_closed', label: 'Restaurant closed on return' },
  { code: 'unsafe', label: 'Felt unsafe' },
  { code: 'other', label: 'Other' },
] as const;

export type FailReasonCode = (typeof FAIL_REASON_CODES)[number]['code'];

export type FailDeliveryPayload = {
  reasonCode: FailReasonCode;
  reason?: string;
};

export type DeliveryChatTo = 'customer' | 'restaurant';

export type DeliveryChatMessage = {
  id: string;
  deliveryId: string;
  orderId?: string;
  senderRole?: string;
  senderUserId?: string;
  to?: string;
  text: string;
  createdAt: string;
};

export type DeliveryChatThread = {
  deliveryId: string;
  orderId?: string;
  status?: string;
  count: number;
  closed?: boolean;
  messages: DeliveryChatMessage[];
};

export type MaskedCallResult = {
  callId: string;
  deliveryId: string;
  orderId?: string;
  target: string;
  status?: string;
  toMasked?: string;
  virtualNumberMasked?: string;
  provider?: string;
  createdAt?: string;
};

export type TripNavStep = {
  instruction: string;
  distanceMeters?: number;
  durationSeconds?: number;
  maneuver?: string;
};

export type TripNavRoute = {
  deliveryId: string;
  orderId?: string;
  status?: string;
  leg: 'pickup' | 'drop' | 'return' | string;
  destination?: { latitude: number; longitude: number; kind?: string };
  origin?: { latitude: number; longitude: number };
  polyline?: string;
  points: { latitude: number; longitude: number }[];
  steps: TripNavStep[];
  nextInstruction?: string;
  distanceMeters?: number | null;
  etaSeconds?: number | null;
  etaAt?: string;
  provider?: string;
  durationInTraffic?: boolean;
  trafficFactor?: number;
};

export type VerifyDropOtpPayload = {
  otp: string;
};

export type RejectDeliveryPayload = {
  reason: string;
  reasonCode?: string;
};

export type DeliverOrderPayload = {
  /** OTP / confirmation code from customer when required */
  otp?: string;
  notes?: string;
  /** Local image URI for delivery proof photo */
  proofUri?: string;
  proofFileName?: string;
  proofMimeType?: string;
  proofUrl?: string;
  signatureUrl?: string;
};

/** GPS payload for POST /partners/me/location */
export type PartnerGpsCoords = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  /** Device speed in m/s (converted to km/h on the wire). */
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  timestamp?: number;
  /** Device mock flag — never sent as isMock: true. */
  mocked?: boolean;
};
