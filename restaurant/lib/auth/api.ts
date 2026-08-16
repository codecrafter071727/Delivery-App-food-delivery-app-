import axios from 'axios';

import { API_BASE_URL, api, assertApiBaseUrl } from '@/lib/api';
import { authClientSource, getAuthDeviceId } from '@/lib/auth/device';
import type {
  AppleLoginPayload,
  AuthResponse,
  AuthUser,
  ChangePasswordPayload,
  ForgotPasswordPayload,
  GoogleLoginPayload,
  LoginPayload,
  MessageResponse,
  OtpSendPayload,
  OtpSendResult,
  OtpVerifyPayload,
  PartnerRole,
  RegisterPayload,
  ResetPasswordPayload,
} from '@/lib/auth/types';
import { fromApiRole, toApiRole } from '@/lib/auth/types';
import {
  getApiErrorCode,
  getApiErrorMessage,
  PartnerApiError,
} from '@/lib/errors';

/** Live API mounts auth under user-service (not /auth at root). */
const AUTH_BASE = '/api/v1/user-service/auth';

/** Cookie session auth — no JWT in response body. */
export const SESSION_AUTH_TOKEN = 'session';

function mapApiUser(
  data: Record<string, unknown>,
  fallbackRole: PartnerRole
): AuthUser {
  return {
    id: String(data._id ?? data.id ?? ''),
    email: String(data.email ?? ''),
    firstName: (data.firstName as string) || undefined,
    lastName: (data.lastName as string) || undefined,
    phone: (data.phone as string) || undefined,
    role: fromApiRole(data.role ?? data.userType ?? data.type, fallbackRole),
    emailVerified: Boolean(data.isEmailVerified ?? data.emailVerified ?? false),
  };
}

function normalizeAuthResponse(
  data: unknown,
  fallbackRole: PartnerRole
): AuthResponse {
  const payload = data as Record<string, unknown>;
  const nested = payload.data as Record<string, unknown> | undefined;

  const token =
    (payload.token as string) ||
    (payload.accessToken as string) ||
    (payload.access_token as string) ||
    (payload.jwt as string) ||
    (nested?.token as string) ||
    (nested?.accessToken as string) ||
    ((nested?.tokens as Record<string, unknown> | undefined)?.accessToken as string) ||
    SESSION_AUTH_TOKEN;

  const userSource = (nested?.user ??
    nested ??
    payload.user ??
    payload) as Record<string, unknown>;
  const user = mapApiUser(userSource, fallbackRole);

  if (!user.id) {
    throw new PartnerApiError(
      'Invalid authentication response from server',
      'INVALID_AUTH_RESPONSE'
    );
  }
  if (!user.email) {
    user.email = user.phone || `${user.id}@tokajo.local`;
  }

  return { token, user, message: payload.message as string | undefined };
}

function normalizeMessageResponse(data: unknown): MessageResponse {
  const payload = data as { message?: string; data?: { message?: string } };
  return {
    message: payload.data?.message ?? payload.message ?? 'Success',
  };
}

function pickCooldownSeconds(data: unknown, fallback = 30): number {
  const payload =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const nested =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {};
  const raw = Number(nested.cooldownSeconds ?? payload.cooldownSeconds);
  if (Number.isFinite(raw) && raw > 0) return Math.round(raw);
  return fallback;
}

function normalizeOtpSendResponse(data: unknown): OtpSendResult {
  return {
    message: normalizeMessageResponse(data).message || 'OTP sent',
    cooldownSeconds: pickCooldownSeconds(data, 30),
  };
}

