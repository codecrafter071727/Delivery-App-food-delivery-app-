import { useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { dashboardKeys } from '@/lib/dashboard/hooks';
import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { restaurantMenuApi } from '@/lib/restaurant/menu-api';
import type {
  AttachModifiersPayload,
  AvailabilityPayload,
  CategorySchedulePeriod,
  CreateCategoryPayload,
  CreateMenuItemPayload,
  CreateModifierGroupPayload,
  MenuCategory,
  MenuItem,
  UpdateCategoryPayload,
  UpdateMenuItemPayload,
} from '@/lib/restaurant/types';
import type { UploadFilePart } from '@/lib/multipart-upload';

export const menuKeys = {
  all: ['restaurant-menu'] as const,
  restaurant: (restaurantId: string) =>
    [...menuKeys.all, restaurantId] as const,
  categories: (restaurantId: string) =>
    [...menuKeys.restaurant(restaurantId), 'categories'] as const,
  items: (restaurantId: string, categoryId?: string) =>
    [...menuKeys.restaurant(restaurantId), 'items', categoryId ?? 'all'] as const,
  menu: (restaurantId: string) =>
    [...menuKeys.restaurant(restaurantId), 'full'] as const,
  search: (restaurantId: string, q: string) =>
    [...menuKeys.restaurant(restaurantId), 'search', q] as const,
  unavailable: (restaurantId: string) =>
    [...menuKeys.restaurant(restaurantId), 'unavailable'] as const,
  modifiers: (restaurantId: string) =>
    [...menuKeys.restaurant(restaurantId), 'modifiers'] as const,
  customizations: (restaurantId: string, itemId: string) =>
    [...menuKeys.restaurant(restaurantId), 'customizations', itemId] as const,
};

type FullMenu = {
  categories: MenuCategory[];
  items: MenuItem[];
};

async function invalidateMenu(
  queryClient: ReturnType<typeof useQueryClient>,
  restaurantId: string
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: menuKeys.restaurant(restaurantId) }),
    queryClient.invalidateQueries({
      queryKey: dashboardKeys.stats(),
      refetchType: 'none',
    }),
  ]);
}

function mergeCategories(
  primary: MenuCategory[],
  secondary: MenuCategory[]
): MenuCategory[] {
  const byId = new Map<string, MenuCategory>();
  const byName = new Map<string, string>();

  const upsert = (category: MenuCategory) => {
    if (!category.id && !category.name) return;
    const nameKey = category.name.trim().toLowerCase();
    if (nameKey === 'category' && !category.id) return;

    const existingId = byName.get(nameKey);
    const key = category.id || existingId || nameKey;
    const prev = byId.get(key);
    byId.set(key, {
      ...prev,
      ...category,
      id: prev?.id || category.id || key,
      name:
        category.name && category.name !== 'Category'
          ? category.name
          : prev?.name || category.name || 'Category',
      description: category.description ?? prev?.description,
      itemCount:
        typeof category.itemCount === 'number'
          ? category.itemCount
          : prev?.itemCount,
      sortOrder: category.sortOrder ?? prev?.sortOrder,
      isActive: category.isActive ?? prev?.isActive,
      schedule: category.schedule ?? prev?.schedule,
      availableFrom: category.availableFrom ?? prev?.availableFrom,
      availableTo: category.availableTo ?? prev?.availableTo,
    });
    byName.set(nameKey, key);
  };

  for (const category of secondary) upsert(category);
  for (const category of primary) upsert(category);

  return Array.from(byId.values()).sort(
    (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)
  );
}

function withCategoryNames(
  items: MenuItem[],
  categories: MenuCategory[]
): MenuItem[] {
  const byId = new Map(categories.map((category) => [category.id, category.name]));
  const byName = new Map(
    categories.map((category) => [category.name.trim().toLowerCase(), category])
  );

  return items.map((item) => {
    const fromId = item.categoryId ? byId.get(item.categoryId) : undefined;
    const fromName = item.categoryName
      ? byName.get(item.categoryName.trim().toLowerCase())
      : undefined;

    return {
      ...item,
      categoryId: item.categoryId || fromName?.id,
      categoryName: item.categoryName || fromId || fromName?.name,
    };
  });
}

