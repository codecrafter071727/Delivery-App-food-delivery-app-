export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;

export type BankVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'failed'
  | string;

export type PartnerIfscLookup = {
  ifsc: string;
  bank: string;
  branch?: string;
  city?: string;
};

export type PartnerBankOtpResult = {
  sentTo?: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  message?: string;
};

export type PartnerBank = {
  accountMasked?: string;
  ifsc?: string;
  holderName?: string;
  bankName?: string;
  branch?: string;
  city?: string;
  verificationStatus: BankVerificationStatus;
  verifiedAt?: string | null;
  nameAtBank?: string | null;
  nameMatch?: boolean | null;
  payoutsEnabled: boolean;
  lastVerifiedAt?: string | null;
  hasAccount: boolean;
};

export type SavePartnerBankPayload = {
  accountNo: string;
  ifsc: string;
  holderName: string;
  otp?: string;
};

export type PartnerTaxDetails = {
  panMasked?: string;
  panName?: string;
  gstinMasked?: string;
  gstLegalName?: string;
  tdsRate?: number;
  updatedAt?: string | null;
  hasPan: boolean;
};

export type UpdateTaxDetailsPayload = {
  panNumber: string;
  panName?: string;
  gstin?: string;
  gstLegalName?: string;
};

export type PartnerTaxDocument = {
  documentId: string;
  kind: string;
  title: string;
  period?: string;
  periodLabel?: string;
  from?: string;
  to?: string;
  grossEarnings?: number;
  tdsAmount?: number;
  generatedAt?: string;
  downloadPath?: string;
};

export function normalizeIfsc(raw: string) {
  return raw.replace(/\s/g, '').toUpperCase();
}

export function isValidIfsc(raw: string) {
  return IFSC_RE.test(normalizeIfsc(raw));
}

export function isValidAccount(raw: string) {
  return /^\d{9,18}$/.test(raw.replace(/\s/g, ''));
}

export function isValidPan(raw: string) {
  return PAN_RE.test(raw.replace(/\s/g, '').toUpperCase());
}

export function isValidGstin(raw: string) {
  const value = raw.replace(/\s/g, '').toUpperCase();
  if (!value) return true;
  return GSTIN_RE.test(value);
}

export function bankStatusLabel(status?: string) {
  const key = (status ?? 'unverified').toLowerCase();
  if (key === 'verified' || key === 'success') return 'Verified';
  if (key === 'pending' || key === 'in_progress') return 'Verifying';
  if (key === 'failed') return 'Failed';
  return 'Unverified';
}
