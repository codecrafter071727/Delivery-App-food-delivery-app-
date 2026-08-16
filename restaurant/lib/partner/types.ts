/**
 * Restaurant-service self-fleet (docs §3.6).
 * Gateway: /api/v1/restaurant-service/restaurants/:id/fleet
 */

export type PartnerInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | string;

export type PartnerAssociationStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'deactivated'
  | string;

export type DeliveryPartner = {
  id: string;
  partnerCode?: string;
  name: string;
  phone?: string;
  email?: string;
  status?: PartnerAssociationStatus;
  dutyStatus?: string;
  isOnline?: boolean;
  isAvailable?: boolean;
  vehicleType?: string;
  vehicleNumber?: string;
  rating?: number;
  ratingCount?: number;
  totalDeliveries?: number;
  distanceKm?: number;
  etaMinutes?: number;
  avatarUrl?: string;
  lastLocation?: {
    lat?: number;
    lng?: number;
    updatedAt?: string;
  };
};

export type PartnerInvitation = {
  id: string;
  restaurantId?: string;
  partnerId?: string;
  partnerName?: string;
  partnerPhone?: string;
  partnerEmail?: string;
  status: PartnerInvitationStatus;
  message?: string;
  /** Registration / invite URL returned by API */
  inviteLink?: string;
  token?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
};

export type OrderAssignedPartner = {
  orderId: string;
  partner: DeliveryPartner | null;
  assignedAt?: string;
  assignmentType?: 'auto' | 'manual' | string;
};

export type CreateInvitationPayload = {
  /** Invite by partner id when known (nearby rider) */
  partnerId?: string;
  /** Full name — required for phone/email invite link flow */
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
};

export type FleetStatusAction = 'activate' | 'deactivate' | 'suspend';

export type UpdatePartnerStatusPayload = {
  action: FleetStatusAction;
  reason?: string;
};

export type ManualAssignPayload = {
  partnerId: string;
};
