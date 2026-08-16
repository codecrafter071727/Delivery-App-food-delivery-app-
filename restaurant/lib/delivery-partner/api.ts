import axios from 'axios';

import { API_BASE_URL, api, assertApiBaseUrl, refreshCsrfToken } from '@/lib/api';
import { getToken } from '@/lib/auth/storage';
import { getApiErrorMessage, PartnerApiError } from '@/lib/errors';
import {
  postMultipartWithFields,
  type UploadFilePart,
} from '@/lib/multipart-upload';
import { getStoredSessionCookies } from '@/lib/session-cookies';
import {
  applyDutyStatusToProfile,
  partnerAvailabilityApi,
} from '@/lib/delivery-partner/availability-api';
import { canFallbackToRest } from '@/lib/delivery-partner/rider-ack';
import { emitRiderEvent, isRiderSocketConnected } from '@/lib/delivery-partner/rider-gateway';
import { toRejectReasonCode } from '@/lib/delivery-partner/rider-gateway-types';
import { partnerTrackingApi } from '@/lib/delivery-partner/tracking-api';
import type { LocationPingResult } from '@/lib/delivery-partner/tracking-types';
import { normalizeDutyStatus } from '@/lib/delivery-partner/availability-types';
import type {
  DeliverOrderPayload,
  DeliveryHistoryResult,
  DeliveryPartnerProfile,
  DeliveryPartnerRegisterPayload,
  PartnerDelivery,
  PartnerDeliveryAddress,
  PartnerDocument,
  PartnerDocumentsMap,
  PartnerInviteValidation,
  PartnerLivePoint,
  RejectDeliveryPayload,
  UpdatePartnerProfilePayload,
  UploadPartnerDocumentPayload,
  PartnerGpsCoords,
} from '@/lib/delivery-partner/types';
import {
  normalizeDocStatus,
  normalizeDocType,
} from '@/lib/delivery-partner/documents-types';