function withItemCounts(
  categories: MenuCategory[],
  items: MenuItem[]
): MenuCategory[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.categoryId) continue;
    counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
  }

  return categories.map((category) => ({
    ...category,
    itemCount: counts.has(category.id)
      ? counts.get(category.id)
      : category.itemCount ?? 0,
  }));
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

function itemsLookValid(items: MenuItem[]) {
  return items.some(
    (item) => item.name && item.name !== 'Item' && Number(item.price) > 0
  );
}

function buildFullMenu(
  categories: MenuCategory[],
  items: MenuItem[]
): FullMenu {
  const named = withCategoryNames(items, categories);
  return {
    categories: withItemCounts(categories, named),
    items: named,
  };
}

/**
 * Kitchen catalog = GET /categories (includes empty sections) merged with
 * GET /menu (dishes + 86). Guest /menu is item-grouped, so a brand-new
 * category with 0 dishes never appears there — Partner still needs the pill.
 */
async function loadFullMenu(restaurantId: string): Promise<FullMenu> {
  const [menu, listed] = await Promise.all([
    restaurantMenuApi.getMenu(restaurantId).catch(() => ({
      categories: [] as MenuCategory[],
      items: [] as MenuItem[],
    })),
    restaurantMenuApi.getCategories(restaurantId).catch(() => [] as MenuCategory[]),
  ]);

  let items = menu.items;
  if (!itemsLookValid(items)) {
    const flatItems = await restaurantMenuApi
      .getItems(restaurantId)
      .catch(() => [] as MenuItem[]);
    items = mergeItemsById(items, flatItems);
  }

  return buildFullMenu(mergeCategories(listed, menu.categories), items);
}

function filterItemsForCategory(
  items: MenuItem[],
  categories: MenuCategory[],
  categoryId?: string | null
) {
  if (!categoryId) return items;

  const category = categories.find((row) => row.id === categoryId);
  const nameKey = category?.name.trim().toLowerCase() ?? '';

  return items.filter(
    (item) =>
      item.categoryId === categoryId ||
      (!!nameKey && item.categoryName?.trim().toLowerCase() === nameKey)
  );
}

