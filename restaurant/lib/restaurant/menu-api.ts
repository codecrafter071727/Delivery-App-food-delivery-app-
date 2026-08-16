import axios from 'axios';

import { api } from '@/lib/api';
import { PartnerApiError, getApiErrorCode } from '@/lib/errors';
import {
  postMultipartWithFieldFallback,
  type UploadFilePart,
} from '@/lib/multipart-upload';
import type {
  AttachModifiersPayload,
  AvailabilityPayload,
  BulkImportPayload,
  BulkPriceUpdate,
  CategorySchedulePeriod,
  CreateCategoryPayload,
  CreateMenuItemPayload,
  CreateModifierGroupPayload,
  MenuCategory,
  MenuItem,
  ModifierGroup,
  ModifierOption,
  UpdateCategoryPayload,
  UpdateMenuItemPayload,
} from '@/lib/restaurant/types';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNext?: boolean;
  };
};

function extractId(data: Record<string, unknown> | undefined) {
  if (!data) return '';
  const raw = data._id ?? data.id ?? data.categoryId ?? data.itemId;
  return raw != null && String(raw).trim() ? String(raw) : '';
}

function extractError(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) return 'Network request failed. Check your internet and try again.';
    const status = error.response.status;
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const code = String(data?.code ?? '').toUpperCase();
    if (code === 'CATEGORY_NOT_FOUND') return data?.message || 'Category not found.';
    if (code === 'MENU_ITEM_NOT_FOUND') return data?.message || 'Menu item not found.';
    if (code === 'MODIFIER_GROUP_NOT_FOUND') {
      return data?.message || 'Customisation group not found.';
    }
    if (code === 'MODIFIER_LIMIT') {
      return data?.message || 'Too many customisation groups for this outlet or item.';
    }
    if (code === 'PARTNER_NOT_ACTIVE') {
      return 'Listing is not live yet. You can still edit the menu; customers will see it after ops approve.';
    }
    if (code === 'VALIDATION_ERROR') {
      return data?.message || 'Check the fields and try again.';
    }
    return data?.message || data?.error || `Request failed (${status})`;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function throwMenuError(error: unknown, fallback: string): never {
  throw new PartnerApiError(extractError(error, fallback), getApiErrorCode(error));
}

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
  for (const key of [
    'categories',
    'items',
    'menu',
    'data',
    'results',
    'docs',
    'menuItems',
  ]) {
    const nested = record[key];
    if (Array.isArray(nested)) return asRows(nested);
    const nestedRecord = asRecord(nested);
    if (nestedRecord?.categories && Array.isArray(nestedRecord.categories)) {
      return asRows(nestedRecord.categories);
    }
    if (nestedRecord?.items && Array.isArray(nestedRecord.items)) {
      return asRows(nestedRecord.items);
    }
  }
  return [];
}

function mapTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,;]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return undefined;
}

/**
 * Live /menu returns groups: { _id, category: { _id, name }, items: [...] }.
 * Prefer nested `category` when present (matches customer website mappers).
 */
