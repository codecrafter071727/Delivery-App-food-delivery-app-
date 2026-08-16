import axios from 'axios';
import { Platform } from 'react-native';

import { API_BASE_URL, api, assertApiBaseUrl } from '@/lib/api';
import {
  isValidAccount,
  isValidGstin,
  isValidIfsc,
  isValidPan,
  normalizeIfsc,
  type PartnerBank,
  type PartnerBankOtpResult,
  type PartnerIfscLookup,
  type PartnerTaxDetails,
  type PartnerTaxDocument,
  type SavePartnerBankPayload,
  type UpdateTaxDetailsPayload,
} from '@/lib/delivery-partner/bank-types';
import {
  getApiErrorCode,
  getApiErrorMessage,
  PartnerApiError,
} from '@/lib/errors';

const ME_BASE = '/api/v1/delivery-service/partners/me';

export const BANK_ERROR_COPY: Record<string, string> = {
  USE_BANK_API: 'Bank details are saved from Payout, not profile edit.',
  INVALID_IFSC: 'That IFSC is invalid or unknown.',
  IFSC_LOOKUP_UNAVAILABLE: 'Could not look up this IFSC. Try again in a moment.',
  PHONE_REQUIRED: 'Add a phone number on your partner profile before changing bank.',
  OTP_NOT_NEEDED: 'First-time bank add does not need an OTP.',
  OTP_REQUIRED: 'Enter the OTP sent to your registered phone.',
  OTP_EXPIRED: 'That OTP expired. Request a new one.',
  INVALID_OTP: 'That code is wrong. Try again.',
  OTP_LOCKED: 'Too many wrong attempts. Wait and request a new OTP.',
  OTP_COOLDOWN: 'Wait a minute before requesting another OTP.',
  OTP_RATE_LIMITED: 'Too many OTP requests. Try again in an hour.',
  OTP_UNAVAILABLE: 'SMS is temporarily unavailable. Try again later.',
  INVALID_ACCOUNT: 'Enter a 9–18 digit account number.',
  BANK_DETAILS_REQUIRED: 'Save your bank account first.',
  VERIFY_IN_PROGRESS: 'Verification already running. Wait two minutes.',
  BANK_VERIFY_UNAVAILABLE:
    'Penny-drop verification is unavailable right now. Your account is saved; try Verify later.',
  INVALID_PAN: 'Enter a valid PAN (AAAAA9999A).',
  INVALID_GSTIN: 'Enter a valid 15-character GSTIN.',
  PAN_REQUIRED: 'PAN is required for tax.',
  TAX_DOCUMENT_NOT_FOUND: 'That tax document is not available yet.',
};

