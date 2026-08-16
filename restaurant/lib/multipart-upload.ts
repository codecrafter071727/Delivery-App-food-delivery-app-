import axios from 'axios';

import { api } from '@/lib/api';

export type UploadFilePart = {
  uri: string;
  name: string;
  type: string;
};

type FormDataPartLike = {
  headers?: Record<string, string>;
  [key: string]: unknown;
};

let formDataPatched = false;

/**
 * RN 0.74+ may add a `filename*` header that multer cannot parse.
 * Patch the built-in getter once instead of subclassing FormData.
 */
function ensureFormDataMulterPatch() {
  if (formDataPatched || typeof FormData === 'undefined') return;

  const proto = FormData.prototype as FormData & {
    getParts?: () => FormDataPartLike[];
  };
  const original = proto.getParts;
  if (typeof original !== 'function') return;

  proto.getParts = function getPartsMulterSafe(this: FormData) {
    return original.call(this).map((part) => {
      if (!part?.headers) return part;
      const headers = { ...part.headers };
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() !== 'content-disposition') continue;
        headers[key] = headers[key].replace(/;\s*filename\*=[^;]*/gi, '');
      }
      return { ...part, headers };
    });
  };

  formDataPatched = true;
}

function safeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'upload.jpg';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot) : '.jpg';
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${stem || 'upload'}${ext}`;
}

function extractUploadError(error: unknown, statusFallback?: number): Error {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string; error?: string; code?: string }
      | string
      | undefined;
    const status = error.response?.status;
    if (status === 413) {
      return new Error('Each photo must be under 5 MB.');
    }
    const message =
      (typeof data === 'object' && data
        ? data.message || data.error
        : typeof data === 'string'
          ? data
          : null) ||
      error.message ||
      `Upload failed (${status ?? statusFallback ?? 0})`;
    return new Error(String(message));
  }
  if (error instanceof Error) return error;
  return new Error('Upload failed');
}

function isUnexpectedFieldError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('unexpected field') || lower.includes('multer');
}

function unwrapUploadData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  const nested = record.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

/**
 * Upload via the shared axios client so Cookie + X-CSRF-Token stay in sync
 * (raw XHR often drops the Cookie header on React Native → invalid CSRF).
 */
async function sendFormData(
  path: string,
  formData: FormData
): Promise<Record<string, unknown>> {
  ensureFormDataMulterPatch();

  try {
    const response = await api.post(path, formData, {
      // Let RN set multipart boundary; interceptor strips JSON content-type.
      headers: { Accept: 'application/json' },
      timeout: 60000,
    });
    return unwrapUploadData(response.data);
  } catch (error) {
    throw extractUploadError(error);
  }
}

export async function postMultipartFile(
  path: string,
  fieldName: string,
  file: UploadFilePart
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  formData.append(fieldName, {
    uri: file.uri,
    name: safeFilename(file.name),
    type: file.type || 'image/jpeg',
  } as unknown as Blob);

  return sendFormData(path, formData);
}

export async function postMultipartFiles(
  path: string,
  fieldName: string,
  files: UploadFilePart[]
): Promise<Record<string, unknown>> {
  const formData = new FormData();
  for (const file of files) {
    formData.append(fieldName, {
      uri: file.uri,
      name: safeFilename(file.name),
      type: file.type || 'image/jpeg',
    } as unknown as Blob);
  }
  return sendFormData(path, formData);
}

/**
 * Multipart with text fields + one or more file fields (same bytes duplicated if needed).
 */
export async function postMultipartWithFields(
  path: string,
  options: {
    fields?: Record<string, string>;
    files: Array<{ fieldName: string; file: UploadFilePart }>;
  }
): Promise<Record<string, unknown>> {
  const formData = new FormData();

  for (const [key, value] of Object.entries(options.fields ?? {})) {
    formData.append(key, value);
  }

  for (const entry of options.files) {
    formData.append(entry.fieldName, {
      uri: entry.file.uri,
      name: safeFilename(entry.file.name),
      type: entry.file.type || 'image/jpeg',
    } as unknown as Blob);
  }

  return sendFormData(path, formData);
}

export async function postMultipartWithFieldFallback(
  path: string,
  file: UploadFilePart,
  fieldCandidates: string[]
): Promise<Record<string, unknown>> {
  let lastError: unknown;

  for (const fieldName of fieldCandidates) {
    try {
      return await postMultipartFile(path, fieldName, file);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : '';
      if (!isUnexpectedFieldError(message)) throw error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('Upload failed');
}
