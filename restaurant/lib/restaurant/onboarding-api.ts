import axios from 'axios';

import { api } from '@/lib/api';
import { PartnerApiError, getApiErrorCode } from '@/lib/errors';
import { postMultipartWithFields } from '@/lib/multipart-upload';
import { parseListingStatus } from '@/lib/restaurant/listing-status';
import type {
  IfscLookup,
  KycDocStatus,
  KycDocType,
  KycDocument,
  KycDocumentsList,
  KycSubmitResult,
  KycSubmissionStatus,
  OnboardingStatus,
  OnboardingStep,
  OnboardingStepKey,
  RestaurantBank,
  UpdateBankPayload,
  UploadKycPayload,
} from '@/lib/restaurant/onboarding-types';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'Network request failed. Check your internet and try again.';
    }
    const status = error.response.status;
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const code = String(data?.code ?? '').toUpperCase();
    if (code === 'KYC_INCOMPLETE') {
      return (
        data?.message ||
        'Add your 14-digit FSSAI number and certificate photo to submit.'
      );
    }
    if (code === 'KYC_LOCKED') {
      return (
        data?.message ||
        'KYC is locked while admin reviews your listing.'
      );
    }
    if (code === 'OUTLET_PHOTOS_LIMIT') {
      return data?.message || 'You can upload up to 8 outlet photos.';
    }
    if (code === 'INVALID_FSSAI') {
      return 'FSSAI license must be 14 digits.';
    }
    if (code === 'INVALID_GSTIN') {
      return 'Enter a valid 15-character GSTIN.';
    }
    if (code === 'INVALID_PAN') {
      return 'Enter a valid 10-character PAN.';
    }
    if (code === 'INVALID_IFSC') {
      return data?.message || 'That IFSC is not valid.';
    }
    if (code === 'IFSC_LOOKUP_UNAVAILABLE') {
      return 'Bank directory is down. Try the IFSC again in a minute.';
    }
    if (code === 'INVALID_ACCOUNT') {
      return data?.message || 'Account number must be 9–18 digits.';
    }
    if (code === 'INVALID_HOLDER_NAME') {
      return 'Enter the account holder name as on the passbook.';
    }
    if (code === 'ILLEGAL_TRANSITION') {
      return data?.message || 'This listing cannot be submitted right now.';
    }
    if (code === 'INVALID_FILE_TYPE') {
      return 'Use JPEG, PNG, WebP, or PDF (max 8 MB).';
    }
    return data?.message || data?.error || `Request failed (${status})`;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function throwOnboardingError(error: unknown, fallback: string): never {
  throw new PartnerApiError(
    extractError(error, fallback),
    getApiErrorCode(error)
  );
}

function mapStep(row: unknown): OnboardingStep | null {
  const record = asRecord(row);
  const key = String(record.key ?? '') as OnboardingStepKey;
  if (!key) return null;
  return {
    key,
    label: String(record.label ?? key),
    required: record.required === true,
    done: record.done === true,
    detail:
      typeof record.detail === 'string' && record.detail.trim()
        ? record.detail.trim()
        : null,
  };
}

function mapStatus(raw: unknown): OnboardingStatus {
  const record = asRecord(raw);
  const steps = Array.isArray(record.steps)
    ? record.steps
        .map(mapStep)
        .filter((row): row is OnboardingStep => Boolean(row))
    : [];
  const blockers = Array.isArray(record.blockers)
    ? record.blockers.map((item) => String(item)).filter(Boolean)
    : [];
  return {
    restaurantId: String(record.restaurantId ?? ''),
    listingStatus: parseListingStatus(
      typeof record.listingStatus === 'string'
        ? record.listingStatus
        : typeof record.status === 'string'
          ? record.status
          : undefined
    ),
    kycStatus: (String(record.kycStatus ?? 'draft') ||
      'draft') as KycSubmissionStatus,
    submittedAt:
      typeof record.submittedAt === 'string' ? record.submittedAt : null,
    rejectReason:
      typeof record.rejectReason === 'string' && record.rejectReason.trim()
        ? record.rejectReason.trim()
        : null,
    steps,
    percent: Number(record.percent ?? 0) || 0,
    canSubmit: record.canSubmit === true,
    blockers,
  };
}

