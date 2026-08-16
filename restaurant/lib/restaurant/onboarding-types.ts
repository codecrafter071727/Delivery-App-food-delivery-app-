export type KycDocType =
  | 'fssai'
  | 'gst'
  | 'pan'
  | 'cancelledCheque'
  | 'outletPhoto';

export type KycDocStatus = 'uploaded' | 'verified' | 'rejected';

export type KycSubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'rejected';

export type OnboardingStepKey =
  | 'profile'
  | 'address'
  | 'fssai'
  | 'gst'
  | 'pan'
  | 'bank'
  | 'photos'
  | 'menu';

export type OnboardingStep = {
  key: OnboardingStepKey;
  label: string;
  required: boolean;
  done: boolean;
  detail?: string | null;
};

export type OnboardingStatus = {
  restaurantId: string;
  listingStatus: string;
  kycStatus: KycSubmissionStatus;
  submittedAt: string | null;
  rejectReason: string | null;
  steps: OnboardingStep[];
  percent: number;
  canSubmit: boolean;
  blockers: string[];
};

export type KycDocument = {
  id: string;
  type: KycDocType;
  status: KycDocStatus;
  url?: string;
  numberMasked: string | null;
  rejectReason: string | null;
  uploadedAt?: string;
  verifiedAt: string | null;
};

export type KycDocumentsList = {
  restaurantId: string;
  kycStatus: KycSubmissionStatus;
  fssaiMasked: string | null;
  gstinMasked: string | null;
  panMasked: string | null;
  documents: KycDocument[];
};

export type RestaurantBank = {
  accountMasked: string | null;
  ifsc: string | null;
  holderName: string | null;
  bankName: string | null;
  branch: string | null;
  city: string | null;
  verificationStatus: 'unverified' | 'verified' | 'failed' | string;
  verifiedAt: string | null;
  payoutsEnabled: boolean;
};

export type IfscLookup = {
  ifsc: string;
  bank: string;
  branch: string;
  city: string;
};

export type KycSubmitResult = {
  restaurantId: string;
  listingStatus: string;
  kycStatus: KycSubmissionStatus;
  submittedAt: string | null;
  canSubmit: boolean;
};

export type UpdateBankPayload = {
  accountNo: string;
  ifsc: string;
  holderName: string;
};

export type UploadKycPayload = {
  fssaiLicense?: string;
  gstin?: string;
  panNumber?: string;
  fssai?: { uri: string; fileName: string; mimeType: string };
  gst?: { uri: string; fileName: string; mimeType: string };
  pan?: { uri: string; fileName: string; mimeType: string };
  cancelledCheque?: { uri: string; fileName: string; mimeType: string };
  outletPhotos?: { uri: string; fileName: string; mimeType: string }[];
};

export const KYC_FILE = {
  maxBytes: 8 * 1024 * 1024,
  maxOutletPhotos: 8,
  mimeTypes: [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'application/pdf',
  ] as const,
} as const;

export const FSSAI_RE = /^\d{14}$/;
export const GSTIN_RE =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