function mapCategory(row: Record<string, unknown>): MenuCategory {
  const nested = asRecord(row.category) ?? asRecord(row.menuCategory);
  const source = nested ?? row;
  const items = row.items ?? source.items;

  const itemCount =
    typeof row.itemCount === 'number'
      ? row.itemCount
      : typeof source.itemCount === 'number'
        ? source.itemCount
        : typeof row.itemsCount === 'number'
          ? row.itemsCount
          : typeof row.count === 'number'
            ? row.count
            : Array.isArray(items)
              ? items.length
              : undefined;

  const id =
    extractId(source) ||
    extractId(row) ||
    String(source.name ?? source.title ?? row.name ?? '')
      .trim()
      .toLowerCase();

  const scheduleRaw = asRecord(source.schedule) ?? asRecord(row.schedule);
  const periodsRaw = Array.isArray(scheduleRaw?.periods)
    ? scheduleRaw.periods
    : [];
  const periods: CategorySchedulePeriod[] = [];
  for (const entry of periodsRaw) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const meal = String(rec.meal ?? '') as CategorySchedulePeriod['meal'];
    if (
      meal !== 'breakfast' &&
      meal !== 'lunch' &&
      meal !== 'dinner' &&
      meal !== 'late_night'
    ) {
      continue;
    }
    const from = String(rec.from ?? '').trim();
    const to = String(rec.to ?? '').trim();
    if (!from || !to) continue;
    const days = Array.isArray(rec.days)
      ? rec.days.map((day) => String(day))
      : undefined;
    periods.push(days?.length ? { meal, from, to, days } : { meal, from, to });
  }

  return {
    id,
    name: String(
      source.name ??
        source.title ??
        source.categoryName ??
        row.name ??
        row.title ??
        row.categoryName ??
        'Category'
    ),
    description:
      (source.description as string) ||
      (row.description as string) ||
      undefined,
    sortOrder:
      typeof source.sortOrder === 'number'
        ? source.sortOrder
        : typeof row.sortOrder === 'number'
          ? row.sortOrder
          : undefined,
    itemCount,
    isActive:
      source.isActive === undefined && row.isActive === undefined
        ? undefined
        : Boolean(source.isActive ?? row.isActive),
    availableFrom:
      typeof source.availableFrom === 'string'
        ? source.availableFrom
        : typeof row.availableFrom === 'string'
          ? row.availableFrom
          : undefined,
    availableTo:
      typeof source.availableTo === 'string'
        ? source.availableTo
        : typeof row.availableTo === 'string'
          ? row.availableTo
          : undefined,
    schedule: periods.length ? { periods } : undefined,
  };
}

function mapItem(
  row: Record<string, unknown>,
  fallbackCategory?: { id?: string; name?: string }
): MenuItem {
  const categoryObj =
    asRecord(row.category) ?? asRecord(row.menuCategory) ?? null;

  const categoryIdRaw =
    (row.categoryId != null ? String(row.categoryId) : '') ||
    extractId(categoryObj ?? undefined) ||
    (typeof row.category === 'string' ? row.category : '') ||
    fallbackCategory?.id ||
    '';

  const categoryName =
    (typeof row.categoryName === 'string' && row.categoryName) ||
    (typeof categoryObj?.name === 'string' && categoryObj.name) ||
    (typeof categoryObj?.title === 'string' && categoryObj.title) ||
    fallbackCategory?.name ||
    undefined;

  const discount =
    row.discountPrice != null && row.discountPrice !== ''
      ? Number(row.discountPrice)
      : row.discountedPrice != null && row.discountedPrice !== ''
        ? Number(row.discountedPrice)
        : undefined;

  const groupsRaw = Array.isArray(row.modifierGroups) ? row.modifierGroups : [];

  return {
    id: extractId(row) || String(row.name ?? ''),
    name: String(row.name ?? row.title ?? 'Item'),
    description: (row.description as string) || undefined,
    price: Number(row.price ?? row.basePrice ?? 0),
    discountPrice: Number.isFinite(discount) ? discount : undefined,
    imageUrl:
      (row.imageUrl as string) ||
      (row.image as string) ||
      (row.photoUrl as string) ||
      undefined,
    categoryId: categoryIdRaw || undefined,
    categoryName: categoryName || undefined,
    isVeg:
      row.isVeg !== undefined
        ? Boolean(row.isVeg)
        : row.veg !== undefined
          ? Boolean(row.veg)
          : undefined,
    isAvailable:
      row.isAvailable !== undefined
        ? Boolean(row.isAvailable)
        : row.available !== undefined
          ? Boolean(row.available)
          : true,
    unavailableUntil:
      typeof row.unavailableUntil === 'string' ? row.unavailableUntil : null,
    unavailableReason:
      typeof row.unavailableReason === 'string'
        ? row.unavailableReason
        : typeof row.reason === 'string'
          ? row.reason
          : null,
    spiceLevel: (row.spiceLevel as string) || undefined,
    tags: mapTags(row.tags),
    sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : undefined,
    modifierGroups: groupsRaw
      .map((group) => mapModifierGroup(asRecord(group) ?? {}))
      .filter((group) => group.id || group.name),
  };
}