export const AUTH_ERROR_COPY: Record<string, string> = {
  OTP_COOLDOWN: 'Wait a few seconds before requesting another code.',
  OTP_RATE_LIMITED: 'Too many OTP requests. Try again in 15 minutes.',
  SMS_UNAVAILABLE:
    'SMS is temporarily unavailable. Use email OTP or password sign-in.',
  SOCIAL_TOKEN_INVALID: 'Social sign-in failed. Try again.',
  SOCIAL_ACCOUNT_CONFLICT:
    'This Google/Apple account is already linked to another user.',
  SOCIAL_AUTH_UNAVAILABLE: 'Social sign-in is temporarily unavailable.',
  ACCOUNT_SUSPENDED: 'Your account is suspended. Contact support.',
  ACCOUNT_BLOCKED: 'Your account is blocked. Contact support.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  INVALID_OTP: 'That code is wrong or expired. Request a new one.',
  EMAIL_NOT_FOUND: 'No account found for that email.',
  USER_NOT_FOUND: 'No account found. Create one first.',
  EMAIL_ALREADY_EXISTS: 'An account with this email already exists. Sign in.',
  PHONE_ALREADY_EXISTS: 'An account with this phone already exists. Sign in.',
  TOKEN_EXPIRED: 'This link expired. Request a new one.',
  TOKEN_INVALID: 'This link is invalid. Request a new one.',
  CURRENT_PASSWORD_INVALID: 'Current password is incorrect.',
  EMAIL_ALREADY_VERIFIED: 'Your email is already verified.',
};

export function formatAuthError(error: unknown, fallback: string): string {
  const code = getApiErrorCode(error);
  if (code && AUTH_ERROR_COPY[code]) return AUTH_ERROR_COPY[code];
  return getApiErrorMessage(error, fallback);
}

function extractErrorMessage(data: unknown, fallback: string): string {
  const payload = data as {
    message?: string;
    error?: string;
    code?: string;
    errors?: Record<string, string[]> | string[];
  } | null;

  if (payload?.errors) {
    const details = Array.isArray(payload.errors)
      ? payload.errors.filter(Boolean)
      : Object.values(payload.errors).flat().filter(Boolean);
    if (details.length > 0) {
      return details.join('\n');
    }
  }

  const code =
    typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
  if (code && AUTH_ERROR_COPY[code]) return AUTH_ERROR_COPY[code];

  return payload?.message || payload?.error || fallback;
}

function extractErrorCode(data: unknown): string | undefined {
  const payload = data as { code?: unknown } | null;
  if (typeof payload?.code === 'string' && payload.code.trim()) {
    return payload.code.trim().toUpperCase().replace(/[\s-]+/g, '_');
  }
  return undefined;
}

async function apiRequest<T>(
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
      data: method === 'GET' || method === 'DELETE' ? undefined : body,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (!error.response) {
        throw new PartnerApiError(
          `Network request failed. Cannot reach ${API_BASE_URL}. Same Wi‑Fi as PC, Expo Go only, then reload.`,
          'NETWORK_ERROR'
        );
      }

      const message = extractErrorMessage(
        error.response.data,
        `Request failed (${error.response.status})`
      );
      const code = extractErrorCode(error.response.data);

      if (message.toLowerCase().includes('csrf')) {
        throw new PartnerApiError(
          'Security token expired. Close and reopen the app, then try again.',
          'CSRF_FAILED'
        );
      }

      if (message.includes('generatePasswordResetToken')) {
        throw new PartnerApiError(
          'Password reset is broken on the server. Backend must define User.generatePasswordResetToken (and not use .lean() when calling it).',
          'SERVER_MISCONFIGURED'
        );
      }

      if (
        message.toLowerCase().includes('generateemailverificationtoken') ||
        message.toLowerCase().includes('generate email verification token')
      ) {
        throw new PartnerApiError(
          'Email verification is broken on the server. Backend must define User.generateEmailVerificationToken on the User model (and call it on a Mongoose document, not a .lean() plain object).',
          'SERVER_MISCONFIGURED'
        );
      }

      throw new PartnerApiError(message, code);
    }

    throw error;
  }
}

