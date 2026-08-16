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
  raw?: Record<string, unknown>;
};

export type DeliveryHistoryResult = {
  deliveries: PartnerDelivery[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
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