function mapDocument(row: unknown): KycDocument | null {
  const record = asRecord(row);
  const type = String(record.type ?? '') as KycDocType;
  if (!type) return null;
  return {
    id: String(record._id ?? record.id ?? ''),
    type,
    status: (String(record.status ?? 'uploaded') ||
      'uploaded') as KycDocStatus,
    url: typeof record.url === 'string' ? record.url : undefined,
    numberMasked:
      typeof record.numberMasked === 'string' ? record.numberMasked : null,
    rejectReason:
      typeof record.rejectReason === 'string' && record.rejectReason.trim()
        ? record.rejectReason.trim()
        : null,
    uploadedAt:
      typeof record.uploadedAt === 'string' ? record.uploadedAt : undefined,
    verifiedAt:
      typeof record.verifiedAt === 'string' ? record.verifiedAt : null,
  };
}

function mapDocuments(raw: unknown): KycDocumentsList {
  const record = asRecord(raw);
  const documents = Array.isArray(record.documents)
    ? record.documents
        .map(mapDocument)
        .filter((row): row is KycDocument => Boolean(row))
    : [];
  return {
    restaurantId: String(record.restaurantId ?? ''),
    kycStatus: (String(record.kycStatus ?? 'draft') ||
      'draft') as KycSubmissionStatus,
    fssaiMasked:
      typeof record.fssaiMasked === 'string' ? record.fssaiMasked : null,
    gstinMasked:
      typeof record.gstinMasked === 'string' ? record.gstinMasked : null,
    panMasked: typeof record.panMasked === 'string' ? record.panMasked : null,
    documents,
  };
}

function mapBank(raw: unknown): RestaurantBank {
  const record = asRecord(raw);
  return {
    accountMasked:
      typeof record.accountMasked === 'string' ? record.accountMasked : null,
    ifsc: typeof record.ifsc === 'string' ? record.ifsc : null,
    holderName:
      typeof record.holderName === 'string' ? record.holderName : null,
    bankName: typeof record.bankName === 'string' ? record.bankName : null,
    branch: typeof record.branch === 'string' ? record.branch : null,
    city: typeof record.city === 'string' ? record.city : null,
    verificationStatus: String(record.verificationStatus ?? 'unverified'),
    verifiedAt:
      typeof record.verifiedAt === 'string' ? record.verifiedAt : null,
    payoutsEnabled: record.payoutsEnabled === true,
  };
}

function mapIfsc(raw: unknown, fallback: string): IfscLookup {
  const record = asRecord(raw);
  return {
    ifsc: String(record.ifsc ?? fallback).toUpperCase(),
    bank: String(record.bank ?? record.BANK ?? ''),
    branch: String(record.branch ?? record.BRANCH ?? ''),
    city: String(record.city ?? record.CITY ?? ''),
  };
}