export const authApi = {
  register: async (payload: RegisterPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/register`, {
      method: 'POST',
      body: {
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        phone: payload.phone,
        password: payload.password,
        confirmPassword: payload.confirmPassword,
        role: toApiRole(payload.role),
      },
    });
    return normalizeAuthResponse(data, payload.role);
  },

  login: async (payload: LoginPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/login`, {
      method: 'POST',
      body: {
        email: payload.email,
        password: payload.password,
      },
    });
    return normalizeAuthResponse(data, payload.role);
  },

  sendOtp: async (payload: OtpSendPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/otp/send`, {
      method: 'POST',
      body: {
        identifier: payload.emailOrPhone,
        purpose: payload.purpose ?? 'login',
      },
    });
    return normalizeOtpSendResponse(data);
  },

  resendOtp: async (payload: OtpSendPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/otp/resend`, {
      method: 'POST',
      body: {
        identifier: payload.emailOrPhone,
        purpose: payload.purpose ?? 'login',
      },
    });
    return normalizeOtpSendResponse(data);
  },

  verifyOtp: async (payload: OtpVerifyPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/otp/verify`, {
      method: 'POST',
      body: {
        identifier: payload.emailOrPhone,
        otp: payload.otp,
        purpose: payload.purpose ?? 'login',
      },
    });
    return normalizeAuthResponse(data, payload.role);
  },

  loginGoogle: async (payload: GoogleLoginPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/social/google`, {
      method: 'POST',
      body: {
        idToken: payload.idToken,
        source: authClientSource(),
        deviceId: await getAuthDeviceId(),
        role: toApiRole(payload.role),
      },
    });
    return normalizeAuthResponse(data, payload.role);
  },

  loginApple: async (payload: AppleLoginPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/social/apple`, {
      method: 'POST',
      body: {
        identityToken: payload.identityToken,
        authorizationCode: payload.authorizationCode,
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        source: authClientSource(),
        deviceId: await getAuthDeviceId(),
        role: toApiRole(payload.role),
      },
    });
    return normalizeAuthResponse(data, payload.role);
  },

  forgotPassword: async (payload: ForgotPasswordPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/forgot-password`, {
      method: 'POST',
      body: payload,
    });
    return normalizeMessageResponse(data);
  },

  resetPassword: async (payload: ResetPasswordPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/reset-password`, {
      method: 'POST',
      body: {
        token: payload.token,
        password: payload.password,
        confirmPassword: payload.confirmPassword ?? payload.password,
      },
    });
    return normalizeMessageResponse(data);
  },

  verifyEmail: async (token: string) => {
    const data = await apiRequest<unknown>(
      `${AUTH_BASE}/email/verify/${token}`
    );
    return normalizeMessageResponse(data);
  },

  logout: async () => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/logout`, {
      method: 'POST',
      // Empty JSON body so Content-Type: application/json is sent
      // (gateway rejects POSTs without JSON media type).
      body: {},
    });
    return normalizeMessageResponse(data);
  },

  logoutAll: async () => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/logout-all`, {
      method: 'POST',
      body: {},
    });
    return normalizeMessageResponse(data);
  },

  changePassword: async (payload: ChangePasswordPayload) => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/change-password`, {
      method: 'POST',
      body: {
        currentPassword: payload.oldPassword,
        newPassword: payload.newPassword,
        confirmPassword: payload.confirmPassword ?? payload.newPassword,
      },
    });
    return normalizeMessageResponse(data);
  },

  resendEmailVerification: async () => {
    const data = await apiRequest<unknown>(`${AUTH_BASE}/email/send-verify`, {
      method: 'POST',
      body: {},
    });
    return normalizeMessageResponse(data);
  },

  /** GET /api/v1/user-service/health — user-service liveness. */
  health: async () => {
    const data = await apiRequest<unknown>('/api/v1/user-service/health');
    const payload =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
    const status = String(payload.status ?? payload.state ?? 'ok');
    return { status, service: String(payload.service ?? 'user-service') };
  },
};
