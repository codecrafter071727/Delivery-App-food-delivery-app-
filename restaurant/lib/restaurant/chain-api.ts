import axios from 'axios';

import { api } from '@/lib/api';
import { PartnerApiError, getApiErrorCode } from '@/lib/errors';
import type {
  ApplyAvailabilityPayload,
  ApplyPricesPayload,
  ApplySettingsPayload,
  ChainApplyResult,
  ChainCloneResult,
  ChainSettingsResult,
  ChainSibling,
  CloneMenuPayload,
} from '@/lib/restaurant/chain-types';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((row) => row && typeof row === 'object') as Record<
      string,
      unknown
    >[];
  }
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ['siblings', 'outlets', 'targets', 'data', 'results']) {
    if (Array.isArray(record[key])) return asRows(record[key]);
  }
  return [];
}

function unwrap(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;
  if ('data' in record) return record.data;
  return payload;
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
    if (code === 'CHAIN_OWNER_MISMATCH') {
      return 'That outlet is not on the same owner account.';
    }
    if (code === 'CHAIN_TARGET_LIMIT') {
      return 'You can sync at most 20 outlets at a time.';
    }
    if (code === 'CHAIN_ITEM_LIMIT') {
      return data?.message || 'Too many dishes selected for this sync.';
    }
    if (code === 'PARTNER_NOT_ACTIVE') {
      return 'Listing is not live yet. Ops must approve this outlet before some chain actions run.';
    }
    if (code === 'ALCOHOL_NOT_ALLOWED_IN_CITY') {
      return 'Alcohol cannot be enabled in that city.';
    }
    if (code === 'FORBIDDEN') {
      return 'You do not have access to sync this outlet.';
    }
    if (code === 'VALIDATION_ERROR') {
      return data?.message || 'Check the outlets you selected and try again.';
    }
    if (status === 401) return 'Session expired. Sign in again.';
    return data?.message || data?.error || `Request failed (${status})`;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function throwChainError(error: unknown, fallback: string): never {
  throw new PartnerApiError(extractError(error, fallback), getApiErrorCode(error));
}

function mapSibling(row: Record<string, unknown>): ChainSibling | null {
  const restaurantId = String(
    row.restaurantId ?? row._id ?? row.id ?? ''
  ).trim();
  if (!restaurantId) return null;
  return {
    restaurantId,
    name: String(row.name ?? 'Outlet'),
    status: typeof row.status === 'string' ? row.status : undefined,
    isOnline: row.isOnline === true,
    city: typeof row.city === 'string' && row.city.trim() ? row.city : undefined,
    isSource: row.isSource === true,
  };
}

function mapUnmatched(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const rec = asRecord(row);
      if (!rec) return null;
      const name = String(rec.name ?? '').trim();
      if (!name) return null;
      return {
        name,
        categoryName:
          typeof rec.categoryName === 'string' ? rec.categoryName : undefined,
      };
    })
    .filter(Boolean) as { name: string; categoryName?: string }[];
}

export const restaurantChainApi = {
  /** GET /restaurants/:id/chain/siblings */
  listSiblings: async (restaurantId: string): Promise<ChainSibling[]> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/chain/siblings`
      );
      return asRows(unwrap(res.data))
        .map(mapSibling)
        .filter((row): row is ChainSibling => Boolean(row));
    } catch (error) {
      throwChainError(error, 'Could not load other outlets');
    }
  },

  /** POST /restaurants/:id/chain/clone-menu */
  cloneMenu: async (
    restaurantId: string,
    payload: CloneMenuPayload
  ): Promise<ChainCloneResult> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/chain/clone-menu`,
        payload,
        { timeout: 60000 }
      );
      const data = asRecord(unwrap(res.data)) ?? {};
      const targets = asRows(data.targets).map((row) => ({
        restaurantId: String(row.restaurantId ?? ''),
        name: String(row.name ?? 'Outlet'),
        categoriesCreated: Number(row.categoriesCreated ?? 0) || 0,
        categoriesReused: Number(row.categoriesReused ?? 0) || 0,
        groupsCreated: Number(row.groupsCreated ?? 0) || 0,
        itemsCreated: Number(row.itemsCreated ?? 0) || 0,
        itemsSkipped: Number(row.itemsSkipped ?? 0) || 0,
        cleared: row.cleared === true,
        error: typeof row.error === 'string' ? row.error : undefined,
      }));
      return {
        sourceRestaurantId: String(data.sourceRestaurantId ?? restaurantId),
        targets,
      };
    } catch (error) {
      throwChainError(error, 'Could not copy menu');
    }
  },

  /** POST /restaurants/:id/chain/apply-prices */
  applyPrices: async (
    restaurantId: string,
    payload: ApplyPricesPayload
  ): Promise<ChainApplyResult> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/chain/apply-prices`,
        payload
      );
      const data = asRecord(unwrap(res.data)) ?? {};
      return {
        sourceRestaurantId: String(data.sourceRestaurantId ?? restaurantId),
        matchBy: data.matchBy === 'name' ? 'name' : 'name_and_category',
        targets: asRows(data.targets).map((row) => ({
          restaurantId: String(row.restaurantId ?? ''),
          name: String(row.name ?? 'Outlet'),
          matched: Number(row.matched ?? 0) || 0,
          updated: Number(row.updated ?? 0) || 0,
          unmatched: mapUnmatched(row.unmatched),
          error: typeof row.error === 'string' ? row.error : undefined,
        })),
      };
    } catch (error) {
      throwChainError(error, 'Could not push prices');
    }
  },

  /** POST /restaurants/:id/chain/apply-availability */
  applyAvailability: async (
    restaurantId: string,
    payload: ApplyAvailabilityPayload
  ): Promise<ChainApplyResult> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/chain/apply-availability`,
        payload
      );
      const data = asRecord(unwrap(res.data)) ?? {};
      return {
        sourceRestaurantId: String(data.sourceRestaurantId ?? restaurantId),
        matchBy: data.matchBy === 'name' ? 'name' : 'name_and_category',
        isAvailable: data.isAvailable === true,
        targets: asRows(data.targets).map((row) => ({
          restaurantId: String(row.restaurantId ?? ''),
          name: String(row.name ?? 'Outlet'),
          matched: Number(row.matched ?? 0) || 0,
          updated: Number(row.updated ?? 0) || 0,
          unmatched: mapUnmatched(row.unmatched),
          error: typeof row.error === 'string' ? row.error : undefined,
        })),
      };
    } catch (error) {
      throwChainError(error, 'Could not push sold-out state');
    }
  },

  /** PUT /restaurants/:id/chain/apply-settings */
  applySettings: async (
    restaurantId: string,
    payload: ApplySettingsPayload
  ): Promise<ChainSettingsResult> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/chain/apply-settings`,
        payload
      );
      const data = asRecord(unwrap(res.data)) ?? {};
      const keys = Array.isArray(data.appliedKeys)
        ? data.appliedKeys.map((key) => String(key))
        : [];
      return {
        sourceRestaurantId: String(data.sourceRestaurantId ?? restaurantId),
        appliedKeys: keys,
        targets: asRows(data.targets).map((row) => ({
          restaurantId: String(row.restaurantId ?? ''),
          name: String(row.name ?? 'Outlet'),
          applied: row.applied !== false,
          error: typeof row.error === 'string' ? row.error : undefined,
        })),
      };
    } catch (error) {
      throwChainError(error, 'Could not sync settings');
    }
  },
};