/** Single shared menu query — categories + items come from this. */
export function useRestaurantMenu() {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();

  const query = useQuery({
    queryKey: menuKeys.menu(restaurantId),
    enabled: Boolean(restaurantId),
    queryFn: () => loadFullMenu(restaurantId),
    staleTime: 45_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.menu, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    placeholderData: (previous) => previous,
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useMenuCategories() {
  const menu = useRestaurantMenu();

  return {
    ...menu,
    data: menu.data?.categories ?? [],
  };
}

export function useMenuItems(categoryId?: string | null) {
  const menu = useRestaurantMenu();

  const items = useMemo(
    () =>
      filterItemsForCategory(
        menu.data?.items ?? [],
        menu.data?.categories ?? [],
        categoryId
      ),
    [menu.data?.items, menu.data?.categories, categoryId]
  );

  return {
    ...menu,
    data: items,
  };
}

export function useMenuSearch(restaurantId: string, query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: menuKeys.search(restaurantId, q),
    queryFn: () => restaurantMenuApi.searchMenu(restaurantId, q),
    enabled: Boolean(restaurantId) && q.length >= 2,
    staleTime: 15_000,
  });
}

export function useUnavailableIds(restaurantId: string) {
  return useQuery({
    queryKey: menuKeys.unavailable(restaurantId),
    queryFn: () => restaurantMenuApi.getUnavailable(restaurantId),
    enabled: Boolean(restaurantId),
    staleTime: 15_000,
  });
}

export function useModifierGroups(restaurantId: string) {
  return useQuery({
    queryKey: menuKeys.modifiers(restaurantId),
    queryFn: () => restaurantMenuApi.listModifierGroups(restaurantId),
    enabled: Boolean(restaurantId),
    staleTime: 30_000,
  });
}

/** GET /items?categoryId= — Partner catalog list for one section. */
export function useCategoryItems(restaurantId: string, categoryId: string | null) {
  return useQuery({
    queryKey: menuKeys.items(restaurantId, categoryId ?? undefined),
    queryFn: () => restaurantMenuApi.getItems(restaurantId, categoryId!),
    enabled: Boolean(restaurantId && categoryId),
    staleTime: 20_000,
  });
}

/** GET /items/:itemId — full dish + hydrated modifiers. */
export function useMenuItem(restaurantId: string, itemId: string | null) {
  return useQuery({
    queryKey: [...menuKeys.restaurant(restaurantId), 'item', itemId],
    queryFn: () => restaurantMenuApi.getItem(restaurantId, itemId!),
    enabled: Boolean(restaurantId && itemId),
    staleTime: 15_000,
  });
}

function patchFullMenu(
  queryClient: ReturnType<typeof useQueryClient>,
  restaurantId: string,
  updater: (current: FullMenu) => FullMenu
) {
  queryClient.setQueryData<FullMenu>(menuKeys.menu(restaurantId), (current) => {
    if (!current) return current;
    return updater(current);
  });
}

export function useMenuMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const createCategory = useMutation({
    mutationFn: (payload: CreateCategoryPayload) =>
      restaurantMenuApi.createCategory(restaurantId, payload),
    onSuccess: async (created) => {
      await invalidateMenu(queryClient, restaurantId);
      if (!created?.id) return;
      patchFullMenu(queryClient, restaurantId, (current) => {
        if (current.categories.some((row) => row.id === created.id)) {
          return current;
        }
        return {
          ...current,
          categories: [
            ...current.categories,
            { ...created, itemCount: created.itemCount ?? 0 },
          ],
        };
      });
    },
  });

  const updateCategory = useMutation({
    mutationFn: ({
      categoryId,
      payload,
    }: {
      categoryId: string;
      payload: UpdateCategoryPayload;
    }) => restaurantMenuApi.updateCategory(restaurantId, categoryId, payload),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const deleteCategory = useMutation({
    mutationFn: (categoryId: string) =>
      restaurantMenuApi.deleteCategory(restaurantId, categoryId),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const reorderCategories = useMutation({
    mutationFn: (categoryIds: string[]) =>
      restaurantMenuApi.reorderCategories(restaurantId, categoryIds),
    onMutate: async (categoryIds) => {
      await queryClient.cancelQueries({
        queryKey: menuKeys.menu(restaurantId),
      });
      const previous = queryClient.getQueryData<FullMenu>(
        menuKeys.menu(restaurantId)
      );
      if (previous) {
        const byId = new Map(
          previous.categories.map((category) => [category.id, category])
        );
        const reordered: MenuCategory[] = [];
        categoryIds.forEach((id, index) => {
          const category = byId.get(id);
          if (category) {
            reordered.push({ ...category, sortOrder: index });
          }
        });
        for (const category of previous.categories) {
          if (!categoryIds.includes(category.id)) reordered.push(category);
        }
        queryClient.setQueryData<FullMenu>(menuKeys.menu(restaurantId), {
          ...previous,
          categories: reordered,
        });
      }
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(menuKeys.menu(restaurantId), context.previous);
      }
    },
    onSettled: () => invalidateMenu(queryClient, restaurantId),
  });

  const createItem = useMutation({
    mutationFn: ({
      categoryId,
      payload,
    }: {
      categoryId: string;
      payload: CreateMenuItemPayload;
    }) => restaurantMenuApi.createItem(restaurantId, categoryId, payload),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const updateItem = useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: UpdateMenuItemPayload;
    }) => restaurantMenuApi.updateItem(restaurantId, itemId, payload),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: string) =>
      restaurantMenuApi.deleteItem(restaurantId, itemId),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const setAvailability = useMutation({
    mutationFn: ({
      itemId,
      isAvailable,
      unavailableUntil,
      reason,
    }: {
      itemId: string;
      isAvailable: boolean;
      unavailableUntil?: string | null;
      reason?: string | null;
    }) =>
      restaurantMenuApi.setItemAvailability(restaurantId, itemId, {
        isAvailable,
        unavailableUntil,
        reason,
      } satisfies AvailabilityPayload),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const uploadImage = useMutation({
    mutationFn: ({
      itemId,
      file,
    }: {
      itemId: string;
      file: UploadFilePart;
    }) => restaurantMenuApi.uploadItemImage(restaurantId, itemId, file),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const bulkAvailability = useMutation({
    mutationFn: ({
      itemIds,
      isAvailable,
    }: {
      itemIds: string[];
      isAvailable: boolean;
    }) => restaurantMenuApi.bulkAvailability(restaurantId, itemIds, isAvailable),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const bulkImport = useMutation({
    mutationFn: ({
      categoryId,
      categoryName,
      items,
    }: {
      categoryId: string;
      categoryName: string;
      items: CreateMenuItemPayload[];
    }) =>
      restaurantMenuApi.importItemsToCategory(
        restaurantId,
        categoryId,
        categoryName,
        items
      ),
    onSuccess: async () => {
      await invalidateMenu(queryClient, restaurantId);
      await queryClient.refetchQueries({
        queryKey: menuKeys.menu(restaurantId),
      });
    },
  });

  const updateCategorySchedule = useMutation({
    mutationFn: ({
      categoryId,
      periods,
    }: {
      categoryId: string;
      periods: CategorySchedulePeriod[];
    }) =>
      restaurantMenuApi.updateCategorySchedule(restaurantId, categoryId, periods),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const createModifierGroup = useMutation({
    mutationFn: (payload: CreateModifierGroupPayload) =>
      restaurantMenuApi.createModifierGroup(restaurantId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: menuKeys.modifiers(restaurantId),
      });
      await invalidateMenu(queryClient, restaurantId);
    },
  });

  const updateModifierGroup = useMutation({
    mutationFn: ({
      groupId,
      payload,
    }: {
      groupId: string;
      payload: CreateModifierGroupPayload;
    }) => restaurantMenuApi.updateModifierGroup(restaurantId, groupId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: menuKeys.modifiers(restaurantId),
      });
      await invalidateMenu(queryClient, restaurantId);
    },
  });

  const deleteModifierGroup = useMutation({
    mutationFn: (groupId: string) =>
      restaurantMenuApi.deleteModifierGroup(restaurantId, groupId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: menuKeys.modifiers(restaurantId),
      });
      await invalidateMenu(queryClient, restaurantId);
    },
  });

  const attachItemModifiers = useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: AttachModifiersPayload;
    }) => restaurantMenuApi.attachItemModifiers(restaurantId, itemId, payload),
    onSuccess: async (_data, vars) => {
      await queryClient.invalidateQueries({
        queryKey: menuKeys.customizations(restaurantId, vars.itemId),
      });
      await invalidateMenu(queryClient, restaurantId);
    },
  });

  const duplicateItem = useMutation({
    mutationFn: (itemId: string) =>
      restaurantMenuApi.duplicateItem(restaurantId, itemId),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const deleteItemImage = useMutation({
    mutationFn: (itemId: string) =>
      restaurantMenuApi.deleteItemImage(restaurantId, itemId),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const bulkUpdatePrices = useMutation({
    mutationFn: (
      updates: Array<{ itemId: string; price: number; discountedPrice?: number | null }>
    ) => restaurantMenuApi.bulkUpdatePrices(restaurantId, updates),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  const reorderItems = useMutation({
    mutationFn: ({
      itemIds,
      categoryId,
    }: {
      itemIds: string[];
      categoryId?: string;
    }) => restaurantMenuApi.reorderItems(restaurantId, itemIds, categoryId),
    onSuccess: () => invalidateMenu(queryClient, restaurantId),
  });

  return {
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    createItem,
    updateItem,
    deleteItem,
    setAvailability,
    uploadImage,
    bulkAvailability,
    bulkImport,
    updateCategorySchedule,
    createModifierGroup,
    updateModifierGroup,
    deleteModifierGroup,
    attachItemModifiers,
    duplicateItem,
    deleteItemImage,
    bulkUpdatePrices,
    reorderItems,
  };
}
