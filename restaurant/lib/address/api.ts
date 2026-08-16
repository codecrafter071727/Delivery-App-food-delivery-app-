import axios from 'axios';

import { api, refreshCsrfToken } from '@/lib/api';

const ADDRESS_BASE = '/api/v1/address-service/addresses';

export type AddressSuggestion = {
  description: string;
  placeId?: string;
  /** Any extra backend fields. */
  [key: string]: unknown;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  formattedAddress?: string;
  /** Any extra backend fields. */
  [key: string]: unknown;
};

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function extractError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Network request failed. Check your internet and try again.';
    if (error.response.status === 401) {
      return 'Session expired. Please log out and log in again to search addresses.';
    }
    const data = error.response.data as { message?: string; error?: string } | undefined;
    return data?.message || data?.error || `Request failed (${error.response.status})`;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function mapSuggestion(item: Record<string, unknown>): AddressSuggestion {
  const structured = item.structured_formatting as Record<string, unknown> | undefined;
  const mainText = String(
    item.description ??
      item.label ??
      item.text ??
      item.formattedAddress ??
      item.formatted_address ??
      item.mainText ??
      item.main_text ??
      structured?.main_text ??
      ''
  );
  const secondary = String(
    item.secondaryText ?? item.secondary_text ?? structured?.secondary_text ?? ''
  );
  const description =
    mainText && secondary && !mainText.includes(secondary)
      ? `${mainText}, ${secondary}`
      : mainText || secondary;

  const placeId =
    (item.placeId as string) ||
    (item.place_id as string) ||
    (item.id as string) ||
    undefined;

  return {
    description,
    placeId,
    ...item,
  };
}

function normalizeSuggestions(payload: unknown): AddressSuggestion[] {
  if (Array.isArray(payload)) {
    return payload.map((item) => mapSuggestion(item as Record<string, unknown>));
  }

  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  const list =
    record.suggestions ??
    record.predictions ??
    record.results ??
    record.items ??
    record.addresses ??
    [];

  if (!Array.isArray(list)) return [];

  return list.map((item) => mapSuggestion(item as Record<string, unknown>));
}

export const addressApi = {
  autocomplete: async (query: string): Promise<AddressSuggestion[]> => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    try {
      await refreshCsrfToken();
      const res = await api.get<Envelope<unknown>>(`${ADDRESS_BASE}/autocomplete`, {
        params: {
          query: trimmed,
          input: trimmed,
          q: trimmed,
        },
      });

      const payload = res.data?.data ?? res.data;
      return normalizeSuggestions(payload).filter((s) => s.description.trim());
    } catch (error) {
      throw new Error(extractError(error, 'Failed to load address suggestions'));
    }
  },

  geocode: async (input: { placeId?: string; address?: string }): Promise<GeocodeResult> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${ADDRESS_BASE}/geocode`,
        {
          placeId: input.placeId,
          place_id: input.placeId,
          address: input.address,
          query: input.address,
        }
      );
      const data = (res.data?.data ?? res.data) as Record<string, unknown>;
      const location =
        (data.location as Record<string, unknown> | undefined) ??
        (data.geometry as Record<string, unknown> | undefined) ??
        (data.result as Record<string, unknown> | undefined) ??
        data;

      const lat = Number((location.lat ?? (location.location as any)?.lat) as unknown);
      const lng = Number((location.lng ?? (location.location as any)?.lng) as unknown);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const coords = (location.coordinates as unknown[]) ?? (data.coordinates as unknown[]);
        const lng2 = Number(coords?.[0]);
        const lat2 = Number(coords?.[1]);
        if (Number.isFinite(lat2) && Number.isFinite(lng2)) {
          return { lat: lat2, lng: lng2, formattedAddress: String(data.formattedAddress ?? '') };
        }
        throw new Error('Could not detect location for this address');
      }

      return {
        lat,
        lng,
        formattedAddress: String(data.formattedAddress ?? data.formatted_address ?? ''),
      };
    } catch (error) {
      throw new Error(extractError(error, 'Failed to detect location'));
    }
  },

  reverseGeocode: async (input: { lat: number; lng: number }): Promise<string | null> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${ADDRESS_BASE}/reverse-geocode`,
        {
          lat: input.lat,
          lng: input.lng,
          latitude: input.lat,
          longitude: input.lng,
          coordinates: [input.lng, input.lat],
        }
      );
      const data = (res.data?.data ?? res.data) as Record<string, unknown>;
      const formatted =
        (data.formattedAddress as string) ||
        (data.formatted_address as string) ||
        (data.address as string) ||
        (data.displayName as string) ||
        (data.display_name as string);
      return formatted ? String(formatted) : null;
    } catch {
      return null;
    }
  },
};