function mapModifierOption(row: Record<string, unknown>): ModifierOption {
  return {
    id: extractId(row),
    name: String(row.name ?? ''),
    price: Number(row.price ?? 0) || 0,
    isDefault: row.isDefault === true,
    isAvailable: row.isAvailable !== false,
  };
}

function mapModifierGroup(row: Record<string, unknown>): ModifierGroup {
  const options = Array.isArray(row.options)
    ? row.options
        .map((option) => mapModifierOption(asRecord(option) ?? {}))
        .filter((option) => option.name)
    : [];
  return {
    id: extractId(row),
    name: String(row.name ?? ''),
    description:
      typeof row.description === 'string' ? row.description : null,
    minSelect: Number(row.minSelect ?? 0) || 0,
    maxSelect: Number(row.maxSelect ?? 1) || 1,
    isRequired: row.isRequired === true,
    sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : undefined,
    options,
  };
}

/** Unwrap single entity responses without breaking list payloads. */
function unwrapEntity(payload: unknown): unknown {
  const record = asRecord(payload);
  if (!record) return payload;

  if ('data' in record) {
    const data = record.data;
    if (Array.isArray(data)) return data;
    const dataRec = asRecord(data);
    if (!dataRec) return data;
    // Single wrapped entity: { data: { item: {...} } }
    if (dataRec.item && !Array.isArray(dataRec.item)) return dataRec.item;
    if (dataRec.menuItem && !Array.isArray(dataRec.menuItem)) return dataRec.menuItem;
    if (
      dataRec.category &&
      !Array.isArray(dataRec.category) &&
      !Array.isArray(dataRec.items)
    ) {
      return dataRec.category;
    }
    return data;
  }

  return payload;
}

/**
 * Normalize GET /menu — same shapes as the customer website:
 * 1) { categories, items }
 * 2) [ { category, items } ]  ← live API
 * 3) flat item array
 */
function normalizeMenu(data: unknown): {
  categories: MenuCategory[];
  items: MenuItem[];
} {
  if (!data || typeof data !== 'object') {
    return { categories: [], items: [] };
  }

  const payload = data as Record<string, unknown>;

  if (Array.isArray(payload.categories) || Array.isArray(payload.items)) {
    const categories = Array.isArray(payload.categories)
      ? payload.categories
          .map((row) => mapCategory(row as Record<string, unknown>))
          .filter((row) => row.id)
      : [];
    const items = Array.isArray(payload.items)
      ? payload.items
          .map((row) => mapItem(row as Record<string, unknown>))
          .filter((row) => row.id)
      : [];
    return { categories, items };
  }

  if (Array.isArray(data)) {
    if (!data.length) return { categories: [], items: [] };

    const first = asRecord(data[0]);
    if (first && Array.isArray(first.items)) {
      const categories: MenuCategory[] = [];
      const items: MenuItem[] = [];

      for (const group of data as Record<string, unknown>[]) {
        const category = mapCategory(group);
        categories.push(category);
        for (const raw of asRows(group.items)) {
          items.push(
            mapItem(raw, { id: category.id, name: category.name })
          );
        }
      }

      return {
        categories: categories.filter((row) => row.id),
        items: items.filter((row) => row.id),
      };
    }

    return {
      categories: [],
      items: data
        .map((row) => mapItem(row as Record<string, unknown>))
        .filter((row) => row.id),
    };
  }

  return { categories: [], items: [] };
}