const PARTNERS_BASE = '/api/v1/delivery-service/partners';
const ME_BASE = `${PARTNERS_BASE}/me`;
const SESSION_AUTH_TOKEN = 'session';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function resolveMediaUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${API_BASE_URL}${path}`;
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

function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;
  const nested =
    record.deliveries ??
    record.orders ??
    record.items ??
    record.results ??
    record.docs ??
    record.list ??
    record.data;
  if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  if (nested && typeof nested === 'object') return extractList(nested);
  return [];
}

function mapLivePoint(raw: unknown): PartnerLivePoint | undefined {
  const record = asRecord(raw);
  if (!Object.keys(record).length) return undefined;
  const nested = asRecord(
    record.location ?? record.coords ?? record.coordinates ?? record
  );
  const lat = pickNumber(nested, ['lat', 'latitude']);
  const lng = pickNumber(nested, ['lng', 'longitude', 'lon']);
  if (lat == null || lng == null) return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat === 0 && lng === 0) return undefined;
  return {
    lat,
    lng,
    updatedAt: pickString(nested, ['updatedAt', 'timestamp', 'recordedAt']),
    accuracy: pickNumber(nested, ['accuracy', 'accuracyMeters']),
  };
}

function mapAddress(raw: unknown): PartnerDeliveryAddress | undefined {
  const record = asRecord(raw);
  if (!Object.keys(record).length) {
    if (typeof raw === 'string' && raw.trim()) {
      return { line1: raw.trim() };
    }
    return undefined;
  }
  const lat = pickNumber(record, ['lat', 'latitude']);
  const lng = pickNumber(record, ['lng', 'longitude', 'lon']);
  return {
    label: pickString(record, ['label', 'name', 'title']),
    line1:
      pickString(record, [
        'line1',
        'addressLine1',
        'street',
        'fullAddress',
        'address',
      ]) ?? undefined,
    line2: pickString(record, ['line2', 'addressLine2', 'area', 'locality']),
    city: pickString(record, ['city']),
    pincode: pickString(record, ['pincode', 'pin', 'postalCode', 'zip']),
    lat,
    lng,
  };
}

function formatItemsSummary(raw: unknown): string | undefined {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (!Array.isArray(raw) || !raw.length) return undefined;
  return raw
    .map((item) => {
      if (typeof item === 'string') return item;
      const row = asRecord(item);
      const name =
        pickString(row, ['name', 'itemName', 'title']) ?? 'Item';
      const qty = pickNumber(row, ['quantity', 'qty']) ?? 1;
      return `${qty}× ${name}`;
    })
    .join(', ');
}

export function mapPartnerDelivery(raw: unknown): PartnerDelivery {
  const record = asRecord(raw);
  const nested = asRecord(
    record.delivery ?? record.assignment ?? record.order ?? record
  );
  const source = Object.keys(nested).length ? nested : record;
  const restaurant = asRecord(
    source.restaurant ?? source.outlet ?? source.store
  );
  const customer = asRecord(
    source.customer ?? source.user ?? source.buyer
  );
  const items =
    source.items ?? source.orderItems ?? source.cartItems ?? source.lineItems;

  const id =
    pickString(source, ['_id', 'id', 'deliveryId', 'assignmentId']) ?? '';

  const restaurantAddress = mapAddress(
    source.restaurantAddress ??
      source.pickupAddress ??
      restaurant.address ??
      restaurant.location
  );
  const deliveryAddress = mapAddress(
    source.deliveryAddress ??
      source.dropAddress ??
      source.shippingAddress ??
      customer.address
  );
  const customerLiveLocation =
    mapLivePoint(
      source.customerLiveLocation ??
        source.liveCustomerLocation ??
        source.customerTracking ??
        source.customerLocation ??
        customer.liveLocation ??
        customer.location
    ) ??
    (deliveryAddress?.lat != null && deliveryAddress?.lng != null
      ? { lat: deliveryAddress.lat, lng: deliveryAddress.lng }
      : undefined);

  return {
    id,
    orderId: pickString(source, ['orderId', 'order_id']),
    orderNumber: pickString(source, [
      'orderNumber',
      'orderNo',
      'orderCode',
      'displayId',
    ]),
    status: normalizeDeliveryStatus(
      pickString(source, ['status', 'deliveryStatus', 'state']) ?? 'assigned'
    ),
    restaurantName:
      pickString(source, ['restaurantName', 'outletName', 'storeName']) ||
      pickString(restaurant, ['name', 'restaurantName']),
    restaurantPhone:
      pickString(source, ['restaurantPhone']) ||
      pickString(restaurant, ['phone', 'mobile', 'contactPhone']),
    restaurantAddress,
    customerName:
      pickString(source, ['customerName', 'receiverName']) ||
      pickString(customer, ['name', 'fullName', 'firstName']),
    customerPhone:
      pickString(source, ['customerPhone', 'receiverPhone']) ||
      pickString(customer, ['phone', 'mobile']),
    deliveryAddress,
    customerLiveLocation,
    itemsSummary: formatItemsSummary(items),
    itemCount:
      pickNumber(source, ['itemCount', 'itemsCount', 'totalItems']) ??
      (Array.isArray(items) ? items.length : undefined),
    amount: pickNumber(source, [
      'amount',
      'orderAmount',
      'totalAmount',
      'grandTotal',
      'payableAmount',
    ]),
    currency: pickString(source, ['currency']) ?? 'INR',
    paymentMethod: pickString(source, [
      'paymentMethod',
      'paymentMode',
      'paymentType',
    ]),
    distanceKm: pickNumber(source, ['distanceKm', 'distance', 'tripDistance']),
    etaMinutes: pickNumber(source, ['etaMinutes', 'eta', 'estimatedMinutes']),
    earning: pickNumber(source, [
      'earning',
      'earnings',
      'partnerEarning',
      'deliveryFee',
      'incentive',
    ]),
    notes: pickString(source, ['notes', 'specialInstructions', 'instruction']),
    assignedAt: pickString(source, ['assignedAt']),
    acceptedAt: pickString(source, ['acceptedAt']),
    arrivedAt: pickString(source, ['arrivedAt']),
    pickedUpAt: pickString(source, ['pickedUpAt', 'pickupAt']),
    deliveredAt: pickString(source, ['deliveredAt']),
    createdAt: pickString(source, ['createdAt']),
    updatedAt: pickString(source, ['updatedAt']),
    raw: source,
  };
}

function mapPartnerDocument(
  type: string,
  raw: unknown
): PartnerDocument | null {
  const canonical = normalizeDocType(type);
  if (!canonical) return null;

  if (raw == null) {
    return { type: canonical, status: 'not_uploaded' };
  }

  if (typeof raw === 'string') {
    const url = resolveMediaUrl(raw.trim()) || undefined;
    return {
      type: canonical,
      // A bare URL means something was uploaded; empty string = nothing
      status: url ? 'pending' : 'not_uploaded',
      url,
    };
  }

  if (typeof raw === 'boolean') {
    return {
      type: canonical,
      status: raw ? 'pending' : 'not_uploaded',
    };
  }

  const record = asRecord(raw);
  const url = resolveMediaUrl(
    pickString(record, [
      'url',
      'fileUrl',
      'imageUrl',
      'previewUrl',
      'documentUrl',
      'path',
      'photo',
      'file',
    ])
  );
  const uploadedAt = pickString(record, [
    'uploadedAt',
    'createdAt',
    'submittedAt',
  ]);
  const hasFileFlag =
    pickBool(record, ['uploaded', 'hasFile', 'isUploaded']) === true;

  const hasUploadEvidence = Boolean(url || uploadedAt || hasFileFlag);

  let status = normalizeDocStatus(
    pickString(record, ['status', 'verificationStatus', 'state', 'docStatus'])
  );

  // Backend sometimes seeds every doc as "pending" before any upload.
  // Without a file/url, treat as not uploaded so the UI is honest.
  if (!hasUploadEvidence) {
    if (
      status === 'pending' ||
      status === 'not_uploaded' ||
      !pickString(record, ['status', 'verificationStatus', 'state', 'docStatus'])
    ) {
      status = 'not_uploaded';
    }
    // Keep rejected/verified only if somehow marked without url (rare) —
    // still prefer not_uploaded when there is zero file evidence.
    if (status === 'rejected' || status === 'verified') {
      status = 'not_uploaded';
    }
  } else if (status === 'not_uploaded') {
    // File exists but status missing → under review
    status = 'pending';
  }

  return {
    type: canonical,
    status,
    url,
    rejectionReason: hasUploadEvidence
      ? pickString(record, [
          'rejectionReason',
          'rejectReason',
          'reason',
          'remarks',
          'message',
        ])
      : undefined,
    uploadedAt,
    verifiedAt: pickString(record, ['verifiedAt', 'approvedAt']),
    raw: record,
  };
}

function mapPartnerDocuments(raw: unknown): PartnerDocumentsMap | undefined {
  if (!raw) return undefined;

  const docs: PartnerDocumentsMap = {};

  if (Array.isArray(raw)) {
    for (const row of raw) {
      const record = asRecord(row);
      const type =
        pickString(record, ['type', 'docType', 'documentType', 'key', 'name']) ??
        '';
      const mapped = mapPartnerDocument(type, row);
      if (mapped) docs[mapped.type] = mapped;
    }
    return Object.keys(docs).length ? docs : undefined;
  }

  const record = asRecord(raw);
  for (const [key, value] of Object.entries(record)) {
    const mapped = mapPartnerDocument(key, value);
    if (mapped) docs[mapped.type] = mapped;
  }

  return Object.keys(docs).length ? docs : undefined;
}

function mapPartner(raw: unknown): DeliveryPartnerProfile {
  const record = asRecord(raw);
  const nested = asRecord(record.partner ?? record.profile ?? record);
  const source = Object.keys(nested).length ? nested : record;
  const availability = asRecord(source.availability ?? source);
  const vehicleObj = asRecord(
    source.vehicle ?? source.vehicleDetails ?? source.bike
  );
  const payoutObj = asRecord(
    source.payout ?? source.bankDetails ?? source.bank ?? source.payoutDetails
  );
  const statsObj = asRecord(
    source.stats ??
      source.performance ??
      source.metrics ??
      source.statistics
  );
  const documents = mapPartnerDocuments(
    source.documents ?? source.kycDocuments ?? source.docs ?? record.documents
  );

  const firstName = pickString(source, ['firstName', 'firstname', 'givenName']);
  const lastName = pickString(source, ['lastName', 'lastname', 'familyName', 'surname']);
  const name =
    pickString(source, ['name', 'fullName', 'displayName']) ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    undefined;

  const vehicleType =
    pickString(source, ['vehicleType', 'vehicle_type']) ||
    pickString(vehicleObj, ['type', 'vehicleType', 'name']);
  const vehicleNumber =
    pickString(source, ['vehicleNumber', 'vehicle_number', 'registrationNumber']) ||
    pickString(vehicleObj, ['number', 'vehicleNumber', 'registrationNumber', 'regNo']);
  const vehicleModel =
    pickString(source, ['vehicleModel', 'vehicle_model']) ||
    pickString(vehicleObj, ['model', 'vehicleModel']);
  const vehicleColor =
    pickString(source, ['vehicleColor', 'vehicle_color']) ||
    pickString(vehicleObj, ['color', 'vehicleColor']);

  const photoFromDocs = documents?.profilePhoto?.url;
  const photoUrl =
    resolveMediaUrl(
      pickString(source, [
        'photoUrl',
        'avatarUrl',
        'profilePhoto',
        'profilePhotoUrl',
        'avatar',
        'photo',
        'imageUrl',
      ]) || photoFromDocs
    ) || undefined;

  const totalDeliveries = pickNumber(statsObj, [
    'totalDeliveries',
    'deliveries',
    'completedDeliveries',
    'totalOrders',
  ]) ?? pickNumber(source, [
    'totalDeliveries',
    'deliveries',
    'completedDeliveries',
  ]);

  const avgRating = pickNumber(statsObj, [
    'avgRating',
    'averageRating',
    'rating',
  ]) ?? pickNumber(source, ['avgRating', 'averageRating', 'rating']);

  const completionRate = pickNumber(statsObj, [
    'completionRate',
    'completeRate',
  ]) ?? pickNumber(source, ['completionRate']);

  const acceptanceRate = pickNumber(statsObj, [
    'acceptanceRate',
    'acceptRate',
  ]) ?? pickNumber(source, ['acceptanceRate']);

  return {
    id: pickString(source, ['_id', 'id', 'partnerId']) ?? '',
    userId: pickString(source, ['userId', 'user_id']),
    name,
    firstName,
    lastName,
    email: pickString(source, ['email']),
    phone: pickString(source, ['phone', 'mobile', 'phoneNumber']),
    dateOfBirth: pickString(source, [
      'dateOfBirth',
      'dob',
      'birthDate',
      'birthday',
    ]),
    photoUrl,
    vehicleType,
    vehicleNumber,
    vehicleModel,
    vehicleColor,
    vehicle: {
      type: vehicleType,
      number: vehicleNumber,
      model: vehicleModel,
      color: vehicleColor,
    },
    payout: {
      bankAccountNo: pickString(payoutObj, [
        'bankAccountNo',
        'accountNumber',
        'accountNo',
        'bankAccount',
      ]) || pickString(source, ['bankAccountNo', 'accountNumber']),
      ifscCode:
        pickString(payoutObj, ['ifscCode', 'ifsc', 'IFSC']) ||
        pickString(source, ['ifscCode', 'ifsc']),
      upiId:
        pickString(payoutObj, ['upiId', 'upi', 'upiAddress']) ||
        pickString(source, ['upiId', 'upi']),
      accountHolderName: pickString(payoutObj, [
        'accountHolderName',
        'holderName',
        'accountName',
      ]),
      bankName: pickString(payoutObj, ['bankName', 'bank']),
    },
    stats: {
      totalDeliveries,
      avgRating,
      completionRate,
      acceptanceRate,
    },
    status: pickString(source, ['status']),
    dutyStatus: normalizeDutyStatus(
      pickString(source, ['dutyStatus']) ||
        pickString(availability, ['dutyStatus', 'status'])
    ),
    isOnline:
      pickBool(source, ['isOnline', 'online']) ??
      pickBool(availability, ['isOnline', 'online', 'isAvailable', 'available']),
    isAvailable:
      pickBool(source, ['isAvailable', 'available']) ??
      pickBool(availability, ['isAvailable', 'available', 'isOnline', 'online']),
    zoneId: pickString(source, ['zoneId', 'hubId']) || pickString(availability, ['zoneId']),
    onlineSince:
      pickString(source, ['onlineSince']) || pickString(availability, ['onlineSince']),
    documents,
  };
}

/** Map backend status aliases to the app workflow. */
export function normalizeDeliveryStatus(status: string): string {
  const key = status.trim().toLowerCase().replace(/\s+/g, '_');
  const aliases: Record<string, string> = {
    new: 'assigned',
    offered: 'assigned',
    requested: 'assigned',
    pending: 'assigned',
    pending_assignment: 'assigned',
    assignment: 'assigned',
    assigned: 'assigned',
    confirmed: 'accepted',
    accept: 'accepted',
    accepted: 'accepted',
    heading_to_restaurant: 'accepted',
    going_to_pickup: 'accepted',
    at_restaurant: 'arrived',
    reached_restaurant: 'arrived',
    reached_pickup: 'arrived',
    arrive: 'arrived',
    arrived: 'arrived',
    arrived_at_restaurant: 'arrived',
    arrived_at_customer: 'at_customer',
    reached_customer: 'at_customer',
    at_customer: 'at_customer',
    at_drop: 'at_customer',
    reassigned: 'cancelled',
    pickedup: 'picked_up',
    picked_up: 'picked_up',
    pickup: 'picked_up',
    collected: 'picked_up',
    ofd: 'out_for_delivery',
    out_for_delivery: 'out_for_delivery',
    on_the_way: 'out_for_delivery',
    delivering: 'out_for_delivery',
    deliver: 'delivered',
    delivered: 'delivered',
    completed: 'delivered',
    complete: 'delivered',
    reject: 'rejected',
    rejected: 'rejected',
    cancel: 'cancelled',
    canceled: 'cancelled',
    cancelled: 'cancelled',
  };
  return aliases[key] ?? key;
}

function isLiveStatus(status: string) {
  const s = normalizeDeliveryStatus(status);
  return (
    s === 'assigned' ||
    s === 'accepted' ||
    s === 'arrived' ||
    s === 'picked_up' ||
    s === 'out_for_delivery' ||
    s === 'at_customer'
  );
}

export function isAssignableStatus(status: string) {
  const s = normalizeDeliveryStatus(status);
  return s === 'assigned';
}

export function nextDeliveryAction(
  status: string
): 'accept' | 'arrived' | 'pickup' | 'reached_customer' | 'deliver' | null {
  const s = normalizeDeliveryStatus(status);
  if (s === 'assigned') return 'accept';
  if (s === 'accepted') return 'arrived';
  if (s === 'arrived') return 'pickup';
  if (s === 'picked_up' || s === 'out_for_delivery') return 'reached_customer';
  if (s === 'at_customer') return 'deliver';
  return null;
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
      data: method === 'GET' ? undefined : (body ?? {}),
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
      throw new Error(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    throw new Error(getApiErrorMessage(error, 'Request failed'));
  }
}

function toRegisterBody(payload: DeliveryPartnerRegisterPayload) {
  const body: Record<string, unknown> = {
    firstName: payload.firstName.trim(),
    phone: payload.phone.trim(),
    vehicleType: payload.vehicleType,
    acceptedTerms: payload.acceptedTerms,
    agreeToTerms: payload.acceptedTerms,
    termsAccepted: payload.acceptedTerms,
  };

  if (payload.lastName?.trim()) body.lastName = payload.lastName.trim();
  if (payload.email?.trim()) body.email = payload.email.trim().toLowerCase();
  if (payload.address?.trim()) body.address = payload.address.trim();
  if (payload.city?.trim()) body.city = payload.city.trim();
  if (payload.state?.trim()) body.state = payload.state.trim();
  if (payload.vehicleNumber?.trim()) {
    body.vehicleNumber = payload.vehicleNumber.trim().toUpperCase();
  }
  if (payload.aadharNumber?.trim()) {
    const digits = payload.aadharNumber.replace(/\D/g, '');
    body.aadharNumber = digits;
    body.aadhaarNumber = digits;
  }
  if (payload.inviteToken?.trim()) {
    const token = payload.inviteToken.trim();
    body.inviteToken = token;
    body.token = token;
    body.invitationToken = token;
  }

  return body;
}

async function postDeliverWithProof(
  deliveryId: string,
  payload: DeliverOrderPayload
): Promise<PartnerDelivery> {
  const csrf = await refreshCsrfToken(true);
  const authToken = await getToken();
  const sessionCookies = await getStoredSessionCookies();

  const form = new FormData();
  if (payload.otp?.trim()) form.append('otp', payload.otp.trim());
  if (payload.notes?.trim()) form.append('notes', payload.notes.trim());
  form.append('status', 'delivered');

  if (payload.proofUri) {
    const name = payload.proofFileName ?? `proof-${Date.now()}.jpg`;
    const type = payload.proofMimeType ?? 'image/jpeg';
    form.append('proof', {
      uri: payload.proofUri,
      name,
      type,
    } as unknown as Blob);
    form.append('image', {
      uri: payload.proofUri,
      name,
      type,
    } as unknown as Blob);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-CSRF-Token': csrf,
  };
  if (authToken && authToken !== SESSION_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${authToken}`;
  } else if (sessionCookies) {
    headers.Cookie = sessionCookies;
  }

  const url = `${API_BASE_URL}${ME_BASE}/deliveries/${encodeURIComponent(deliveryId)}/deliver`;
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: form,
    credentials: 'include',
  });

  const text = await response.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { message: text };
  }

  if (!response.ok) {
    const record = asRecord(json);
    throw new Error(
      pickString(record, ['message', 'error']) ||
        `Deliver failed (${response.status})`
    );
  }

  const envelope = asRecord(json);
  return mapPartnerDelivery(envelope.data ?? envelope);
}

