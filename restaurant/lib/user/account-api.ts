import axios from 'axios';

import { API_BASE_URL, api, assertApiBaseUrl } from '@/lib/api';
import { formatAuthError } from '@/lib/auth/api';
import { postMultipartWithFields } from '@/lib/multipart-upload';
import type { UploadFilePart } from '@/lib/multipart-upload';
import {
  getApiErrorCode,
  getApiErrorMessage,
  PartnerApiError,
} from '@/lib/errors';
import {
  DEFAULT_LANGUAGES,
  type DeletePreview,
  type NotificationPrefs,
  type PlatformUser,
  type UpdateNamePayload,
  type UserPreferences,
} from '@/lib/user/account-types';

const USERS_ME = '/api/v1/user-service/users/me';

export const ACCOUNT_ERROR_COPY: Record<string, string> = {
  ACCOUNT_HAS_OPEN_ORDERS:
    'Finish or cancel open orders before deleting your account.',
  ORDER_SERVICE_UNAVAILABLE:
    'Could not check open orders. Try again in a moment.',
  EMAIL_IN_USE: 'That email is already used by another account.',
  PHONE_IN_USE: 'That phone number is already used by another account.',
  OTP_REQUIRED: 'Enter the OTP sent to continue.',
  INVALID_OTP: 'That code is wrong or expired. Request a new one.',
  OTP_COOLDOWN: 'Wait a few seconds before requesting another code.',
  ACTIVE_DELIVERY: 'Complete your active delivery before deleting your account.',
};