function normalizeItemTags(payload: CreateMenuItemPayload | UpdateMenuItemPayload) {
  if (Array.isArray(payload.tags)) return payload.tags;
  if (typeof payload.tags === 'string') {
    return payload.tags
      .split(/[,;]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return payload.tags;
}

function mergeItemsById(...lists: MenuItem[][]): MenuItem[] {
  const byId = new Map<string, MenuItem>();
  for (const list of lists) {
    for (const item of list) {
      if (!item.id) continue;
      const prev = byId.get(item.id);
      byId.set(item.id, prev ? { ...prev, ...item } : item);
    }
  }
  return Array.from(byId.values());
}

export const restaurantMenuApi = {
  /** GET /restaurants/:id/menu */
  getMenu: async (restaurantId: string): Promise<{
    categories: MenuCategory[];
    items: MenuItem[];
  }> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/menu`
      );
      return normalizeMenu(unwrapEntity(res.data));
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { categories: [], items: [] };
      }
      throwMenuError(error, 'Failed to load menu');
    }
  },

  /** GET /restaurants/:id/categories */
  getCategories: async (restaurantId: string): Promise<MenuCategory[]> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/categories`
      );
      return asRows(unwrapEntity(res.data))
        .map(mapCategory)
        .filter((row) => row.id);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return [];
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** POST /restaurants/:id/categories */
  createCategory: async (
    restaurantId: string,
    payload: CreateCategoryPayload
  ): Promise<MenuCategory> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/categories`,
        {
          name: payload.name.trim(),
          description: payload.description,
          ...(payload.sortOrder != null ? { sortOrder: payload.sortOrder } : {}),
        }
      );
      const unwrapped = unwrapEntity(res.data);
      const nested = asRecord(unwrapped);
      const data =
        nested && (nested._id || nested.id || nested.name)
          ? nested
          : asRecord(nested?.data) ??
            asRecord(res.data?.data) ??
            asRecord(res.data) ??
            {};
      const mapped = mapCategory({
        ...data,
        _id: data._id ?? data.id,
        name: data.name ?? data.title ?? payload.name,
        description: data.description ?? payload.description,
        isActive: data.isActive !== false,
      });
      if (!mapped.id) {
        throw new PartnerApiError(
          'Category was saved but no id came back. Pull down to refresh.',
          'CATEGORY_ID_MISSING'
        );
      }
      return mapped;
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** PUT /restaurants/:id/categories/:categoryId */
  updateCategory: async (
    restaurantId: string,
    categoryId: string,
    payload: UpdateCategoryPayload
  ): Promise<MenuCategory> => {
    try {
      const body: Record<string, unknown> = {};
      if (payload.name !== undefined) body.name = payload.name.trim();
      if (payload.description !== undefined) body.description = payload.description;
      if (payload.sortOrder !== undefined) body.sortOrder = payload.sortOrder;
      if (payload.isActive !== undefined) body.isActive = payload.isActive;
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/categories/${categoryId}`,
        body
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapCategory({
        ...data,
        _id: data._id ?? categoryId,
        id: data.id ?? categoryId,
      });
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** PUT /restaurants/:id/categories/reorder */
  reorderCategories: async (
    restaurantId: string,
    categoryIds: string[]
  ): Promise<void> => {
    try {
      await api.put(
        `${RESTAURANT_BASE}/${restaurantId}/categories/reorder`,
        { categoryIds, order: categoryIds }
      );
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** DELETE /restaurants/:id/categories/:categoryId */
  deleteCategory: async (restaurantId: string, categoryId: string): Promise<void> => {
    try {
      await api.delete(
        `${RESTAURANT_BASE}/${restaurantId}/categories/${categoryId}`
      );
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /**
   * GET /restaurants/:id/items
   * Paginates through all pages (API default limit is often 20).
   */
  getItems: async (
    restaurantId: string,
    categoryId?: string
  ): Promise<MenuItem[]> => {
    try {
      const all: MenuItem[] = [];
      let page = 1;
      let hasNext = true;

      while (hasNext && page <= 50) {
        const res = await api.get<Envelope<unknown>>(
          `${RESTAURANT_BASE}/${restaurantId}/items`,
          {
            params: {
              page,
              limit: 100,
              ...(categoryId ? { categoryId } : {}),
            },
          }
        );

        const rows = asRows(unwrapEntity(res.data))
          .map((row) =>
            mapItem(row, categoryId ? { id: categoryId } : undefined)
          )
          .filter((row) => row.id);

        all.push(...rows);

        const meta = res.data?.meta;
        if (meta?.hasNext === true) {
          page += 1;
          continue;
        }
        if (
          meta?.totalPages != null &&
          (meta.page ?? page) < meta.totalPages
        ) {
          page += 1;
          continue;
        }
        if (rows.length >= 100) {
          page += 1;
          continue;
        }
        hasNext = false;
      }

      const unique = mergeItemsById(all);

      if (!categoryId) return unique;

      const matched = unique.filter((row) => row.categoryId === categoryId);
      if (matched.length) return matched;

      if (
        unique.length > 0 &&
        unique.every((row) => !row.categoryId || row.categoryId === categoryId)
      ) {
        return unique.map((row) => ({ ...row, categoryId }));
      }

      return matched;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return [];
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** GET /restaurants/:id/items/:itemId */
  getItem: async (restaurantId: string, itemId: string): Promise<MenuItem> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}`
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapItem(data);
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** POST /restaurants/:id/categories/:categoryId/items */
  createItem: async (
    restaurantId: string,
    categoryId: string,
    payload: CreateMenuItemPayload
  ): Promise<MenuItem> => {
    try {
      const body = {
        name: payload.name.trim(),
        description: payload.description,
        price: payload.price,
        isVeg: payload.isVeg ?? true,
        spiceLevel: payload.spiceLevel,
        tags: normalizeItemTags(payload),
        ...(payload.discountPrice != null
          ? { discountedPrice: payload.discountPrice }
          : {}),
      };
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/categories/${categoryId}/items`,
        body
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapItem(
        { ...data, name: data.name ?? payload.name },
        { id: categoryId }
      );
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** PUT /restaurants/:id/items/:itemId */
  updateItem: async (
    restaurantId: string,
    itemId: string,
    payload: UpdateMenuItemPayload
  ): Promise<MenuItem> => {
    try {
      // Backend update schema rejects unknown keys (e.g. isAvailable, discountPrice).
      // Availability must use PUT .../availability instead.
      const body: Record<string, unknown> = {};
      if (payload.name !== undefined) body.name = payload.name;
      if (payload.description !== undefined) body.description = payload.description;
      if (payload.price !== undefined) body.price = payload.price;
      if (payload.isVeg !== undefined) body.isVeg = payload.isVeg;
      if (payload.spiceLevel !== undefined) body.spiceLevel = payload.spiceLevel;
      if (payload.tags !== undefined) body.tags = normalizeItemTags(payload);
      if (payload.discountPrice !== undefined) {
        body.discountedPrice = payload.discountPrice;
      }

      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}`,
        body
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapItem({ ...data, _id: data._id ?? itemId, id: data.id ?? itemId });
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** DELETE /restaurants/:id/items/:itemId */
  deleteItem: async (restaurantId: string, itemId: string): Promise<void> => {
    try {
      await api.delete(`${RESTAURANT_BASE}/${restaurantId}/items/${itemId}`);
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** PUT /restaurants/:id/items/:itemId/availability — timed 86 supported */
  setItemAvailability: async (
    restaurantId: string,
    itemId: string,
    input: boolean | AvailabilityPayload
  ): Promise<MenuItem> => {
    const payload: AvailabilityPayload =
      typeof input === 'boolean' ? { isAvailable: input } : input;
    try {
      const body: Record<string, unknown> = {
        isAvailable: payload.isAvailable,
        available: payload.isAvailable,
      };
      if (payload.isAvailable === false) {
        if (payload.unavailableUntil) {
          body.unavailableUntil = payload.unavailableUntil;
        }
        if (payload.reason) body.reason = payload.reason;
      }
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}/availability`,
        body
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapItem({
        ...data,
        _id: data._id ?? itemId,
        id: data.id ?? itemId,
        isAvailable: data.isAvailable ?? payload.isAvailable,
      });
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** POST /restaurants/:id/items/:itemId/image */
  uploadItemImage: async (
    restaurantId: string,
    itemId: string,
    file: UploadFilePart
  ): Promise<MenuItem> => {
    try {
      const data = await postMultipartWithFieldFallback(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}/image`,
        file,
        ['image', 'file', 'photo', 'itemImage']
      );
      return mapItem({ ...data, _id: data._id ?? itemId, id: data.id ?? itemId });
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** POST /restaurants/:id/items/bulk-availability */
  bulkAvailability: async (
    restaurantId: string,
    itemIds: string[],
    isAvailable: boolean
  ): Promise<void> => {
    try {
      await api.post(
        `${RESTAURANT_BASE}/${restaurantId}/items/bulk-availability`,
        { itemIds, isAvailable, available: isAvailable }
      );
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** POST /restaurants/:id/items/bulk-import */
  bulkImport: async (restaurantId: string, payload: BulkImportPayload) => {
    try {
      const res = await api.post<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/bulk-import`,
        payload
      );
      return res.data;
    } catch (error) {
      throwMenuError(error, 'Menu request failed');
    }
  },

  /** GET /restaurants/:id/menu/search?q= */
  searchMenu: async (restaurantId: string, q: string): Promise<MenuItem[]> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/menu/search`,
        { params: { q } }
      );
      return asRows(unwrapEntity(res.data))
        .map((row) => mapItem(row))
        .filter((row) => row.id);
    } catch (error) {
      throwMenuError(error, 'Menu search failed');
    }
  },

  /** GET /restaurants/:id/unavailable */
  getUnavailable: async (
    restaurantId: string
  ): Promise<{ restaurantId: string; itemIds: string[] }> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/unavailable`
      );
      const raw = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      const ids = Array.isArray(raw.itemIds)
        ? raw.itemIds.map((id) => String(id)).filter(Boolean)
        : [];
      return { restaurantId: String(raw.restaurantId ?? restaurantId), itemIds: ids };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return { restaurantId, itemIds: [] };
      }
      throwMenuError(error, 'Failed to load sold-out items');
    }
  },

  /** PUT /restaurants/:id/categories/:categoryId/schedule */
  updateCategorySchedule: async (
    restaurantId: string,
    categoryId: string,
    periods: CategorySchedulePeriod[]
  ): Promise<MenuCategory> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/categories/${categoryId}/schedule`,
        { periods }
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapCategory({ ...data, _id: data._id ?? categoryId, id: data.id ?? categoryId });
    } catch (error) {
      throwMenuError(error, 'Failed to save category hours');
    }
  },

  /** GET /restaurants/:id/modifier-groups */
  listModifierGroups: async (restaurantId: string): Promise<ModifierGroup[]> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/modifier-groups`
      );
      return asRows(unwrapEntity(res.data))
        .map((row) => mapModifierGroup(row))
        .filter((row) => row.id);
    } catch (error) {
      throwMenuError(error, 'Failed to load customisations');
    }
  },

  /** POST /restaurants/:id/modifier-groups */
  createModifierGroup: async (
    restaurantId: string,
    payload: CreateModifierGroupPayload
  ): Promise<ModifierGroup> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/modifier-groups`,
        {
          name: payload.name.trim(),
          description: payload.description,
          minSelect: payload.minSelect,
          maxSelect: payload.maxSelect,
          isRequired: payload.isRequired,
          sortOrder: payload.sortOrder,
          options: payload.options.map((option) => ({
            ...(option.id ? { _id: option.id } : {}),
            name: option.name.trim(),
            price: option.price,
            isDefault: option.isDefault,
            isAvailable: option.isAvailable,
          })),
        }
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapModifierGroup(data);
    } catch (error) {
      throwMenuError(error, 'Failed to create customisation');
    }
  },

  /** PUT /restaurants/:id/modifier-groups/:groupId */
  updateModifierGroup: async (
    restaurantId: string,
    groupId: string,
    payload: CreateModifierGroupPayload
  ): Promise<ModifierGroup> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/modifier-groups/${groupId}`,
        {
          name: payload.name.trim(),
          description: payload.description,
          minSelect: payload.minSelect,
          maxSelect: payload.maxSelect,
          isRequired: payload.isRequired,
          sortOrder: payload.sortOrder,
          options: payload.options.map((option) => ({
            ...(option.id ? { _id: option.id } : {}),
            name: option.name.trim(),
            price: option.price,
            isDefault: option.isDefault,
            isAvailable: option.isAvailable,
          })),
        }
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapModifierGroup({ ...data, _id: data._id ?? groupId });
    } catch (error) {
      throwMenuError(error, 'Failed to update customisation');
    }
  },

  /** DELETE /restaurants/:id/modifier-groups/:groupId */
  deleteModifierGroup: async (
    restaurantId: string,
    groupId: string
  ): Promise<void> => {
    try {
      await api.delete(
        `${RESTAURANT_BASE}/${restaurantId}/modifier-groups/${groupId}`
      );
    } catch (error) {
      throwMenuError(error, 'Failed to delete customisation');
    }
  },

  /** GET /restaurants/:id/items/:itemId/customizations */
  getItemCustomizations: async (
    restaurantId: string,
    itemId: string
  ): Promise<ModifierGroup[]> => {
    try {
      const res = await api.get<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}/customizations`
      );
      const unwrapped = unwrapEntity(res.data);
      const raw = asRecord(unwrapped) ?? asRecord(res.data) ?? {};
      const groups = Array.isArray(raw.modifierGroups)
        ? raw.modifierGroups
        : Array.isArray(unwrapped)
          ? unwrapped
          : [];
      return groups
        .map((row) => mapModifierGroup(asRecord(row) ?? {}))
        .filter((row) => row.id || row.name);
    } catch (error) {
      throwMenuError(error, 'Failed to load item customisations');
    }
  },

  /** PUT /restaurants/:id/items/:itemId/modifiers */
  attachItemModifiers: async (
    restaurantId: string,
    itemId: string,
    payload: AttachModifiersPayload
  ): Promise<ModifierGroup[]> => {
    try {
      const res = await api.put<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}/modifiers`,
        payload
      );
      const raw = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      const groups = Array.isArray(raw.modifierGroups)
        ? raw.modifierGroups
        : [];
      return groups
        .map((row) => mapModifierGroup(asRecord(row) ?? {}))
        .filter((row) => row.id || row.name);
    } catch (error) {
      throwMenuError(error, 'Failed to save item customisations');
    }
  },

  /** DELETE /restaurants/:id/items/:itemId/image */
  deleteItemImage: async (
    restaurantId: string,
    itemId: string
  ): Promise<MenuItem> => {
    try {
      const res = await api.delete<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}/image`
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapItem({ ...data, _id: data._id ?? itemId, id: data.id ?? itemId });
    } catch (error) {
      throwMenuError(error, 'Failed to remove photo');
    }
  },

  /** POST /restaurants/:id/items/:itemId/duplicate */
  duplicateItem: async (
    restaurantId: string,
    itemId: string
  ): Promise<MenuItem> => {
    try {
      const res = await api.post<Envelope<Record<string, unknown>>>(
        `${RESTAURANT_BASE}/${restaurantId}/items/${itemId}/duplicate`,
        {}
      );
      const data = asRecord(unwrapEntity(res.data)) ?? asRecord(res.data) ?? {};
      return mapItem(data);
    } catch (error) {
      throwMenuError(error, 'Failed to duplicate item');
    }
  },

  /** POST /restaurants/:id/items/bulk-price */
  bulkUpdatePrices: async (
    restaurantId: string,
    updates: BulkPriceUpdate[]
  ): Promise<void> => {
    try {
      await api.post(
        `${RESTAURANT_BASE}/${restaurantId}/items/bulk-price`,
        { updates }
      );
    } catch (error) {
      throwMenuError(error, 'Failed to update prices');
    }
  },

  /** PUT /restaurants/:id/items/reorder */
  reorderItems: async (
    restaurantId: string,
    itemIds: string[],
    categoryId?: string
  ): Promise<void> => {
    try {
      await api.put(`${RESTAURANT_BASE}/${restaurantId}/items/reorder`, {
        itemIds,
        ...(categoryId ? { categoryId } : {}),
      });
    } catch (error) {
      throwMenuError(error, 'Failed to reorder items');
    }
  },

  /**
   * POST /items/bulk-import, then create items one-by-one if needed.
   */
  importItemsToCategory: async (
    restaurantId: string,
    categoryId: string,
    categoryName: string,
    items: CreateMenuItemPayload[]
  ): Promise<{ created: number; mode: 'bulk' | 'manual' }> => {
    if (!items.length) return { created: 0, mode: 'manual' };

    const bulkItems = items.slice(0, 500).map((item) => {
      const spice = String(item.spiceLevel ?? '').toLowerCase();
      const spiceLevel = (
        ['none', 'mild', 'medium', 'hot', 'extra_hot'] as const
      ).includes(spice as 'none')
        ? spice
        : undefined;
      const discounted =
        item.discountPrice != null &&
        Number.isFinite(item.discountPrice) &&
        item.discountPrice > 0 &&
        item.discountPrice < item.price
          ? item.discountPrice
          : undefined;
      return {
        categoryId,
        name: item.name.trim(),
        description: item.description,
        price: item.price,
        isVeg: item.isVeg ?? true,
        spiceLevel,
        tags: Array.isArray(item.tags)
          ? item.tags
          : typeof item.tags === 'string'
            ? item.tags.split(/[,;]/).map((tag) => tag.trim()).filter(Boolean)
            : undefined,
        ...(discounted != null ? { discountedPrice: discounted } : {}),
      };
    });

    const shapes: BulkImportPayload[] = [{ items: bulkItems }];

    const countForCategory = async () => {
      const [scoped, all, menu] = await Promise.all([
        restaurantMenuApi.getItems(restaurantId, categoryId).catch(() => []),
        restaurantMenuApi.getItems(restaurantId).catch(() => []),
        restaurantMenuApi.getMenu(restaurantId).catch(() => ({
          categories: [],
          items: [] as MenuItem[],
        })),
      ]);

      const nameKey = categoryName.trim().toLowerCase();
      const matches = (item: MenuItem) =>
        item.categoryId === categoryId ||
        item.categoryName?.trim().toLowerCase() === nameKey;

      return Math.max(
        scoped.length,
        all.filter(matches).length,
        menu.items.filter(matches).length
      );
    };

    const before = await countForCategory();

    for (const body of shapes) {
      try {
        await restaurantMenuApi.bulkImport(restaurantId, body);
        const after = await countForCategory();
        if (after > before) {
          return { created: after - before, mode: 'bulk' };
        }
      } catch {
        // try next shape
      }
    }

    let created = 0;
    const errors: string[] = [];
    for (const item of items) {
      try {
        await restaurantMenuApi.createItem(restaurantId, categoryId, {
          ...item,
          isVeg: item.isVeg ?? true,
          isAvailable: item.isAvailable ?? true,
        });
        created += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Failed');
      }
    }

    if (created === 0) {
      throw new Error(
        errors[0] || 'Bulk import did not create any items for this category'
      );
    }

    return { created, mode: 'manual' };
  },
};