export const restaurantOnboardingApi = {
  /** GET /restaurants/:id/onboarding */
  getOnboarding: async (restaurantId: string): Promise<OnboardingStatus> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/onboarding`
      );
      return mapStatus(res.data?.data ?? res.data);
    } catch (error) {
      throwOnboardingError(error, 'Failed to load onboarding');
    }
  },

  /** GET /restaurants/:id/onboarding/documents */
  getDocuments: async (restaurantId: string): Promise<KycDocumentsList> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/onboarding/documents`
      );
      return mapDocuments(res.data?.data ?? res.data);
    } catch (error) {
      throwOnboardingError(error, 'Failed to load KYC documents');
    }
  },

  /** POST /restaurants/:id/onboarding/documents */
  uploadDocuments: async (
    restaurantId: string,
    payload: UploadKycPayload
  ): Promise<KycDocumentsList> => {
    const fields: Record<string, string> = {};
    if (payload.fssaiLicense?.trim()) {
      fields.fssaiLicense = payload.fssaiLicense.trim();
    }
    if (payload.gstin?.trim()) {
      fields.gstin = payload.gstin.trim().toUpperCase();
    }
    if (payload.panNumber?.trim()) {
      fields.panNumber = payload.panNumber.trim().toUpperCase();
    }

    const files: Array<{
      fieldName: string;
      file: { uri: string; name: string; type: string };
    }> = [];
    const pushFile = (
      fieldName: string,
      file?: { uri: string; fileName: string; mimeType: string }
    ) => {
      if (!file) return;
      files.push({
        fieldName,
        file: {
          uri: file.uri,
          name: file.fileName,
          type: file.mimeType,
        },
      });
    };
    pushFile('fssai', payload.fssai);
    pushFile('gst', payload.gst);
    pushFile('pan', payload.pan);
    pushFile('cancelledCheque', payload.cancelledCheque);
    for (const photo of payload.outletPhotos ?? []) {
      pushFile('outletPhotos', photo);
    }

    if (!Object.keys(fields).length && !files.length) {
      throw new PartnerApiError(
        'Add a license number or a document photo first.',
        'VALIDATION_ERROR'
      );
    }

    try {
      const data = await postMultipartWithFields(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/onboarding/documents`,
        { fields, files }
      );
      return mapDocuments(data);
    } catch (error) {
      throwOnboardingError(error, 'Could not upload documents');
    }
  },

  /** POST /restaurants/:id/onboarding/submit */
  submit: async (restaurantId: string): Promise<KycSubmitResult> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/onboarding/submit`,
        {}
      );
      const raw = asRecord(res.data?.data ?? res.data);
      return {
        restaurantId: String(raw.restaurantId ?? restaurantId),
        listingStatus: parseListingStatus(
          typeof raw.listingStatus === 'string' ? raw.listingStatus : 'pending'
        ),
        kycStatus: (String(raw.kycStatus ?? 'submitted') ||
          'submitted') as KycSubmissionStatus,
        submittedAt:
          typeof raw.submittedAt === 'string' ? raw.submittedAt : null,
        canSubmit: raw.canSubmit === true,
      };
    } catch (error) {
      throwOnboardingError(error, 'Could not submit for review');
    }
  },

  /** GET /restaurants/:id/bank */
  getBank: async (restaurantId: string): Promise<RestaurantBank> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/bank`
      );
      return mapBank(res.data?.data ?? res.data);
    } catch (error) {
      throwOnboardingError(error, 'Failed to load bank details');
    }
  },

  /** PUT /restaurants/:id/bank — always unverified until ops verify. */
  updateBank: async (
    restaurantId: string,
    payload: UpdateBankPayload
  ): Promise<RestaurantBank> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/bank`,
        {
          accountNo: payload.accountNo.replace(/\s/g, ''),
          ifsc: payload.ifsc.replace(/\s/g, '').toUpperCase(),
          holderName: payload.holderName.trim(),
        }
      );
      return mapBank(res.data?.data ?? res.data);
    } catch (error) {
      throwOnboardingError(error, 'Could not save bank details');
    }
  },

  /** GET /restaurants/:id/bank/ifsc/:ifsc */
  lookupIfsc: async (
    restaurantId: string,
    ifsc: string
  ): Promise<IfscLookup> => {
    const code = ifsc.replace(/\s/g, '').toUpperCase();
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${encodeURIComponent(restaurantId)}/bank/ifsc/${encodeURIComponent(code)}`
      );
      return mapIfsc(res.data?.data ?? res.data, code);
    } catch (error) {
      throwOnboardingError(error, 'Could not look up IFSC');
    }
  },
};
