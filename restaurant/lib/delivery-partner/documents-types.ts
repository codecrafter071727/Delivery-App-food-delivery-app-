/**
 * Partner KYC documents — `docType` values match POST /partners/me/documents.
 * Canonical keys: aadhar, pan, drivingLicense, vehicleRC, insurance, bankPassbook
 */

export type PartnerDocumentStatus =
  | 'not_uploaded'
  | 'pending'
  | 'verified'
  | 'rejected'
  | string;

export type PartnerDocumentType =
  | 'aadhar'
  | 'pan'
  | 'drivingLicense'
  | 'vehicleRC'
  | 'insurance'
  | 'bankPassbook'
  | 'profilePhoto';

export type PartnerDocument = {
  type: PartnerDocumentType;
  status: PartnerDocumentStatus;
  url?: string;
  rejectionReason?: string;
  uploadedAt?: string;
  verifiedAt?: string;
  raw?: Record<string, unknown>;
};

export type PartnerDocumentsMap = Partial<
  Record<PartnerDocumentType, PartnerDocument>
>;

export const PARTNER_DOC_TYPES: {
  type: PartnerDocumentType;
  label: string;
  hint: string;
}[] = [
  {
    type: 'aadhar',
    label: 'Aadhaar Card',
    hint: 'Upload front & back as a single image',
  },
  {
    type: 'pan',
    label: 'PAN Card',
    hint: 'Clear photo of your PAN card',
  },
  {
    type: 'drivingLicense',
    label: 'Driving License',
    hint: 'Valid driving license (front side)',
  },
  {
    type: 'vehicleRC',
    label: 'Vehicle RC',
    hint: 'Vehicle registration certificate',
  },
  {
    type: 'insurance',
    label: 'Vehicle Insurance',
    hint: 'Valid insurance document',
  },
  {
    type: 'bankPassbook',
    label: 'Bank Passbook',
    hint: 'First page showing account details',
  },
];

/** Alternate API / legacy keys → canonical docType sent on upload */
export const DOC_TYPE_ALIASES: Record<string, PartnerDocumentType> = {
  aadhar: 'aadhar',
  aadhaar: 'aadhar',
  aadhaar_card: 'aadhar',
  aadhar_card: 'aadhar',
  pan: 'pan',
  pan_card: 'pan',
  drivingLicense: 'drivingLicense',
  driving_license: 'drivingLicense',
  license: 'drivingLicense',
  dl: 'drivingLicense',
  vehicleRC: 'vehicleRC',
  vehicle_rc: 'vehicleRC',
  rc: 'vehicleRC',
  registration: 'vehicleRC',
  insurance: 'insurance',
  vehicle_insurance: 'insurance',
  vehicleInsurance: 'insurance',
  bankPassbook: 'bankPassbook',
  bank_passbook: 'bankPassbook',
  passbook: 'bankPassbook',
  bank: 'bankPassbook',
  profilePhoto: 'profilePhoto',
  profile_photo: 'profilePhoto',
  avatar: 'profilePhoto',
  photo: 'profilePhoto',
};

const CANONICAL_DOC_TYPES: PartnerDocumentType[] = [
  ...PARTNER_DOC_TYPES.map((d) => d.type),
  'profilePhoto',
];

export function normalizeDocType(value: string): PartnerDocumentType | null {
  const key = value.trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  return (
    DOC_TYPE_ALIASES[key] ??
    DOC_TYPE_ALIASES[lower] ??
    (CANONICAL_DOC_TYPES.includes(key as PartnerDocumentType)
      ? (key as PartnerDocumentType)
      : null)
  );
}

export function normalizeDocStatus(status?: string): PartnerDocumentStatus {
  if (!status?.trim()) return 'not_uploaded';
  const s = status.trim().toLowerCase().replace(/\s+/g, '_');
  if (
    s === 'verified' ||
    s === 'approved' ||
    s === 'accepted' ||
    s === 'complete' ||
    s === 'completed'
  ) {
    return 'verified';
  }
  if (
    s === 'pending' ||
    s === 'under_review' ||
    s === 'review' ||
    s === 'submitted' ||
    s === 'uploaded' ||
    s === 'in_review'
  ) {
    return 'pending';
  }
  if (
    s === 'rejected' ||
    s === 'declined' ||
    s === 'failed' ||
    s === 'invalid'
  ) {
    return 'rejected';
  }
  if (
    s === 'not_uploaded' ||
    s === 'missing' ||
    s === 'none' ||
    s === 'empty'
  ) {
    return 'not_uploaded';
  }
  return s;
}

export function countVerifiedDocuments(docs?: PartnerDocumentsMap) {
  if (!docs) return 0;
  return PARTNER_DOC_TYPES.filter(
    (d) => normalizeDocStatus(docs[d.type]?.status) === 'verified'
  ).length;
}

/**
 * Display status for UI: pending without a file is shown as not uploaded.
 */
export function displayDocumentStatus(
  doc?: PartnerDocument | null
): PartnerDocumentStatus {
  if (!doc) return 'not_uploaded';
  const status = normalizeDocStatus(doc.status);
  const hasFile = Boolean(doc.url || doc.uploadedAt);
  if (!hasFile && (status === 'pending' || status === 'verified')) {
    return 'not_uploaded';
  }
  return status;
}