function safeUploadName(name: string, fallbackExt = '.jpg'): string {
  const base = name.split(/[/\\]/).pop() ?? `upload${fallbackExt}`;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : fallbackExt;
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  return `${stem || 'upload'}${ext}`;
}

/** Normalize gallery pick into a multer-friendly JPEG file part. */
async function prepareJpegFile(
  uri: string,
  fileName?: string
): Promise<UploadFilePart> {
  return {
    uri,
    name: safeUploadName(
      (fileName ?? `upload-${Date.now()}`).replace(/\.\w+$/, '') + '.jpg',
      '.jpg'
    ),
    type: 'image/jpeg',
  };
}

/**
 * Profile photo → POST /partners/me/documents only
 * (same route as KYC; delivery-service has no /profile-photo route).
 */
async function uploadPartnerProfilePhoto(
  sourceUri: string,
  fileName?: string
): Promise<DeliveryPartnerProfile> {
  const filePart = await prepareJpegFile(sourceUri, fileName);

  const attempts: Array<{
    fields: Record<string, string>;
    files: Array<{ fieldName: string; file: UploadFilePart }>;
  }> = [
    // Exact KYC upload shape that Documents screen uses
    {
      fields: { docType: 'profilePhoto', type: 'profilePhoto' },
      files: [
        { fieldName: 'photo', file: filePart },
        { fieldName: 'file', file: { ...filePart } },
      ],
    },
    // Single file field if dual-file is rejected
    {
      fields: { docType: 'profilePhoto', type: 'profilePhoto' },
      files: [{ fieldName: 'photo', file: filePart }],
    },
  ];

  let lastError: Error | null = null;

  for (const attempt of attempts) {
    try {
      const uploaded = await postMultipartWithFields(
        `${ME_BASE}/documents`,
        attempt
      );
      const mapped = mapPartner(uploaded);
      if (mapped.id || mapped.photoUrl) return mapped;
      const refreshed = await deliveryPartnerApi.getMe();
      if (refreshed) return refreshed;
      return mapped;
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error('Profile photo upload failed');
      const message = lastError.message.toLowerCase();
      if (
        message.includes('authentication') ||
        message.includes('unauthorized') ||
        message.includes('csrf') ||
        message.includes('forbidden') ||
        message.includes('log in')
      ) {
        throw lastError;
      }
      // Don't keep retrying hard server failures that aren't field-related
      if (
        message.includes('internal server error') ||
        message.includes('route not found') ||
        message.includes('cannot post')
      ) {
        throw lastError;
      }
    }
  }

  throw (
    lastError ??
    new Error(
      'Could not upload profile photo. Try a smaller JPG from your gallery.'
    )
  );
}

