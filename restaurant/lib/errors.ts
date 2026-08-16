import axios from 'axios';

import { API_BASE_URL } from '@/lib/api';

/** Delivery-service envelope error with `code` (e.g. PARTNER_OFFLINE). */
export class PartnerApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PartnerApiError';
    this.code = code;
  }
}

export function getApiErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      if (error.code === 'ECONNABORTED') {
        return 'Request timed out. Check your internet and try again.';
      }

      const detail = error.message?.toLowerCase() ?? '';
      if (
        detail.includes('network error') ||
        detail.includes('network request failed')
      ) {
        return `Cannot reach ${API_BASE_URL}. Open ${API_BASE_URL}/health in your browser — if it fails, switch to the same Wi‑Fi as the API machine.`;
      }

      return (
        error.message || 'Cannot reach the server. Check your internet connection.'
      );
    }

    const data = error.response?.data as
      | { message?: string; error?: string; errors?: string[]; code?: string }
      | undefined;

    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      return data.errors.join('\n');
    }
    if (typeof data?.message === 'string') return data.message;
    if (typeof data?.error === 'string') return data.error;
    if (error.message && error.message !== 'Network Error') return error.message;
  }

  if (error instanceof Error) {
    if (error.message.includes('Security token')) {
      return `${error.message}. Check that ${API_BASE_URL} is reachable from your phone.`;
    }
    return error.message;
  }

  return fallback;
}

const TRANSPORT_CODES = new Set([
  'ECONNABORTED',
  'ERR_NETWORK',
  'ERR_CANCELED',
  'ERR_BAD_RESPONSE',
  'ERR_BAD_REQUEST',
]);

/** API envelope `code` (e.g. ACTIVE_DELIVERY) when present. */
export function getApiErrorCode(error: unknown): string | undefined {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { code?: unknown } | undefined;
    if (typeof data?.code === 'string' && data.code.trim()) {
      return data.code.trim().toUpperCase().replace(/[\s-]+/g, '_');
    }
  }

  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code !== 'string' || !code.trim()) return undefined;
    const normalized = code.trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (TRANSPORT_CODES.has(code.trim().toUpperCase())) return undefined;
    return normalized;
  }

  return undefined;
}