export function formatAccountError(error: unknown, fallback: string): string {
  const code = getApiErrorCode(error);
  if (code && ACCOUNT_ERROR_COPY[code]) return ACCOUNT_ERROR_COPY[code];
  const auth = formatAuthError(error, '');
  if (auth) return auth;
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
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
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
  const code = pickString(nested, ['code']) ?? pickString(payload, ['code']);
  return code ? code.toUpperCase().replace(/[\s-]+/g, '_') : undefined;
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const { method = 'GET', body } = options;
  assertApiBaseUrl();
  try {
    const response = await api.request<T>({
      url: path,
      method,
      data: method === 'GET' || method === 'DELETE' ? body : (body ?? {}),
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
      throw new PartnerApiError(
        formatAccountError(
          error,
          `Request failed (${error.response?.status ?? 0})`
        ),
        extractErrorCode(error.response?.data) ?? getApiErrorCode(error)
      );
    }
    throw error;
  }
}

export function mapPlatformUser(raw: unknown): PlatformUser {
  const record = asRecord(unwrap(raw));
  const nested = asRecord(record.user);
  const source = Object.keys(nested).length ? { ...record, ...nested } : record;
  const id = pickString(source, ['_id', 'id', 'userId']) ?? '';
  return {
    id,
    email: pickString(source, ['email']) ?? '',
    firstName: pickString(source, ['firstName', 'givenName']),
    lastName: pickString(source, ['lastName', 'familyName']),
    phone: pickString(source, ['phone', 'mobile', 'phoneNumber']),
    photoUrl: pickString(source, [
      'photoUrl',
      'avatarUrl',
      'profilePhoto',
      'picture',
      'avatar',
    ]),
    emailVerified: pickBool(source, [
      'emailVerified',
      'isEmailVerified',
    ]) ?? false,
    phoneVerified: pickBool(source, ['phoneVerified', 'isPhoneVerified']),
    language: pickString(source, ['language', 'locale'])?.toLowerCase(),
    role: pickString(source, ['role', 'userType']),
  };
}

function mapNotifications(raw: unknown): NotificationPrefs {
  const record = asRecord(unwrap(raw));
  const nested = asRecord(record.notifications ?? record);
  return {
    push: pickBool(nested, ['push', 'pushEnabled', 'mobile']) ?? true,
    sms: pickBool(nested, ['sms', 'smsEnabled']) ?? true,
    email: pickBool(nested, ['email', 'emailEnabled']) ?? true,
  };
}

function mapPreferences(raw: unknown): UserPreferences {
  const record = asRecord(unwrap(raw));
  const language =
    pickString(record, ['language', 'locale'])?.toLowerCase() ??
    pickString(asRecord(record.preferences), ['language'])?.toLowerCase() ??
    'en';
  const listRaw =
    record.languages ??
    record.allowedLanguages ??
    asRecord(record.preferences).languages;
  const languages = Array.isArray(listRaw)
    ? listRaw
        .map((row) => String(row).trim().toLowerCase())
        .filter(Boolean)
    : [...DEFAULT_LANGUAGES];
  return {
    notifications: mapNotifications(record.notifications ?? record),
    language: language || 'en',
    languages: languages.length ? languages : [...DEFAULT_LANGUAGES],
  };
}

function mapDeletePreview(raw: unknown): DeletePreview {
  const record = asRecord(unwrap(raw));
  return {
    openOrders: pickNumber(record, ['openOrders', 'activeOrders']) ?? 0,
    walletBalance: pickNumber(record, ['walletBalance', 'wallet']) ?? 0,
    activeSubscription: pickBool(record, ['activeSubscription']) ?? false,
    canDelete: pickBool(record, ['canDelete', 'allowed']) ?? true,
    warn: pickString(record, ['warn', 'message', 'reason']) ?? null,
  };
}

export const userAccountApi = {
  /** GET /users/me */
  getMe: async (): Promise<PlatformUser> => {
    const data = await request<unknown>(USERS_ME);
    const user = mapPlatformUser(data);
    if (!user.id && !user.email && !user.phone) {
      throw new PartnerApiError('Could not load your account.', 'USER_NOT_FOUND');
    }
    return user;
  },

  /** PUT /users/me — name only */
  updateName: async (payload: UpdateNamePayload): Promise<PlatformUser> => {
    const firstName = payload.firstName.trim();
    if (firstName.length < 2) {
      throw new PartnerApiError('Enter your first name.', 'VALIDATION_ERROR');
    }
    const data = await request<unknown>(USERS_ME, {
      method: 'PUT',
      body: {
        firstName,
        lastName: (payload.lastName ?? '').trim(),
      },
    });
    return mapPlatformUser(data);
  },

  /** GET /users/me/delete-preview */
  getDeletePreview: async (): Promise<DeletePreview> => {
    const data = await request<unknown>(`${USERS_ME}/delete-preview`);
    return mapDeletePreview(data);
  },

  /** DELETE /users/me */
  deleteAccount: async (payload?: { otp?: string; reason?: string }) => {
    const body: Record<string, unknown> = { confirm: true };
    if (payload?.otp?.trim()) body.otp = payload.otp.trim();
    if (payload?.reason?.trim()) body.reason = payload.reason.trim();
    await request<unknown>(USERS_ME, { method: 'DELETE', body });
  },

  /** POST /users/me/profile-photo */
  uploadPhoto: async (file: UploadFilePart): Promise<PlatformUser> => {
    const fields = ['photo', 'file', 'avatar'] as const;
    let lastError: unknown;
    for (const fieldName of fields) {
      try {
        const uploaded = await postMultipartWithFields(`${USERS_ME}/profile-photo`, {
          files: [{ fieldName, file }],
        });
        const mapped = mapPlatformUser(uploaded);
        if (mapped.photoUrl || mapped.id) return mapped;
        return userAccountApi.getMe();
      } catch (error) {
        lastError = error;
        const message = String(
          error instanceof Error ? error.message : error
        ).toLowerCase();
        if (!message.includes('unexpected field') && !message.includes('multer')) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new PartnerApiError('Could not upload photo.', 'UPLOAD_FAILED');
  },

  /** DELETE /users/me/profile-photo */
  deletePhoto: async (): Promise<PlatformUser> => {
    const data = await request<unknown>(`${USERS_ME}/profile-photo`, {
      method: 'DELETE',
      body: {},
    });
    const mapped = mapPlatformUser(data);
    if (mapped.id || mapped.email) return mapped;
    return userAccountApi.getMe();
  },

  /** GET /users/me/preferences */
  getPreferences: async (): Promise<UserPreferences> => {
    const data = await request<unknown>(`${USERS_ME}/preferences`);
    return mapPreferences(data);
  },

  /** PUT /users/me/preferences/notifications */
  updateNotifications: async (
    payload: NotificationPrefs
  ): Promise<UserPreferences> => {
    const data = await request<unknown>(
      `${USERS_ME}/preferences/notifications`,
      {
        method: 'PUT',
        body: {
          push: payload.push,
          sms: payload.sms,
          email: payload.email,
        },
      }
    );
    return mapPreferences(data);
  },

  /** PUT /users/me/preferences/language */
  updateLanguage: async (language: string): Promise<UserPreferences> => {
    const code = language.trim().toLowerCase();
    if (!code) {
      throw new PartnerApiError('Choose a language.', 'VALIDATION_ERROR');
    }
    const data = await request<unknown>(`${USERS_ME}/preferences/language`, {
      method: 'PUT',
      body: { language: code },
    });
    return mapPreferences(data);
  },

  /** PUT /users/me/phone — OTP required */
  updatePhone: async (payload: {
    phone: string;
    otp: string;
  }): Promise<PlatformUser> => {
    const phone = payload.phone.trim();
    const otp = payload.otp.trim();
    if (!phone) throw new PartnerApiError('Enter a phone number.', 'VALIDATION_ERROR');
    if (!otp) throw new PartnerApiError('Enter the OTP.', 'OTP_REQUIRED');
    const data = await request<unknown>(`${USERS_ME}/phone`, {
      method: 'PUT',
      body: { phone, otp },
    });
    return mapPlatformUser(data);
  },

  /** PUT /users/me/email */
  updateEmail: async (payload: {
    email: string;
    otp?: string;
  }): Promise<PlatformUser> => {
    const email = payload.email.trim().toLowerCase();
    if (!email) throw new PartnerApiError('Enter an email.', 'VALIDATION_ERROR');
    const body: Record<string, unknown> = { email };
    if (payload.otp?.trim()) body.otp = payload.otp.trim();
    const data = await request<unknown>(`${USERS_ME}/email`, {
      method: 'PUT',
      body,
    });
    return mapPlatformUser(data);
  },
};