async function getCurrentPartnerCoords(): Promise<PartnerGpsCoords> {
  const Location = await import('expo-location');
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new PartnerApiError(
      'Location permission is required to go online. Enable it in Settings.',
      'LOCATION_REQUIRED'
    );
  }

  const enabled = await Location.hasServicesEnabledAsync();
  if (!enabled) {
    throw new PartnerApiError(
      'Turn on GPS / location services to go online.',
      'LOCATION_REQUIRED'
    );
  }

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const latitude = pos.coords.latitude;
  const longitude = pos.coords.longitude;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    (latitude === 0 && longitude === 0)
  ) {
    throw new PartnerApiError(
      'Could not read your GPS location. Try again outdoors.',
      'LOCATION_REQUIRED'
    );
  }

  return {
    latitude,
    longitude,
    accuracy: pos.coords.accuracy ?? undefined,
    speed: pos.coords.speed,
    heading: pos.coords.heading,
    altitude: pos.coords.altitude,
    timestamp: pos.timestamp,
  };
}

function mapInviteValidation(
  token: string,
  raw: unknown
): PartnerInviteValidation {
  const envelope = asRecord(raw);
  const source = asRecord(
    envelope.data ??
      envelope.invite ??
      envelope.invitation ??
      envelope.result ??
      envelope
  );
  const restaurant = asRecord(
    source.restaurant ?? source.outlet ?? source.store
  );

  const status =
    pickString(source, ['status', 'inviteStatus', 'state'])?.toLowerCase() ??
    undefined;

  const explicitValid = pickBool(source, [
    'valid',
    'isValid',
    'ok',
    'success',
  ]);
  const expired =
    status === 'expired' ||
    status === 'revoked' ||
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'used' ||
    status === 'accepted' ||
    pickBool(source, ['expired', 'isExpired', 'used', 'revoked']) === true;

  const valid =
    explicitValid === true
      ? true
      : explicitValid === false
        ? false
        : !expired &&
          (Boolean(
            pickString(source, [
              'restaurantId',
              'restaurantName',
              'token',
              'inviteToken',
            ])
          ) ||
            Boolean(pickString(restaurant, ['name', '_id', 'id'])) ||
            envelope.success === true);

  const message =
    pickString(source, ['message', 'error', 'reason', 'detail']) ||
    pickString(envelope, ['message', 'error']) ||
    (valid
      ? undefined
      : expired
        ? 'This invitation is no longer valid.'
        : 'This invitation link is invalid.');

  return {
    valid: Boolean(valid),
    token,
    restaurantId:
      pickString(source, ['restaurantId', 'outletId', 'storeId']) ||
      pickString(restaurant, ['_id', 'id']),
    restaurantName:
      pickString(source, [
        'restaurantName',
        'outletName',
        'storeName',
        'businessName',
      ]) || pickString(restaurant, ['name', 'restaurantName']),
    inviteEmail: pickString(source, [
      'email',
      'inviteEmail',
      'invitedEmail',
      'partnerEmail',
    ]),
    invitePhone: pickString(source, [
      'phone',
      'invitePhone',
      'invitedPhone',
      'partnerPhone',
      'mobile',
    ]),
    status,
    expiresAt: pickString(source, ['expiresAt', 'expiry', 'validUntil']),
    message,
    raw: source,
  };
}