export function formatBankError(error: unknown, fallback: string): string {
  const code = getApiErrorCode(error);
  if (code && BANK_ERROR_COPY[code]) return BANK_ERROR_COPY[code];
  return getApiErrorMessage(error, fallback);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unwrap(payload: unknown): unknown {
  const record = asRecord(payload);
  if ('data' in record) return record.data;
  return payload;
}

function pickString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickBool(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === 'true') return true;
    if (value === 0 || value === 'false') return false;
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

function extractErrorCode(data: unknown): string | undefined {
  const payload = asRecord(data);
  const nested = asRecord(payload.data);
  const errorObj = asRecord(
    typeof payload.error === 'object' ? payload.error : undefined
  );
  const code =
    pickString(nested, ['code']) ??
    pickString(payload, ['code']) ??
    pickString(errorObj, ['code']);
  return code ? code.toUpperCase().replace(/[\s-]+/g, '_') : undefined;
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    responseType?: 'json' | 'arraybuffer';
  } = {}
): Promise<T> {
  const { method = 'GET', body, responseType } = options;
  assertApiBaseUrl();
  try {
    const response = await api.request<T>({
      url: path,
      method,
      data: method === 'GET' ? undefined : (body ?? {}),
      responseType: responseType === 'arraybuffer' ? 'arraybuffer' : undefined,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && !error.response) {
      throw new PartnerApiError(
        `Cannot reach ${API_BASE_URL}. Check Wi‑Fi and try again.`,
        'NETWORK_ERROR'
      );
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const code =
        extractErrorCode(error.response?.data) ??
        getApiErrorCode(error) ??
        (status === 404 ? 'NOT_FOUND' : undefined);
      throw new PartnerApiError(
        formatBankError(error, `Request failed (${status ?? 0})`),
        code
      );
    }
    throw error;
  }
}

function mapIfsc(raw: unknown): PartnerIfscLookup {
  const record = asRecord(unwrap(raw));
  const ifsc = pickString(record, ['ifsc', 'IFSC']) ?? '';
  return {
    ifsc,
    bank: pickString(record, ['bank', 'bankName', 'BANK']) ?? '',
    branch: pickString(record, ['branch', 'BRANCH']),
    city: pickString(record, ['city', 'CITY']),
  };
}

function mapBank(raw: unknown): PartnerBank {
  const record = asRecord(unwrap(raw));
  const status =
    pickString(record, ['verificationStatus', 'status', 'verifyStatus']) ??
    'unverified';
  const accountMasked = pickString(record, [
    'accountMasked',
    'accountNoMasked',
    'bankAccountNo',
    'accountNumber',
  ]);
  return {
    accountMasked,
    ifsc: pickString(record, ['ifsc', 'ifscCode'])?.toUpperCase(),
    holderName: pickString(record, ['holderName', 'accountHolderName', 'name']),
    bankName: pickString(record, ['bankName', 'bank']),
    branch: pickString(record, ['branch']),
    city: pickString(record, ['city']),
    verificationStatus: status.toLowerCase(),
    verifiedAt: pickString(record, ['verifiedAt']) ?? null,
    nameAtBank: pickString(record, ['nameAtBank']) ?? null,
    nameMatch: pickBool(record, ['nameMatch']) ?? null,
    payoutsEnabled: pickBool(record, ['payoutsEnabled', 'payoutEnabled']) ??
      status.toLowerCase() === 'verified',
    lastVerifiedAt: pickString(record, ['lastVerifiedAt']) ?? null,
    hasAccount: Boolean(accountMasked || pickString(record, ['ifsc', 'ifscCode'])),
  };
}

function mapOtp(raw: unknown): PartnerBankOtpResult {
  const record = asRecord(unwrap(raw));
  return {
    sentTo: pickString(record, ['sentTo', 'phoneMasked', 'phone']),
    expiresInSeconds: pickNumber(record, ['expiresInSeconds', 'ttl']) ?? 600,
    resendAfterSeconds:
      pickNumber(record, ['resendAfterSeconds', 'cooldownSeconds']) ?? 60,
    message: pickString(record, ['message']),
  };
}

function mapTax(raw: unknown): PartnerTaxDetails {
  const record = asRecord(unwrap(raw));
  const panMasked = pickString(record, ['panMasked', 'pan', 'panNumber']);
  return {
    panMasked,
    panName: pickString(record, ['panName']),
    gstinMasked: pickString(record, ['gstinMasked', 'gstin']),
    gstLegalName: pickString(record, ['gstLegalName']),
    tdsRate: pickNumber(record, ['tdsRate']),
    updatedAt: pickString(record, ['updatedAt']) ?? null,
    hasPan: Boolean(panMasked),
  };
}

function mapTaxDocument(raw: unknown): PartnerTaxDocument | null {
  const record = asRecord(raw);
  const documentId =
    pickString(record, ['documentId', 'id', '_id']) ?? '';
  if (!documentId) return null;
  return {
    documentId,
    kind: pickString(record, ['kind', 'type']) ?? 'tax',
    title: pickString(record, ['title', 'name']) ?? documentId,
    period: pickString(record, ['period']),
    periodLabel: pickString(record, ['periodLabel', 'label']),
    from: pickString(record, ['from']),
    to: pickString(record, ['to']),
    grossEarnings: pickNumber(record, ['grossEarnings', 'gross']),
    tdsAmount: pickNumber(record, ['tdsAmount', 'tds']),
    generatedAt: pickString(record, ['generatedAt', 'createdAt']),
    downloadPath: pickString(record, ['downloadPath', 'url', 'path']),
  };
}

export const partnerBankApi = {
  /** GET /partners/me/bank/ifsc/:ifsc */
  lookupIfsc: async (ifsc: string): Promise<PartnerIfscLookup> => {
    const code = normalizeIfsc(ifsc);
    if (!isValidIfsc(code)) {
      throw new PartnerApiError('Enter an 11-character IFSC.', 'INVALID_IFSC');
    }
    const data = await request<unknown>(
      `${ME_BASE}/bank/ifsc/${encodeURIComponent(code)}`
    );
    const mapped = mapIfsc(data);
    if (!mapped.bank && !mapped.ifsc) {
      throw new PartnerApiError('Unknown IFSC.', 'INVALID_IFSC');
    }
    return { ...mapped, ifsc: mapped.ifsc || code };
  },

  /** POST /partners/me/bank/otp — no body */
  sendBankOtp: async (): Promise<PartnerBankOtpResult> => {
    const data = await request<unknown>(`${ME_BASE}/bank/otp`, {
      method: 'POST',
      body: {},
    });
    return mapOtp(data);
  },

  /** GET /partners/me/bank — 404 BANK_DETAILS_REQUIRED → null */
  getBank: async (): Promise<PartnerBank | null> => {
    try {
      const data = await request<unknown>(`${ME_BASE}/bank`);
      const mapped = mapBank(data);
      return mapped;
    } catch (error) {
      const code = getApiErrorCode(error);
      if (
        code === 'BANK_DETAILS_REQUIRED' ||
        code === 'NOT_FOUND' ||
        code === 'RESOURCE_NOT_FOUND'
      ) {
        return null;
      }
      const message = String(
        error instanceof Error ? error.message : error
      ).toLowerCase();
      if (message.includes('not found') || message.includes('404')) return null;
      throw error;
    }
  },

  /** PUT /partners/me/bank */
  saveBank: async (payload: SavePartnerBankPayload): Promise<PartnerBank> => {
    const accountNo = payload.accountNo.replace(/\s/g, '');
    const ifsc = normalizeIfsc(payload.ifsc);
    const holderName = payload.holderName.trim();
    if (!isValidAccount(accountNo)) {
      throw new PartnerApiError(
        'Enter a 9–18 digit account number.',
        'INVALID_ACCOUNT'
      );
    }
    if (!isValidIfsc(ifsc)) {
      throw new PartnerApiError('Enter a valid IFSC.', 'INVALID_IFSC');
    }
    if (holderName.length < 2) {
      throw new PartnerApiError('Enter the account holder name.', 'VALIDATION_ERROR');
    }
    const body: Record<string, unknown> = { accountNo, ifsc, holderName };
    if (payload.otp?.trim()) body.otp = payload.otp.trim();
    const data = await request<unknown>(`${ME_BASE}/bank`, {
      method: 'PUT',
      body,
    });
    return mapBank(data);
  },

  /** POST /partners/me/bank/verify */
  verifyBank: async (): Promise<PartnerBank> => {
    const data = await request<unknown>(`${ME_BASE}/bank/verify`, {
      method: 'POST',
      body: {},
    });
    return mapBank(data);
  },

  /** GET /partners/me/tax-details */
  getTaxDetails: async (): Promise<PartnerTaxDetails> => {
    try {
      const data = await request<unknown>(`${ME_BASE}/tax-details`);
      return mapTax(data);
    } catch (error) {
      const code = getApiErrorCode(error);
      if (code === 'NOT_FOUND' || String(error).toLowerCase().includes('404')) {
        return { hasPan: false, tdsRate: 0.01 };
      }
      throw error;
    }
  },

  /** PUT /partners/me/tax-details */
  updateTaxDetails: async (
    payload: UpdateTaxDetailsPayload
  ): Promise<PartnerTaxDetails> => {
    const panNumber = payload.panNumber.replace(/\s/g, '').toUpperCase();
    if (!isValidPan(panNumber)) {
      throw new PartnerApiError('Enter a valid PAN (AAAAA9999A).', 'INVALID_PAN');
    }
    const gstin = payload.gstin?.replace(/\s/g, '').toUpperCase() ?? '';
    if (gstin && !isValidGstin(gstin)) {
      throw new PartnerApiError('Enter a valid GSTIN.', 'INVALID_GSTIN');
    }
    const body: Record<string, unknown> = {
      panNumber,
      panName: (payload.panName ?? '').trim(),
    };
    if (gstin) body.gstin = gstin;
    if (payload.gstLegalName?.trim()) {
      body.gstLegalName = payload.gstLegalName.trim();
    }
    const data = await request<unknown>(`${ME_BASE}/tax-details`, {
      method: 'PUT',
      body,
    });
    return mapTax(data);
  },

  /** GET /partners/me/tax-documents */
  listTaxDocuments: async (): Promise<PartnerTaxDocument[]> => {
    const data = await request<unknown>(`${ME_BASE}/tax-documents`);
    const record = asRecord(unwrap(data));
    const rows = Array.isArray(record.documents)
      ? record.documents
      : Array.isArray(unwrap(data))
        ? (unwrap(data) as unknown[])
        : [];
    return rows
      .map((row) => mapTaxDocument(row))
      .filter((row): row is PartnerTaxDocument => Boolean(row));
  },

  /** GET /partners/me/tax-documents/:documentId/download */
  downloadTaxDocument: async (
    documentId: string
  ): Promise<{ filename: string; bytes: ArrayBuffer }> => {
    const id = documentId.trim();
    if (!id) {
      throw new PartnerApiError('Missing tax document.', 'TAX_DOCUMENT_NOT_FOUND');
    }
    const path = `${ME_BASE}/tax-documents/${encodeURIComponent(id)}/download`;
    const bytes = await request<ArrayBuffer>(path, {
      method: 'GET',
      responseType: 'arraybuffer',
    });
    return { filename: `${id}.pdf`, bytes };
  },
};

export async function saveTaxPdfOnDevice(
  filename: string,
  bytes: ArrayBuffer
): Promise<string | null> {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    return url;
  }

  try {
    const FileSystem = await import('expo-file-system/legacy');
    const binary = arrayBufferToBase64(bytes);
    const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, binary, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return uri;
  } catch {
    return null;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') return btoa(binary);
  throw new Error('Could not encode PDF');
}