export const deliveryPartnerApi = {
  /**
   * GET /partners/invite/validate — public invite check (email link).
   */
  validateInvite: async (token: string): Promise<PartnerInviteValidation> => {
    const trimmed = token.trim();
    if (!trimmed) {
      return {
        valid: false,
        token: '',
        message: 'Invitation token is missing.',
      };
    }

    try {
      const res = await request<unknown>(`${PARTNERS_BASE}/invite/validate`, {
        params: {
          token: trimmed,
          inviteToken: trimmed,
          invitationToken: trimmed,
        },
      });
      return mapInviteValidation(trimmed, res.data ?? res);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not validate invitation.';
      const lower = message.toLowerCase();
      if (
        lower.includes('not found') ||
        lower.includes('invalid') ||
        lower.includes('expired') ||
        lower.includes('404')
      ) {
        return {
          valid: false,
          token: trimmed,
          message: message || 'This invitation link is invalid or expired.',
        };
      }
      throw error instanceof Error
        ? error
        : new Error('Could not validate invitation.');
    }
  },

  /**
   * POST /partners/register — standard flow
   * POST /partners/register-with-invite — when inviteToken is present
   */
  register: async (
    payload: DeliveryPartnerRegisterPayload
  ): Promise<DeliveryPartnerProfile> => {
    if (!payload.firstName?.trim()) throw new Error('First name is required.');
    if (!payload.phone?.trim()) throw new Error('Phone number is required.');
    if (!payload.vehicleType) throw new Error('Vehicle type is required.');
    if (!payload.acceptedTerms) {
      throw new Error('You must agree to the Terms & Conditions.');
    }

    const hasInvite = Boolean(payload.inviteToken?.trim());
    const path = hasInvite
      ? `${PARTNERS_BASE}/register-with-invite`
      : `${PARTNERS_BASE}/register`;

    const res = await request<Record<string, unknown>>(path, {
      method: 'POST',
      body: toRegisterBody(payload),
    });
    return mapPartner(res.data ?? res);
  },

  /** GET /partners/me */
  getMe: async (): Promise<DeliveryPartnerProfile | null> => {
    try {
      const res = await request<Record<string, unknown>>(ME_BASE);
      const mapped = mapPartner(res.data ?? res);
      return mapped.id ? mapped : null;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (
        message.includes('not found') ||
        message.includes('404') ||
        message.includes('no partner') ||
        message.includes('not registered')
      ) {
        return null;
      }
      throw error;
    }
  },

  /**
   * PUT profile fields.
   * Live schema for PUT /partners/me only accepts personal keys
   * (firstName, lastName, phone, email) — rejects vehicle / dob / mobile.
   * Vehicle + payout use dedicated sub-routes with fallbacks.
   */
  updateProfile: async (
    payload: UpdatePartnerProfilePayload
  ): Promise<DeliveryPartnerProfile> => {
    const personal: Record<string, unknown> = {};
    if (payload.firstName !== undefined) {
      personal.firstName = payload.firstName.trim();
    }
    if (payload.lastName !== undefined) {
      personal.lastName = payload.lastName.trim();
    }
    if (payload.phone !== undefined) {
      personal.phone = payload.phone.trim();
    }
    if (payload.email !== undefined) {
      personal.email = payload.email.trim().toLowerCase();
    }

    const vehicleNested: Record<string, unknown> = {};
    const vehicleFlat: Record<string, unknown> = {};
    if (payload.vehicleType !== undefined) {
      vehicleNested.type = payload.vehicleType;
      vehicleFlat.vehicleType = payload.vehicleType;
    }
    if (payload.vehicleNumber !== undefined) {
      const number = payload.vehicleNumber.trim().toUpperCase();
      vehicleNested.number = number;
      vehicleFlat.vehicleNumber = number;
    }
    if (payload.vehicleModel !== undefined) {
      const model = payload.vehicleModel.trim();
      vehicleNested.model = model;
      vehicleFlat.vehicleModel = model;
    }
    if (payload.vehicleColor !== undefined) {
      const color = payload.vehicleColor.trim();
      vehicleNested.color = color;
      vehicleFlat.vehicleColor = color;
    }

    const payout: Record<string, unknown> = {};
    if (payload.bankAccountNo !== undefined) {
      payout.bankAccountNo = payload.bankAccountNo.trim();
    }
    if (payload.ifscCode !== undefined) {
      payout.ifscCode = payload.ifscCode.trim().toUpperCase();
    }
    if (payload.upiId !== undefined) {
      payout.upiId = payload.upiId.trim();
    }

    const hasPersonal = Object.keys(personal).length > 0;
    const hasVehicle = Object.keys(vehicleNested).length > 0;
    const hasPayout = Object.keys(payout).length > 0;

    if (!hasPersonal && !hasVehicle && !hasPayout) {
      throw new Error('Nothing to update.');
    }

    const attempts: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [];

    // Vehicle is NOT accepted as `vehicle` / `vehicleType` on PUT /partners/me.
    if (hasVehicle) {
      const vehicleSnake: Record<string, unknown> = {};
      if (payload.vehicleType !== undefined) {
        vehicleSnake.vehicle_type = payload.vehicleType;
      }
      if (payload.vehicleNumber !== undefined) {
        vehicleSnake.vehicle_number = payload.vehicleNumber.trim().toUpperCase();
      }
      if (payload.vehicleModel !== undefined) {
        vehicleSnake.vehicle_model = payload.vehicleModel.trim();
      }
      if (payload.vehicleColor !== undefined) {
        vehicleSnake.vehicle_color = payload.vehicleColor.trim();
      }

      attempts.push(
        { path: ME_BASE, body: vehicleSnake },
        { path: `${ME_BASE}/vehicle`, body: vehicleNested },
        { path: `${ME_BASE}/vehicle`, body: vehicleFlat },
        { path: `${ME_BASE}/vehicle-details`, body: vehicleNested },
        { path: `${ME_BASE}/vehicle-details`, body: vehicleFlat }
      );
    }

    // Payout: try flat keys on /me first, then dedicated routes.
    if (hasPayout) {
      attempts.push(
        { path: ME_BASE, body: payout },
        { path: `${ME_BASE}/payout`, body: payout },
        { path: `${ME_BASE}/bank-details`, body: payout },
        { path: `${ME_BASE}/bank`, body: payout }
      );
    }

    if (hasPersonal) {
      attempts.push({ path: ME_BASE, body: personal });
    }

    let lastError: Error | null = null;
    for (const attempt of attempts) {
      try {
        const res = await request<Record<string, unknown>>(attempt.path, {
          method: 'PUT',
          body: attempt.body,
        });
        const mapped = mapPartner(res.data ?? res);
        if (mapped.id) return mapped;
        const refreshed = await deliveryPartnerApi.getMe();
        if (refreshed?.id) return refreshed;
        return mapped;
      } catch (error) {
        const message =
          error instanceof Error ? error.message.toLowerCase() : '';
        if (
          message.includes('authentication') ||
          message.includes('unauthorized') ||
          message.includes('not authenticated') ||
          message.includes('log in') ||
          message.includes('forbidden')
        ) {
          throw error instanceof Error
            ? error
            : new Error('Please sign in again.');
        }
        lastError =
          error instanceof Error ? error : new Error('Profile update failed');
      }
    }

    throw (
      lastError ??
      new Error(
        hasVehicle
          ? 'Vehicle update is not supported by the server yet.'
          : 'Could not update profile.'
      )
    );
  },

  /**
   * PUT /partners/me/go-online | PUT /partners/me/go-offline
   * Go-online requires current GPS coordinates (latitude / longitude).
   * Also pushes POST /partners/me/location after a successful go-online.
   */
  setOnline: async (isOnline: boolean): Promise<DeliveryPartnerProfile> => {
    let coords: PartnerGpsCoords | undefined;
    const result = isOnline
      ? await partnerAvailabilityApi.goOnline(
          (coords = await getCurrentPartnerCoords())
        )
      : await partnerAvailabilityApi.goOffline();

    if (isOnline && coords) {
      try {
        await deliveryPartnerApi.pushLocation(coords);
      } catch {
        // go-online already succeeded
      }
    } else if (!isOnline) {
      try {
        const { partnerLocationTracker } = await import(
          '@/lib/delivery-partner/location-tracker'
        );
        await partnerLocationTracker.stop();
      } catch {
        // ignore
      }
    }

    let me: DeliveryPartnerProfile | null = null;
    try {
      me = await deliveryPartnerApi.getMe();
    } catch {
      me = null;
    }

    return applyDutyStatusToProfile(me, result.status, result.partner);
  },

  /** POST /partners/me/location — push current GPS (respect nextPingAfterMs). */
  pushLocation: async (coords?: PartnerGpsCoords): Promise<LocationPingResult> => {
    const point = coords ?? (await getCurrentPartnerCoords());
    return partnerTrackingApi.pushLocation(point);
  },

  /** GET /partners/me/active-delivery */
  getActiveDelivery: async (): Promise<PartnerDelivery | null> => {
    try {
      const res = await request<unknown>(`${ME_BASE}/active-delivery`);
      const root = res.data ?? res;
      if (root == null) return null;

      // Some backends return a list of current assignments
      if (Array.isArray(root)) {
        const first = root
          .map(mapPartnerDelivery)
          .find((row) => row.id && isLiveStatus(row.status));
        return first ?? null;
      }

      if (typeof root === 'object') {
        const record = asRecord(root);
        if (
          record.delivery === null ||
          record.activeDelivery === null ||
          record.data === null
        ) {
          return null;
        }

        const listCandidate =
          record.deliveries ??
          record.assignments ??
          record.items ??
          record.results;
        if (Array.isArray(listCandidate) && listCandidate.length) {
          const first = listCandidate
            .map(mapPartnerDelivery)
            .find((row) => row.id && isLiveStatus(row.status));
          if (first) return first;
        }

        const nested =
          record.delivery ??
          record.activeDelivery ??
          record.assignment ??
          record.order ??
          record;
        const mapped = mapPartnerDelivery(nested);
        if (!mapped.id) return null;
        return mapped;
      }
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (
        message.includes('not found') ||
        message.includes('no active') ||
        message.includes('404') ||
        message.includes('null')
      ) {
        return null;
      }
      throw error;
    }
  },

  /** GET /partners/me/deliveries */
  getDeliveries: async (params?: {
    page?: number;
    limit?: number;
  }): Promise<DeliveryHistoryResult> => {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const res = await request<unknown>(`${ME_BASE}/deliveries`, {
      params: { page, limit },
    });
    const list = extractList(res.data ?? res)
      .map(mapPartnerDelivery)
      .filter((row) => row.id);
    const meta = asRecord(res.meta ?? asRecord(res.data).meta);
    const total =
      pickNumber(meta, ['total', 'totalCount', 'count']) ?? list.length;
    const totalPages =
      pickNumber(meta, ['totalPages', 'pages']) ??
      Math.max(1, Math.ceil(total / limit));
    const hasNext =
      pickBool(meta, ['hasNext', 'hasMore']) ?? page < totalPages;

    return {
      deliveries: list,
      page: pickNumber(meta, ['page', 'currentPage']) ?? page,
      limit: pickNumber(meta, ['limit', 'perPage']) ?? limit,
      total,
      hasNext: Boolean(hasNext),
    };
  },

  /** PUT /partners/me/deliveries/:id/accept — socket `delivery:accept` when live. */
  acceptDelivery: async (deliveryId: string): Promise<PartnerDelivery> => {
    const id = deliveryId.trim();
    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('delivery:accept', { deliveryId: id });
        return mapPartnerDelivery(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }
    const res = await request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(id)}/accept`,
      { method: 'PUT', body: {} }
    );
    return mapPartnerDelivery(res.data ?? res);
  },

  /** PUT /partners/me/deliveries/:id/reject — socket `delivery:reject` (`reasonCode` required). */
  rejectDelivery: async (
    deliveryId: string,
    payload: RejectDeliveryPayload
  ): Promise<PartnerDelivery> => {
    const reason = payload.reason?.trim();
    if (!reason) throw new Error('Please provide a rejection reason.');
    const reasonCode = payload.reasonCode ?? toRejectReasonCode(reason);
    const id = deliveryId.trim();
    const body = { reason, rejectionReason: reason, reasonCode };

    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('delivery:reject', {
          deliveryId: id,
          reasonCode,
          reason,
        });
        return mapPartnerDelivery(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }

    const res = await request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(id)}/reject`,
      { method: 'PUT', body }
    );
    return mapPartnerDelivery(res.data ?? res);
  },

  /** PUT /partners/me/deliveries/:id/arrived — socket `delivery:arrived`. */
  markArrived: async (deliveryId: string): Promise<PartnerDelivery> => {
    const id = deliveryId.trim();
    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('delivery:arrived', { deliveryId: id });
        return mapPartnerDelivery(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }
    const res = await request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(id)}/arrived`,
      { method: 'PUT', body: {} }
    );
    return mapPartnerDelivery(res.data ?? res);
  },

  /** PUT /partners/me/deliveries/:id/pickup — socket `delivery:picked-up`. */
  markPickedUp: async (
    deliveryId: string,
    payload?: { otp?: string; photoUrl?: string }
  ): Promise<PartnerDelivery> => {
    const id = deliveryId.trim();
    const socketBody: Record<string, unknown> = { deliveryId: id };
    if (payload?.otp?.trim()) socketBody.otp = payload.otp.trim();
    if (payload?.photoUrl?.trim()) socketBody.photoUrl = payload.photoUrl.trim();

    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('delivery:picked-up', socketBody);
        return mapPartnerDelivery(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }
    const res = await request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(id)}/pickup`,
      { method: 'PUT', body: socketBody }
    );
    return mapPartnerDelivery(res.data ?? res);
  },

  /** PUT /partners/me/deliveries/:id/arrived-customer — socket `delivery:reached-customer`. */
  markReachedCustomer: async (deliveryId: string): Promise<PartnerDelivery> => {
    const id = deliveryId.trim();
    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('delivery:reached-customer', {
          deliveryId: id,
        });
        return mapPartnerDelivery(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }
    const res = await request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(id)}/arrived-customer`,
      { method: 'PUT', body: {} }
    );
    return mapPartnerDelivery(res.data ?? res);
  },

  /** POST /partners/me/deliveries/:id/deliver — socket `delivery:completed` unless proof photo. */
  markDelivered: async (
    deliveryId: string,
    payload: DeliverOrderPayload = {}
  ): Promise<PartnerDelivery> => {
    if (payload.proofUri) {
      return postDeliverWithProof(deliveryId, payload);
    }

    const id = deliveryId.trim();
    const body: Record<string, unknown> = { deliveryId: id };
    if (payload.otp?.trim()) body.otp = payload.otp.trim();
    if (payload.notes?.trim()) body.notes = payload.notes.trim();
    if (payload.proofUrl?.trim()) body.proofPhotoUrl = payload.proofUrl.trim();
    if (payload.signatureUrl?.trim()) body.signatureUrl = payload.signatureUrl.trim();

    if (isRiderSocketConnected()) {
      try {
        const data = await emitRiderEvent('delivery:completed', body);
        return mapPartnerDelivery(data);
      } catch (error) {
        if (!canFallbackToRest(error)) throw error;
      }
    }

    const restBody: Record<string, unknown> = {};
    if (payload.otp?.trim()) restBody.otp = payload.otp.trim();
    if (payload.notes?.trim()) restBody.notes = payload.notes.trim();

    const res = await request<unknown>(
      `${ME_BASE}/deliveries/${encodeURIComponent(id)}/deliver`,
      { method: 'POST', body: restBody }
    );
    return mapPartnerDelivery(res.data ?? res);
  },

  /**
   * POST profile photo / KYC document.
   * Gallery images are converted to JPEG first (HEIC/content:// crash servers).
   */
  uploadDocument: async (
    payload: UploadPartnerDocumentPayload
  ): Promise<DeliveryPartnerProfile> => {
    if (!payload.docType) throw new Error('Document type is required.');
    if (!payload.uri?.trim()) throw new Error('Please select a document image.');

    if (payload.docType === 'profilePhoto') {
      return uploadPartnerProfilePhoto(payload.uri, payload.fileName);
    }

    const filePart = await prepareJpegFile(
      payload.uri,
      payload.fileName ?? `${payload.docType}-${Date.now()}.jpg`
    );

    const uploaded = await postMultipartWithFields(`${ME_BASE}/documents`, {
      fields: {
        docType: payload.docType,
        type: payload.docType,
      },
      files: [
        { fieldName: 'photo', file: filePart },
        { fieldName: 'file', file: { ...filePart } },
      ],
    });

    const mapped = mapPartner(uploaded);
    if (mapped.id) return mapped;
    return (await deliveryPartnerApi.getMe()) ?? mapped;
  },
};

export function formatDeliveryAddress(
  address?: PartnerDeliveryAddress | null
): string {
  if (!address) return '';
  return [address.line1, address.line2, address.city, address.pincode]
    .filter(Boolean)
    .join(', ');
}

export function deliveryStatusLabel(status: string): string {
  const key = normalizeDeliveryStatus(status);
  const map: Record<string, string> = {
    assigned: 'New assignment',
    accepted: 'Head to restaurant',
    arrived: 'At restaurant',
    picked_up: 'Picked up — deliver now',
    out_for_delivery: 'Out for delivery',
    at_customer: 'At customer',
    delivered: 'Delivered',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  };
  return map[key] ?? key.replace(/_/g, ' ');
}
