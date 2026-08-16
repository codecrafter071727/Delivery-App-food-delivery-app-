import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import {
  Camera,
  ChevronDown,
  Clock3,
  Copy,
  FileUp,
  FolderOpen,
  Layers,
  MoreVertical,
  Plus,
  Search,
  Store,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';


import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import {
  CategoryActionsSheet,
  CategoryScheduleModal,
  ItemModifiersModal,
  MenuItemRow,
  ModifierLibraryModal,
  Timed86Modal,
  VegMark,
} from '@/components/menu/MenuExtras';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useCategoryItems,
  useMenuCategories,
  useMenuItem,
  useMenuItems,
  useMenuMutations,
  useMenuSearch,
  useModifierGroups,
  useUnavailableIds,
} from '@/lib/restaurant/menu-hooks';
import { restaurantMenuApi } from '@/lib/restaurant/menu-api';
import { CSV_TEMPLATE, parseMenuCsv } from '@/lib/restaurant/menu-csv';
import type { MenuCategory, MenuItem, ModifierGroup, SpiceLevel } from '@/lib/restaurant/types';

type CategoryModalState =
  | { mode: 'create' }
  | { mode: 'edit'; category: MenuCategory }
  | null;

type ItemModalState =
  | { mode: 'create'; categoryId: string }
  | { mode: 'edit'; item: MenuItem }
  | null;

const SPICE_OPTIONS: SpiceLevel[] = ['none', 'mild', 'medium', 'hot'];
const BULK_PRICE_CAP = 200;
const BULK_IMPORT_CAP = 500;

type BulkPriceMode = 'set' | 'percent' | 'amount';

function roundRupee(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.round(value));
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  required,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  required?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? ' *' : ''}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={authTheme.textDim}
        multiline={multiline}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.textarea]}
      />
    </View>
  );
}

export function MenuManager() {
  const router = useRouter();
  const {
    data: categories = [],
    isLoading: categoriesLoading,
    isRefetching,
    refetch,
    restaurantId,
    restaurantName,
    error: categoriesError,
  } = useMenuCategories();

  /** null = All items (same default as the customer website) */
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [categoryModal, setCategoryModal] = useState<CategoryModalState>(null);
  const [itemModal, setItemModal] = useState<ItemModalState>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [imageItem, setImageItem] = useState<MenuItem | null>(null);
  const [categoryMenuId, setCategoryMenuId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [soldOutOnly, setSoldOutOnly] = useState(false);
  const [scheduleCategory, setScheduleCategory] = useState<MenuCategory | null>(null);
  const [timed86Item, setTimed86Item] = useState<MenuItem | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [attachItem, setAttachItem] = useState<MenuItem | null>(null);
  const [attachedGroups, setAttachedGroups] = useState<ModifierGroup[]>([]);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkPriceMode, setBulkPriceMode] = useState<BulkPriceMode>('set');
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkDiscount, setBulkDiscount] = useState('');

  const selectedCategory =
    selectedCategoryId == null
      ? null
      : categories.find((category) => category.id === selectedCategoryId) ?? null;
  const viewingAll = selectedCategoryId == null;

  const itemsQuery = useMenuItems(selectedCategoryId);
  const categoryItemsQuery = useCategoryItems(restaurantId, selectedCategoryId);
  const menuItems = itemsQuery.data ?? [];
  const items =
    selectedCategoryId && categoryItemsQuery.isSuccess
      ? (categoryItemsQuery.data ?? [])
      : menuItems;
  const mutations = useMenuMutations(restaurantId);
  const searchQuery = useMenuSearch(restaurantId, search);
  const unavailableQuery = useUnavailableIds(restaurantId);
  const modifiersQuery = useModifierGroups(restaurantId);
  const soldOutIdList = unavailableQuery.data?.itemIds;
  const soldOutIds = useMemo(() => new Set(soldOutIdList ?? []), [soldOutIdList]);
  const searching = search.trim().length >= 2;
  const canReorder = Boolean(selectedCategoryId) && !searching && !soldOutOnly;
  const displayedItems = useMemo(() => {
    const source = searching ? (searchQuery.data ?? []) : items;
    if (!soldOutOnly) return source;
    return source.filter(
      (item) => item.isAvailable === false || soldOutIds.has(item.id)
    );
  }, [searching, searchQuery.data, items, soldOutOnly, soldOutIds]);

  useEffect(() => {
    if (
      selectedCategoryId &&
      categories.length &&
      !categories.some((category) => category.id === selectedCategoryId)
    ) {
      setSelectedCategoryId(null);
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    setSelectedItemIds([]);
  }, [selectedCategoryId]);

  const busy =
    mutations.createCategory.isPending ||
    mutations.updateCategory.isPending ||
    mutations.deleteCategory.isPending ||
    mutations.reorderCategories.isPending ||
    mutations.createItem.isPending ||
    mutations.updateItem.isPending ||
    mutations.deleteItem.isPending ||
    mutations.setAvailability.isPending ||
    mutations.uploadImage.isPending ||
    mutations.bulkAvailability.isPending ||
    mutations.bulkImport.isPending ||
    mutations.updateCategorySchedule.isPending ||
    mutations.duplicateItem.isPending ||
    mutations.bulkUpdatePrices.isPending ||
    mutations.reorderItems.isPending ||
    mutations.attachItemModifiers.isPending ||
    mutations.deleteItemImage.isPending;

  const itemCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const category of categories) {
      if (typeof category.itemCount === 'number') {
        map.set(category.id, category.itemCount);
      }
    }
    if (selectedCategoryId) {
      map.set(selectedCategoryId, items.length);
    }
    return map;
  }, [categories, items.length, selectedCategoryId]);

  const fail = (title: string, error: unknown) => {
    Alert.alert(title, getApiErrorMessage(error));
  };

  const toggleSelect = (itemId: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const confirmDeleteCategory = (category: MenuCategory) => {
    setCategoryMenuId(null);
    const count = itemCountByCategory.get(category.id) ?? 0;
    Alert.alert(
      'Delete category?',
      count
        ? `“${category.name}” and ${count} dish${count === 1 ? '' : 'es'} will be removed from the customer menu.`
        : `“${category.name}” will be removed from the menu.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void mutations.deleteCategory.mutateAsync(category.id).catch((error) => {
              fail('Delete failed', error);
            });
          },
        },
      ]
    );
  };

  const moveCategory = (categoryId: string, direction: 'up' | 'down') => {
    setCategoryMenuId(null);
    const index = categories.findIndex((category) => category.id === categoryId);
    if (index < 0) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const next = [...categories];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);

    void mutations.reorderCategories
      .mutateAsync(next.map((category) => category.id))
      .catch((error) => fail('Reorder failed', error));
  };

  const confirmDeleteItem = (item: MenuItem) => {
    Alert.alert(
      'Remove from menu?',
      `“${item.name}” will be deleted for customers. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete dish',
          style: 'destructive',
          onPress: () => {
            void mutations.deleteItem
              .mutateAsync(item.id)
              .then(() => {
                setSelectedItemIds((prev) => prev.filter((id) => id !== item.id));
                setItemModal((current) =>
                  current?.mode === 'edit' && current.item.id === item.id
                    ? null
                    : current
                );
              })
              .catch((error) => fail('Delete failed', error));
          },
        },
      ]
    );
  };

  const toggleStock = (item: MenuItem) => {
    const nextAvailable = item.isAvailable === false || soldOutIds.has(item.id);
    void mutations.setAvailability
      .mutateAsync({ itemId: item.id, isAvailable: nextAvailable })
      .catch((error) => fail('Could not update stock', error));
  };

  const openModifiers = (item: MenuItem) => {
    if (!restaurantId) return;
    void Promise.all([
      restaurantMenuApi.getItem(restaurantId, item.id),
      restaurantMenuApi.getItemCustomizations(restaurantId, item.id),
    ])
      .then(([fresh, groups]) => {
        setAttachedGroups(
          groups.length ? groups : fresh.modifierGroups ?? item.modifierGroups ?? []
        );
        setAttachItem(fresh);
      })
      .catch((error) => fail('Could not load variants', error));
  };

  const duplicateSku = (item: MenuItem) => {
    Alert.alert(
      'Copy this dish?',
      `A new dish named “${item.name} (copy)” will be added to the same category. Photo and variants are copied.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy dish',
          onPress: () => {
            void mutations.duplicateItem
              .mutateAsync(item.id)
              .then((clone) => {
                const categoryId = clone.categoryId || item.categoryId;
                if (categoryId) setSelectedCategoryId(categoryId);
                setSelectedItemIds([]);
                if (clone.id) {
                  setItemModal({ mode: 'edit', item: clone });
                } else {
                  Alert.alert(
                    'Copied',
                    `“${item.name} (copy)” was added. Pull to refresh if you don’t see it.`
                  );
                }
              })
              .catch((error) => fail('Could not duplicate', error));
          },
        },
      ]
    );
  };

  const moveItem = (itemId: string, direction: 'up' | 'down') => {
    if (!selectedCategoryId) {
      Alert.alert(
        'Pick a category',
        'Reorder works inside one category — tap a category chip first.'
      );
      return;
    }
    const index = items.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    void mutations.reorderItems
      .mutateAsync({
        itemIds: next.map((item) => item.id),
        categoryId: selectedCategoryId,
      })
      .catch((error) => fail('Could not reorder items', error));
  };

  const applyBulkAvailability = (isAvailable: boolean) => {
    const itemIds = selectedItemIds.slice(0, BULK_PRICE_CAP);
    const count = itemIds.length;
    void mutations.bulkAvailability
      .mutateAsync({ itemIds, isAvailable })
      .then(() => {
        setSelectedItemIds([]);
        Alert.alert(
          isAvailable ? 'Back in stock' : 'Sold out',
          `${count} dish${count === 1 ? '' : 'es'} ${
            isAvailable ? 'are visible to customers again' : 'are hidden from customers'
          }.`
        );
      })
      .catch((error) => fail('Bulk update failed', error));
  };

  const runBulkAvailability = (isAvailable: boolean) => {
    if (!selectedItemIds.length) {
      Alert.alert('Select dishes', 'Tap the box on the left of each dish first.');
      return;
    }
    if (selectedItemIds.length > BULK_PRICE_CAP) {
      Alert.alert(
        'Too many dishes',
        `You can update at most ${BULK_PRICE_CAP} dishes at a time.`
      );
      return;
    }
    const count = selectedItemIds.length;
    if (!isAvailable) {
      Alert.alert(
        'Mark sold out?',
        `${count} dish${count === 1 ? '' : 'es'} will be hidden from customers until you put them back in stock. Timed 86 is per dish — use the clock on a row.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Sold out',
            style: 'destructive',
            onPress: () => applyBulkAvailability(false),
          },
        ]
      );
      return;
    }
    applyBulkAvailability(true);
  };

  const runBulkPrice = () => {
    if (!selectedItemIds.length) {
      Alert.alert('Select dishes', 'Tap the box on the left of each dish first.');
      return;
    }
    if (selectedItemIds.length > BULK_PRICE_CAP) {
      Alert.alert(
        'Too many dishes',
        `You can change at most ${BULK_PRICE_CAP} prices at a time.`
      );
      return;
    }

    const amount = Number(bulkPrice);
    if (!Number.isFinite(amount)) {
      Alert.alert('Invalid value', 'Enter a number first.');
      return;
    }
    if (bulkPriceMode === 'set' && amount <= 0) {
      Alert.alert('Invalid price', 'Enter a price greater than 0.');
      return;
    }

    const catalog = new Map<string, MenuItem>();
    for (const item of items) catalog.set(item.id, item);
    for (const item of displayedItems) catalog.set(item.id, item);

    const discountRaw = bulkDiscount.trim();
    const setDiscount =
      discountRaw === '' ? null : Number(discountRaw);
    if (
      bulkPriceMode === 'set' &&
      setDiscount != null &&
      (!Number.isFinite(setDiscount) || setDiscount < 0)
    ) {
      Alert.alert('Invalid offer', 'Enter a valid offer price, or leave it blank to remove offers.');
      return;
    }
    if (bulkPriceMode === 'set' && setDiscount != null && setDiscount >= amount) {
      Alert.alert('Offer price', 'Offer must be less than the new price.');
      return;
    }

    const updates: Array<{
      itemId: string;
      price: number;
      discountedPrice: number | null;
    }> = [];

    for (const itemId of selectedItemIds) {
      const item = catalog.get(itemId);
      if (!item) continue;

      let nextPrice = item.price;
      let nextOffer = item.discountPrice ?? null;

      if (bulkPriceMode === 'set') {
        nextPrice = roundRupee(amount);
        nextOffer =
          setDiscount == null || setDiscount === 0 ? null : roundRupee(setDiscount);
      } else if (bulkPriceMode === 'percent') {
        const factor = 1 + amount / 100;
        nextPrice = roundRupee(item.price * factor);
        nextOffer =
          item.discountPrice != null
            ? roundRupee(item.discountPrice * factor)
            : null;
      } else {
        nextPrice = roundRupee(item.price + amount);
        nextOffer =
          item.discountPrice != null
            ? roundRupee(item.discountPrice + amount)
            : null;
      }

      if (nextOffer != null && nextOffer >= nextPrice) nextOffer = null;

      updates.push({
        itemId,
        price: nextPrice,
        discountedPrice: nextOffer,
      });
    }

    if (!updates.length) {
      Alert.alert('Nothing to update', 'Selected dishes could not be priced. Pull to refresh and try again.');
      return;
    }

    void mutations.bulkUpdatePrices
      .mutateAsync(updates)
      .then(() => {
        setBulkPriceOpen(false);
        setBulkPriceMode('set');
        setBulkPrice('');
        setBulkDiscount('');
        setSelectedItemIds([]);
        Alert.alert('Prices updated', `${updates.length} dish${updates.length === 1 ? '' : 'es'} now use the new price.`);
      })
      .catch((error) => fail('Could not update prices', error));
  };

  if (!restaurantId && categoriesLoading) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator color={authTheme.brand} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Menu"
        subtitle={restaurantName || 'Categories, items & 86'}
        hideActions
        headerRight={
          <Pressable style={styles.headerIconBtn} onPress={() => setLibraryOpen(true)}>
            <Layers color={authTheme.brand} size={18} />
            <Text style={styles.headerIconBtnText}>Variants</Text>
          </Pressable>
        }
      >
        <View style={styles.searchWrap}>
          <Search color={authTheme.textMuted} size={16} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search dishes to 86…"
            placeholderTextColor={authTheme.textDim}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <X color={authTheme.textMuted} size={16} />
            </Pressable>
          ) : null}
        </View>
      </RestaurantPageHeader>

      <View style={styles.toolbar}>
        <Pressable
          style={styles.outlineBtn}
          onPress={() => router.push('/chain')}
        >
          <Store color={authTheme.brand} size={16} />
          <Text style={styles.outlineBtnText}>Outlets</Text>
        </Pressable>
        <Pressable
          style={styles.outlineBtn}
          onPress={() => setBulkOpen(true)}
          disabled={!categories.length}
        >
          <FileUp color={authTheme.brand} size={16} />
          <Text style={styles.outlineBtnText}>Import</Text>
        </Pressable>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => setCategoryModal({ mode: 'create' })}
        >
          <Plus color="#FFFFFF" size={16} />
          <Text style={styles.primaryBtnText}>Category</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={
              isRefetching ||
              itemsQuery.isRefetching ||
              categoryItemsQuery.isRefetching
            }
            onRefresh={() => {
              void refetch();
              void itemsQuery.refetch();
              void categoryItemsQuery.refetch();
              void unavailableQuery.refetch();
              void modifiersQuery.refetch();
              if (searching) void searchQuery.refetch();
            }}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
      >
        {categoriesError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {getApiErrorMessage(categoriesError, 'Failed to load menu')}
            </Text>
          </View>
        ) : null}

        {unavailableQuery.data?.itemIds?.length ? (
          <Pressable
            style={[styles.soldStrip, soldOutOnly && styles.soldStripOn]}
            onPress={() => setSoldOutOnly((value) => !value)}
          >
            <Text style={[styles.soldStripText, soldOutOnly && { color: '#FFFFFF' }]}>
              {unavailableQuery.data.itemIds.length} sold out
              {soldOutOnly ? ' · showing 86’d only' : ' · tap to filter'}
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Categories</Text>
          <Text style={styles.sectionMeta}>{categories.length} total</Text>
        </View>

        {categoriesLoading ? (
          <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 20 }} />
        ) : categories.length === 0 ? (
          <View style={styles.emptyCard}>
            <FolderOpen color={authTheme.textDim} size={28} />
            <Text style={styles.emptyTitle}>No categories yet</Text>
            <Text style={styles.emptyText}>
              Create your first category to start adding menu items.
            </Text>
            <Pressable
              style={[styles.primaryBtn, { alignSelf: 'center', marginTop: 12 }]}
              onPress={() => setCategoryModal({ mode: 'create' })}
            >
              <Plus color="#FFFFFF" size={16} />
              <Text style={styles.primaryBtnText}>Add Category</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryList}
          >
            <Pressable
              onPress={() => {
                setCategoryMenuId(null);
                setSelectedCategoryId(null);
              }}
              style={[styles.catPill, viewingAll && styles.catPillOn]}
            >
              <UtensilsCrossed
                color={viewingAll ? '#FFFFFF' : authTheme.brand}
                size={14}
              />
              <Text
                style={[styles.catPillText, viewingAll && styles.catPillTextOn]}
              >
                All
              </Text>
              <Text
                style={[styles.catPillCount, viewingAll && styles.catPillTextOn]}
              >
                {viewingAll
                  ? items.length
                  : categories.reduce(
                      (sum, category) => sum + (category.itemCount ?? 0),
                      0
                    )}
              </Text>
            </Pressable>

            {categories.map((category) => {
              const active = category.id === selectedCategoryId;
              const count = itemCountByCategory.get(category.id);
              const scheduled = Boolean(category.schedule?.periods?.length);
              const hidden = category.isActive === false;

              return (
                <View key={category.id} style={styles.catPillWrap}>
                  <Pressable
                    onPress={() => {
                      setCategoryMenuId(null);
                      setSelectedCategoryId(category.id);
                    }}
                    onLongPress={() => setCategoryMenuId(category.id)}
                    style={[
                      styles.catPill,
                      active && styles.catPillOn,
                      hidden && !active && { opacity: 0.55 },
                    ]}
                  >
                    <Text
                      style={[styles.catPillText, active && styles.catPillTextOn]}
                      numberOfLines={1}
                    >
                      {category.name}
                    </Text>
                    <Text
                      style={[styles.catPillCount, active && styles.catPillTextOn]}
                    >
                      {count ?? 0}
                    </Text>
                    {scheduled ? (
                      <Clock3
                        color={active ? '#FFFFFF' : authTheme.textMuted}
                        size={12}
                      />
                    ) : null}
                    {hidden ? (
                      <Text
                        style={[styles.catPillCount, active && styles.catPillTextOn]}
                      >
                        Off
                      </Text>
                    ) : null}
                    <Pressable
                      hitSlop={8}
                      onPress={(event) => {
                        event.stopPropagation?.();
                        setCategoryMenuId(category.id);
                      }}
                    >
                      <MoreVertical
                        color={active ? '#FFFFFF' : authTheme.textDim}
                        size={14}
                      />
                    </Pressable>
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
        )}

        {categories.length > 0 ? (
          <>
            <View style={[styles.sectionHead, { marginTop: 8 }]}>
              <Text style={styles.sectionTitle}>
                {searching
                  ? `Search (${displayedItems.length})`
                  : soldOutOnly
                    ? `Sold out (${displayedItems.length})`
                    : viewingAll
                      ? `All items (${displayedItems.length})`
                      : `${selectedCategory?.name ?? 'Items'} (${displayedItems.length})`}
              </Text>
              <View style={styles.sectionHeadActions}>
                {displayedItems.length > 0 ? (
                  <Pressable
                    onPress={() =>
                      setSelectedItemIds(displayedItems.map((item) => item.id))
                    }
                  >
                    <Text style={styles.selectAllText}>Select</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.greenBtn}
                  onPress={() => {
                    const categoryId = selectedCategory?.id ?? categories[0]?.id;
                    if (!categoryId) {
                      Alert.alert(
                        'Add a category first',
                        'Create a category before adding items.'
                      );
                      return;
                    }
                    setItemModal({ mode: 'create', categoryId });
                  }}
                >
                  <Plus color="#15803D" size={16} />
                  <Text style={styles.greenBtnText}>Add Item</Text>
                </Pressable>
              </View>
            </View>

            {searchQuery.isError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>
                  {getApiErrorMessage(searchQuery.error, 'Search failed')}
                </Text>
              </View>
            ) : null}

            {categoryItemsQuery.isError ? (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>
                  {getApiErrorMessage(
                    categoryItemsQuery.error,
                    'Could not load dishes for this category'
                  )}
                </Text>
              </View>
            ) : null}

            {selectedItemIds.length > 0 ? (
              <View style={styles.bulkBar}>
                <View style={styles.bulkBarTop}>
                  <Text style={styles.bulkBarText}>
                    {selectedItemIds.length} selected
                  </Text>
                  <Pressable
                    onPress={() =>
                      setSelectedItemIds(displayedItems.map((item) => item.id))
                    }
                  >
                    <Text style={styles.bulkAction}>All</Text>
                  </Pressable>
                  <Pressable onPress={() => setSelectedItemIds([])}>
                    <Text style={styles.bulkAction}>Clear</Text>
                  </Pressable>
                </View>
                <View style={styles.bulkBarActions}>
                  <Pressable onPress={() => runBulkAvailability(true)}>
                    <Text style={styles.bulkAction}>In stock</Text>
                  </Pressable>
                  <Pressable onPress={() => runBulkAvailability(false)}>
                    <Text style={styles.bulkActionDanger}>Sold out</Text>
                  </Pressable>
                  <Pressable onPress={() => setBulkPriceOpen(true)}>
                    <Text style={styles.bulkAction}>Price</Text>
                  </Pressable>
                  {selectedItemIds.length === 1 ? (
                    <Pressable
                      onPress={() => {
                        const item =
                          displayedItems.find((row) => row.id === selectedItemIds[0]) ??
                          items.find((row) => row.id === selectedItemIds[0]);
                        if (item) duplicateSku(item);
                      }}
                    >
                      <Text style={styles.bulkAction}>Copy</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {canReorder ? (
              <Text style={styles.reorderHint}>
                Use the arrows on a dish to change the order customers see.
              </Text>
            ) : null}

            {(searching
              ? searchQuery.isFetching
              : selectedCategoryId
                ? categoryItemsQuery.isLoading && !categoryItemsQuery.data
                : itemsQuery.isLoading) ? (
              <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 24 }} />
            ) : displayedItems.length === 0 ? (
              <View style={styles.emptyCard}>
                <UtensilsCrossed color={authTheme.textDim} size={28} />
                <Text style={styles.emptyTitle}>
                  {searching
                    ? 'No dishes match'
                    : soldOutOnly
                      ? 'Nothing is 86’d'
                      : 'No items in this category'}
                </Text>
                <Text style={styles.emptyText}>
                  {searching
                    ? 'Try another SKU name.'
                    : 'Add your first dish or import from CSV.'}
                </Text>
              </View>
            ) : (
              <View style={styles.itemList}>
                {displayedItems.map((item) => {
                  const orderIndex = canReorder
                    ? items.findIndex((row) => row.id === item.id)
                    : -1;
                  return (
                    <MenuItemRow
                      key={item.id}
                      item={item}
                      selected={selectedItemIds.includes(item.id)}
                      soldOut={soldOutIds.has(item.id)}
                      canMoveUp={orderIndex > 0}
                      canMoveDown={orderIndex >= 0 && orderIndex < items.length - 1}
                      onSelect={() => toggleSelect(item.id)}
                      onToggleStock={() => toggleStock(item)}
                      onEdit={() => setItemModal({ mode: 'edit', item })}
                      onPhoto={() => setImageItem(item)}
                      onDuplicate={() => duplicateSku(item)}
                      onCustomisations={() => openModifiers(item)}
                      onTimed86={() => setTimed86Item(item)}
                      onDelete={() => confirmDeleteItem(item)}
                      onMoveUp={
                        canReorder ? () => moveItem(item.id, 'up') : undefined
                      }
                      onMoveDown={
                        canReorder ? () => moveItem(item.id, 'down') : undefined
                      }
                    />
                  );
                })}
              </View>
            )}
          </>
        ) : null}

        {busy ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator color={authTheme.brand} />
          </View>
        ) : null}
      </ScrollView>

      <CategoryFormModal
        state={categoryModal}
        onClose={() => setCategoryModal(null)}
        onSubmit={async (payload) => {
          if (!categoryModal) return;
          try {
            if (categoryModal.mode === 'create') {
              const created = await mutations.createCategory.mutateAsync({
                name: payload.name,
                description: payload.description,
              });
              if (created?.id) setSelectedCategoryId(created.id);
            } else {
              await mutations.updateCategory.mutateAsync({
                categoryId: categoryModal.category.id,
                payload: {
                  name: payload.name,
                  description: payload.description,
                  isActive: payload.isActive,
                },
              });
            }
            setCategoryModal(null);
          } catch (error) {
            fail('Save failed', error);
          }
        }}
      />

      <ItemFormModal
        state={itemModal}
        restaurantId={restaurantId}
        categories={categories}
        onClose={() => setItemModal(null)}
        onVariants={openModifiers}
        onTimed86={(item) => setTimed86Item(item)}
        onDuplicate={
          itemModal?.mode === 'edit' ? () => duplicateSku(itemModal.item) : undefined
        }
        onDelete={
          itemModal?.mode === 'edit'
            ? () => confirmDeleteItem(itemModal.item)
            : undefined
        }
        onUploadPhoto={async (file) => {
          if (itemModal?.mode !== 'edit') return;
          const updated = await mutations.uploadImage.mutateAsync({
            itemId: itemModal.item.id,
            file,
          });
          setItemModal({ mode: 'edit', item: updated });
        }}
        onRemovePhoto={async () => {
          if (itemModal?.mode !== 'edit') return;
          const updated = await mutations.deleteItemImage.mutateAsync(
            itemModal.item.id
          );
          setItemModal({
            mode: 'edit',
            item: { ...itemModal.item, ...updated, imageUrl: undefined },
          });
        }}
        onSubmit={async (payload) => {
          if (!itemModal) return;
          try {
            if (itemModal.mode === 'create') {
              const created = await mutations.createItem.mutateAsync({
                categoryId: payload.categoryId,
                payload: {
                  name: payload.name,
                  description: payload.description,
                  price: payload.price,
                  discountPrice: payload.discountPrice,
                  isVeg: payload.isVeg,
                  isAvailable: payload.isAvailable,
                  spiceLevel: payload.spiceLevel,
                  tags: payload.tags,
                },
              });
              if (!created?.id) {
                throw new Error('Dish was created but no id came back. Pull to refresh.');
              }
              if (payload.image) {
                await mutations.uploadImage.mutateAsync({
                  itemId: created.id,
                  file: payload.image,
                });
              }
              if (payload.isAvailable === false) {
                await mutations.setAvailability.mutateAsync({
                  itemId: created.id,
                  isAvailable: false,
                });
              }
              setSelectedCategoryId(payload.categoryId);
              const fresh = await restaurantMenuApi
                .getItem(restaurantId, created.id)
                .catch(() => created);
              setItemModal({ mode: 'edit', item: fresh });
              Alert.alert(
                'Dish added',
                'Add a photo and Size/crust variants if customers should see them.'
              );
              return;
            }
            const itemId = itemModal.item.id;
            await mutations.updateItem.mutateAsync({
              itemId,
              payload: {
                name: payload.name,
                description: payload.description,
                price: payload.price,
                discountPrice: payload.discountPrice,
                isVeg: payload.isVeg,
                spiceLevel: payload.spiceLevel,
                tags: payload.tags,
              },
            });
            if (
              payload.isAvailable !== undefined &&
              payload.isAvailable !== (itemModal.item.isAvailable !== false)
            ) {
              await mutations.setAvailability.mutateAsync({
                itemId,
                isAvailable: payload.isAvailable,
              });
            }
            setItemModal(null);
          } catch (error) {
            fail('Save failed', error);
          }
        }}
      />

      <BulkImportModal
        open={bulkOpen}
        categories={categories}
        defaultCategoryId={selectedCategoryId ?? categories[0]?.id ?? null}
        onClose={() => setBulkOpen(false)}
        onImport={async (categoryId, parsed) => {
          const categoryName =
            categories.find((category) => category.id === categoryId)?.name ??
            'Category';
          try {
            const result = await mutations.bulkImport.mutateAsync({
              categoryId,
              categoryName,
              items: parsed.map((item) => ({
                ...item,
                isAvailable: true,
              })),
            });
            setBulkOpen(false);
            setSelectedCategoryId(categoryId);
            Alert.alert(
              'Imported',
              `${result.created} dish${result.created === 1 ? '' : 'es'} added to ${categoryName}${
                result.mode === 'manual' ? ' (added one by one)' : ''
              }.`
            );
          } catch (error) {
            fail('Import failed', error);
          }
        }}
      />

      <ImageUploadModal
        item={imageItem}
        onClose={() => setImageItem(null)}
        onUpload={async (file) => {
          if (!imageItem) return;
          try {
            await mutations.uploadImage.mutateAsync({
              itemId: imageItem.id,
              file,
            });
            setImageItem(null);
            Alert.alert('Uploaded', 'Item image updated.');
          } catch (error) {
            fail('Upload failed', error);
          }
        }}
        onDelete={
          imageItem?.imageUrl
            ? async () => {
                if (!imageItem) return;
                try {
                  await mutations.deleteItemImage.mutateAsync(imageItem.id);
                  setImageItem(null);
                  Alert.alert('Removed', 'Item photo deleted.');
                } catch (error) {
                  fail('Could not remove photo', error);
                }
              }
            : undefined
        }
      />

      <CategoryActionsSheet
        category={categories.find((category) => category.id === categoryMenuId) ?? null}
        itemCount={
          categoryMenuId ? (itemCountByCategory.get(categoryMenuId) ?? 0) : 0
        }
        canMoveUp={
          categoryMenuId
            ? categories.findIndex((category) => category.id === categoryMenuId) > 0
            : false
        }
        canMoveDown={
          categoryMenuId
            ? categories.findIndex((category) => category.id === categoryMenuId) <
              categories.length - 1
            : false
        }
        onClose={() => setCategoryMenuId(null)}
        onEdit={() => {
          const category = categories.find((row) => row.id === categoryMenuId);
          setCategoryMenuId(null);
          if (category) setCategoryModal({ mode: 'edit', category });
        }}
        onSchedule={() => {
          const category = categories.find((row) => row.id === categoryMenuId);
          setCategoryMenuId(null);
          if (category) setScheduleCategory(category);
        }}
        onMoveUp={() => {
          if (categoryMenuId) moveCategory(categoryMenuId, 'up');
        }}
        onMoveDown={() => {
          if (categoryMenuId) moveCategory(categoryMenuId, 'down');
        }}
        onDelete={() => {
          const category = categories.find((row) => row.id === categoryMenuId);
          if (category) confirmDeleteCategory(category);
        }}
      />

      <CategoryScheduleModal
        visible={Boolean(scheduleCategory)}
        categoryName={scheduleCategory?.name ?? ''}
        periods={scheduleCategory?.schedule?.periods}
        busy={mutations.updateCategorySchedule.isPending}
        onClose={() => setScheduleCategory(null)}
        onSave={async (periods) => {
          if (!scheduleCategory) return;
          await mutations.updateCategorySchedule.mutateAsync({
            categoryId: scheduleCategory.id,
            periods,
          });
          setScheduleCategory(null);
        }}
      />

      <Timed86Modal
        visible={Boolean(timed86Item)}
        item={timed86Item}
        busy={mutations.setAvailability.isPending}
        onClose={() => setTimed86Item(null)}
        onSave={async ({ until, reason }) => {
          if (!timed86Item) return;
          const updated = await mutations.setAvailability.mutateAsync({
            itemId: timed86Item.id,
            isAvailable: false,
            unavailableUntil: until ?? null,
            reason,
          });
          setTimed86Item(null);
          if (itemModal?.mode === 'edit' && itemModal.item.id === timed86Item.id) {
            setItemModal({ mode: 'edit', item: { ...itemModal.item, ...updated } });
          }
        }}
        onRestore={async () => {
          if (!timed86Item) return;
          const updated = await mutations.setAvailability.mutateAsync({
            itemId: timed86Item.id,
            isAvailable: true,
          });
          setTimed86Item(null);
          if (itemModal?.mode === 'edit' && itemModal.item.id === timed86Item.id) {
            setItemModal({ mode: 'edit', item: { ...itemModal.item, ...updated } });
          }
        }}
      />

      <ModifierLibraryModal
        visible={libraryOpen}
        groups={modifiersQuery.data ?? []}
        error={
          modifiersQuery.isError
            ? getApiErrorMessage(modifiersQuery.error, 'Could not load customisations')
            : null
        }
        busy={
          mutations.createModifierGroup.isPending ||
          mutations.updateModifierGroup.isPending ||
          mutations.deleteModifierGroup.isPending
        }
        onClose={() => setLibraryOpen(false)}
        onCreate={async (payload) => {
          await mutations.createModifierGroup.mutateAsync(payload);
        }}
        onUpdate={async (groupId, payload) => {
          await mutations.updateModifierGroup.mutateAsync({ groupId, payload });
        }}
        onDelete={async (groupId) => {
          await mutations.deleteModifierGroup.mutateAsync(groupId);
        }}
      />

      <ItemModifiersModal
        visible={Boolean(attachItem)}
        item={attachItem}
        library={modifiersQuery.data ?? []}
        attached={attachedGroups}
        busy={mutations.attachItemModifiers.isPending}
        onClose={() => setAttachItem(null)}
        onSave={async (payload) => {
          if (!attachItem) return;
          const groups = await mutations.attachItemModifiers.mutateAsync({
            itemId: attachItem.id,
            payload,
          });
          setAttachItem(null);
          if (itemModal?.mode === 'edit' && itemModal.item.id === attachItem.id) {
            setItemModal({
              mode: 'edit',
              item: { ...itemModal.item, modifierGroups: groups },
            });
          }
        }}
      />

      <Modal
        visible={bulkPriceOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setBulkPriceOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change prices</Text>
              <Pressable
                onPress={() => {
                  setBulkPriceOpen(false);
                  setBulkPriceMode('set');
                  setBulkPrice('');
                  setBulkDiscount('');
                }}
              >
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>
            <Text style={styles.fieldLabel}>
              Applies to {selectedItemIds.length} selected dish
              {selectedItemIds.length === 1 ? '' : 'es'}
            </Text>
            <View style={styles.priceModeRow}>
              {(
                [
                  { id: 'set' as const, label: 'Set ₹' },
                  { id: 'percent' as const, label: 'By %' },
                  { id: 'amount' as const, label: 'By ₹' },
                ] as const
              ).map((mode) => (
                <Pressable
                  key={mode.id}
                  style={[
                    styles.priceModeChip,
                    bulkPriceMode === mode.id && styles.priceModeChipOn,
                  ]}
                  onPress={() => setBulkPriceMode(mode.id)}
                >
                  <Text
                    style={[
                      styles.priceModeChipText,
                      bulkPriceMode === mode.id && styles.priceModeChipTextOn,
                    ]}
                  >
                    {mode.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Field
              label={
                bulkPriceMode === 'set'
                  ? 'New price (₹)'
                  : bulkPriceMode === 'percent'
                    ? 'Change by %'
                    : 'Change by ₹'
              }
              required
              value={bulkPrice}
              onChangeText={setBulkPrice}
              placeholder={
                bulkPriceMode === 'set'
                  ? '199'
                  : bulkPriceMode === 'percent'
                    ? '10 or -10'
                    : '20 or -20'
              }
              keyboardType="decimal-pad"
            />
            {bulkPriceMode === 'set' ? (
              <Field
                label="Offer price (₹)"
                value={bulkDiscount}
                onChangeText={setBulkDiscount}
                placeholder="Leave blank to remove offers"
                keyboardType="decimal-pad"
              />
            ) : (
              <Text style={styles.fieldHint}>
                Existing offer prices move by the same{' '}
                {bulkPriceMode === 'percent' ? '%' : '₹'}. Offers that would meet
                or beat the new price are cleared.
              </Text>
            )}
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancel}
                onPress={() => {
                  setBulkPriceOpen(false);
                  setBulkPriceMode('set');
                  setBulkPrice('');
                  setBulkDiscount('');
                }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalPrimary} onPress={runBulkPrice}>
                <Text style={styles.modalPrimaryText}>Update prices</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function CategoryFormModal({
  state,
  onClose,
  onSubmit,
}: {
  state: CategoryModalState;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    description?: string;
    isActive?: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!state) return;
    if (state.mode === 'edit') {
      setName(state.category.name);
      setDescription(state.category.description ?? '');
      setIsActive(state.category.isActive !== false);
    } else {
      setName('');
      setDescription('');
      setIsActive(true);
    }
  }, [state]);

  return (
    <Modal visible={Boolean(state)} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {state?.mode === 'edit' ? 'Edit category' : 'Add category'}
            </Text>
            <Pressable onPress={onClose}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>
          <Text style={styles.fieldHint}>
            Same as Partner menu sections — name shows on the customer app.
          </Text>
          <Field
            label="Category name"
            required
            value={name}
            onChangeText={setName}
            placeholder="Recommended, Breads, Desserts…"
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Optional note for kitchen staff"
            multiline
          />
          {state?.mode === 'edit' ? (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Visible on menu</Text>
                <Text style={styles.fieldHint}>
                  Off hides this section from customers (still in Partner).
                </Text>
              </View>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ true: '#BBF7D0', false: '#E5E7EB' }}
                thumbColor={isActive ? '#15803D' : '#FFFFFF'}
              />
            </View>
          ) : null}
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.modalPrimary}
              disabled={saving || !name.trim()}
              onPress={() => {
                setSaving(true);
                void onSubmit({
                  name: name.trim(),
                  description: description.trim() || undefined,
                  ...(state?.mode === 'edit' ? { isActive } : {}),
                }).finally(() => setSaving(false));
              }}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.modalPrimaryText}>
                  {state?.mode === 'edit' ? 'Save changes' : 'Add category'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ItemFormModal({
  state,
  restaurantId,
  categories,
  onClose,
  onSubmit,
  onVariants,
  onTimed86,
  onDuplicate,
  onDelete,
  onUploadPhoto,
  onRemovePhoto,
}: {
  state: ItemModalState;
  restaurantId: string;
  categories: MenuCategory[];
  onClose: () => void;
  onSubmit: (payload: {
    categoryId: string;
    name: string;
    description?: string;
    price: number;
    discountPrice?: number;
    isVeg?: boolean;
    isAvailable?: boolean;
    spiceLevel?: string;
    tags?: string;
    image?: { uri: string; name: string; type: string };
  }) => Promise<void>;
  onVariants?: (item: MenuItem) => void;
  onTimed86?: (item: MenuItem) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onUploadPhoto?: (file: {
    uri: string;
    name: string;
    type: string;
  }) => Promise<void>;
  onRemovePhoto?: () => Promise<void>;
}) {
  const editId = state?.mode === 'edit' ? state.item.id : null;
  const itemQuery = useMenuItem(restaurantId, editId);
  const liveItem =
    state?.mode === 'edit' ? (itemQuery.data ?? state.item) : null;

  const [categoryId, setCategoryId] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [discountPrice, setDiscountPrice] = useState('');
  const [isVeg, setIsVeg] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);
  const [spiceLevel, setSpiceLevel] = useState<SpiceLevel>('mild');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingImage, setPendingImage] = useState<{
    uri: string;
    name: string;
    type: string;
  } | null>(null);

  const applyItem = (item: MenuItem) => {
    setCategoryId(item.categoryId ?? '');
    setName(item.name);
    setDescription(item.description ?? '');
    setPrice(String(item.price ?? ''));
    setDiscountPrice(item.discountPrice != null ? String(item.discountPrice) : '');
    setIsVeg(item.isVeg !== false);
    setIsAvailable(item.isAvailable !== false);
    setSpiceLevel(
      (item.spiceLevel as SpiceLevel) &&
        SPICE_OPTIONS.includes(item.spiceLevel as SpiceLevel)
        ? (item.spiceLevel as SpiceLevel)
        : 'mild'
    );
    setTags((item.tags ?? []).join(', '));
  };

  useEffect(() => {
    if (!state) return;
    setCategoryOpen(false);
    setPendingImage(null);
    if (state.mode === 'edit') {
      applyItem(state.item);
    } else {
      setCategoryId(state.categoryId || categories[0]?.id || '');
      setName('');
      setDescription('');
      setPrice('');
      setDiscountPrice('');
      setIsVeg(true);
      setIsAvailable(true);
      setSpiceLevel('mild');
      setTags('');
    }
  }, [state, categories]);

  useEffect(() => {
    if (editId && itemQuery.data?.id === editId) {
      applyItem(itemQuery.data);
    }
  }, [editId, itemQuery.isFetched]);

  const selectedCategoryName =
    categories.find((category) => category.id === categoryId)?.name ||
    (state?.mode === 'edit' ? state.item.categoryName : undefined) ||
    'Select category';

  const photoUri = pendingImage?.uri || liveItem?.imageUrl;
  const variantCount = liveItem?.modifierGroups?.length ?? 0;

  const pickPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to upload dish photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const file = {
      uri: asset.uri,
      name: asset.fileName ?? `item-${Date.now()}.jpg`,
      type: asset.mimeType ?? 'image/jpeg',
    };
    if (state?.mode === 'edit' && onUploadPhoto) {
      setSaving(true);
      try {
        await onUploadPhoto(file);
      } catch (error) {
        Alert.alert('Upload failed', getApiErrorMessage(error));
      } finally {
        setSaving(false);
      }
      return;
    }
    setPendingImage(file);
  };

  return (
    <Modal visible={Boolean(state)} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <ScrollView contentContainerStyle={styles.modalScroll}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {state?.mode === 'edit' ? 'Edit dish' : 'Add dish'}
              </Text>
              <Pressable onPress={onClose}>
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>

            {state?.mode === 'edit' && itemQuery.isError ? (
              <Text style={styles.previewErrorText}>
                {getApiErrorMessage(itemQuery.error, 'Could not load this dish')}
              </Text>
            ) : null}
            {state?.mode === 'edit' && itemQuery.isFetching && !itemQuery.data ? (
              <ActivityIndicator color={authTheme.brand} style={{ marginBottom: 12 }} />
            ) : null}

            <Pressable style={styles.dishPhoto} onPress={() => void pickPhoto()} disabled={saving}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.dishPhotoImg} contentFit="cover" />
              ) : (
                <>
                  <Camera color={authTheme.textDim} size={22} />
                  <Text style={styles.dishPhotoHint}>Add dish photo</Text>
                </>
              )}
            </Pressable>
            {state?.mode === 'edit' && liveItem?.imageUrl && onRemovePhoto ? (
              <Pressable
                onPress={() => {
                  Alert.alert('Remove photo?', 'Customers will see no dish image.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () =>
                        void onRemovePhoto().catch((error) =>
                          Alert.alert('Could not remove', getApiErrorMessage(error))
                        ),
                    },
                  ]);
                }}
                style={{ alignItems: 'center', marginBottom: 12 }}
              >
                <Text style={styles.modalCancelText}>Remove photo</Text>
              </Pressable>
            ) : null}

            <Text style={styles.fieldLabel}>Veg / Non-veg</Text>
            <View style={styles.vegPickRow}>
              <Pressable
                style={[styles.vegPick, isVeg && styles.vegPickOn]}
                onPress={() => setIsVeg(true)}
              >
                <VegMark veg />
                <Text style={styles.vegPickText}>Veg</Text>
              </Pressable>
              <Pressable
                style={[styles.vegPick, !isVeg && styles.vegPickNon]}
                onPress={() => setIsVeg(false)}
              >
                <VegMark veg={false} />
                <Text style={styles.vegPickText}>Non-veg</Text>
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>
              Category{state?.mode === 'create' ? ' *' : ''}
            </Text>
            {state?.mode === 'create' ? (
              <View style={styles.dropdownWrap}>
                <Pressable
                  style={styles.dropdownTrigger}
                  onPress={() => setCategoryOpen((open) => !open)}
                >
                  <Text
                    style={[
                      styles.dropdownValue,
                      !categoryId && styles.dropdownPlaceholder,
                    ]}
                    numberOfLines={1}
                  >
                    {selectedCategoryName}
                  </Text>
                  <ChevronDown
                    color={authTheme.textMuted}
                    size={18}
                    style={{
                      transform: [{ rotate: categoryOpen ? '180deg' : '0deg' }],
                    }}
                  />
                </Pressable>
                {categoryOpen ? (
                  <View style={styles.dropdownList}>
                    {categories.length === 0 ? (
                      <Text style={styles.dropdownEmpty}>
                        No categories yet. Create one first.
                      </Text>
                    ) : (
                      categories.map((category) => {
                        const active = category.id === categoryId;
                        return (
                          <Pressable
                            key={category.id}
                            style={[
                              styles.dropdownOption,
                              active && styles.dropdownOptionOn,
                            ]}
                            onPress={() => {
                              setCategoryId(category.id);
                              setCategoryOpen(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.dropdownOptionText,
                                active && styles.dropdownOptionTextOn,
                              ]}
                              numberOfLines={1}
                            >
                              {category.name}
                            </Text>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={[styles.dropdownTrigger, styles.dropdownReadonly]}>
                <Text style={styles.dropdownValue} numberOfLines={1}>
                  {selectedCategoryName}
                </Text>
              </View>
            )}

            <Field
              label="Item Name"
              required
              value={name}
              onChangeText={setName}
              placeholder="e.g., Margherita Pizza"
            />
            <Field
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="Describe this item"
              multiline
            />
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Field
                  label="Price (₹)"
                  required
                  value={price}
                  onChangeText={setPrice}
                  placeholder="299"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ width: 12 }} />
              <View style={{ flex: 1 }}>
                <Field
                  label="Offer price (₹)"
                  value={discountPrice}
                  onChangeText={setDiscountPrice}
                  placeholder="Optional"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>In stock</Text>
                <Text style={styles.fieldHint}>
                  Off 86’s this dish. Use the clock for a timed sold-out.
                </Text>
              </View>
              <Switch
                value={isAvailable}
                onValueChange={setIsAvailable}
                trackColor={{ true: '#BBF7D0', false: '#FECACA' }}
                thumbColor={isAvailable ? '#15803D' : '#B91C1C'}
              />
            </View>
            {state?.mode === 'edit' && liveItem && onTimed86 ? (
              <Pressable style={styles.variantBtn} onPress={() => onTimed86(liveItem)}>
                <Clock3 color={authTheme.brand} size={16} />
                <Text style={styles.variantBtnText}>
                  {isAvailable ? 'Mark sold out until…' : 'Sold out · change 86 window'}
                </Text>
              </Pressable>
            ) : null}

            {state?.mode === 'edit' && liveItem && onVariants ? (
              <Pressable style={styles.variantBtn} onPress={() => onVariants(liveItem)}>
                <Layers color={authTheme.brand} size={16} />
                <Text style={styles.variantBtnText}>
                  {variantCount
                    ? `${variantCount} customisation group(s)`
                    : 'Add Size / crust / toppings'}
                </Text>
              </Pressable>
            ) : null}

            {state?.mode === 'edit' && (onDuplicate || onDelete) ? (
              <View style={styles.dishToolRow}>
                {onDuplicate ? (
                  <Pressable style={styles.dishToolBtn} onPress={onDuplicate}>
                    <Copy color={authTheme.textMuted} size={15} />
                    <Text style={styles.dishToolText}>Copy dish</Text>
                  </Pressable>
                ) : null}
                {onDelete ? (
                  <Pressable style={styles.dishToolBtn} onPress={onDelete}>
                    <Trash2 color="#B91C1C" size={15} />
                    <Text style={[styles.dishToolText, { color: '#B91C1C' }]}>
                      Delete
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Spice Level</Text>
            <View style={styles.spiceRow}>
              {SPICE_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  style={[
                    styles.spiceChip,
                    spiceLevel === option && styles.spiceChipOn,
                  ]}
                  onPress={() => setSpiceLevel(option)}
                >
                  <Text
                    style={[
                      styles.spiceChipText,
                      spiceLevel === option && styles.spiceChipTextOn,
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Field
              label="Tags (comma-separated)"
              value={tags}
              onChangeText={setTags}
              placeholder="bestseller, cheese"
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalPrimary}
                disabled={
                  saving ||
                  !name.trim() ||
                  !price.trim() ||
                  (state?.mode === 'create' && !categoryId)
                }
                onPress={() => {
                  const parsedPrice = Number(price);
                  const parsedDiscount =
                    discountPrice.trim() === ''
                      ? undefined
                      : Number(discountPrice);
                  if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
                    Alert.alert('Invalid price', 'Enter a price greater than 0.');
                    return;
                  }
                  if (
                    parsedDiscount != null &&
                    Number.isFinite(parsedDiscount) &&
                    parsedDiscount >= parsedPrice
                  ) {
                    Alert.alert(
                      'Offer price',
                      'Offer price must be less than the original price.'
                    );
                    return;
                  }
                  if (state?.mode === 'create' && !categoryId) {
                    Alert.alert('Select category', 'Choose a category for this item.');
                    return;
                  }
                  setSaving(true);
                  void onSubmit({
                    categoryId:
                      categoryId ||
                      (state?.mode === 'edit' ? state.item.categoryId ?? '' : ''),
                    name: name.trim(),
                    description: description.trim() || undefined,
                    price: parsedPrice,
                    discountPrice: Number.isFinite(parsedDiscount)
                      ? parsedDiscount
                      : undefined,
                    isVeg,
                    isAvailable,
                    spiceLevel,
                    tags: tags.trim() || undefined,
                    image: pendingImage ?? undefined,
                  }).finally(() => setSaving(false));
                }}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalPrimaryText}>
                    {state?.mode === 'edit' ? 'Save dish' : 'Add dish'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function BulkImportModal({
  open,
  categories,
  defaultCategoryId,
  onClose,
  onImport,
}: {
  open: boolean;
  categories: MenuCategory[];
  defaultCategoryId: string | null;
  onClose: () => void;
  onImport: (
    categoryId: string,
    items: ReturnType<typeof parseMenuCsv>
  ) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState(defaultCategoryId ?? '');
  const [csv, setCsv] = useState(CSV_TEMPLATE);
  const [previewItems, setPreviewItems] = useState<ReturnType<typeof parseMenuCsv> | null>(
    null
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCategoryId(defaultCategoryId || categories[0]?.id || '');
      setPreviewItems(null);
      setPreviewError(null);
    }
  }, [open, defaultCategoryId, categories]);

  const runParsePreview = () => {
    try {
      const parsed = parseMenuCsv(csv);
      setPreviewItems(parsed);
      setPreviewError(null);
      if (!parsed.length) {
        setPreviewError('No valid rows found. Check headers and values.');
      }
    } catch (error) {
      setPreviewItems(null);
      setPreviewError(
        error instanceof Error ? error.message : 'Could not parse CSV'
      );
    }
  };

  return (
    <Modal visible={open} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <ScrollView contentContainerStyle={styles.modalScroll}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import dishes</Text>
              <Pressable onPress={onClose}>
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>

            <View style={styles.hintBox}>
              <Text style={styles.hintText}>
                Paste CSV (max {BULK_IMPORT_CAP} rows). Headers: name, description,
                price, discountPrice, isVeg, spiceLevel, tags. isVeg = true/false.
                spiceLevel = none/mild/medium/hot/extra_hot. Offer must be less than
                price.
              </Text>
            </View>

            <Text style={styles.fieldLabel}>Target Category</Text>
            <View style={styles.categoryPicker}>
              {categories.map((category) => (
                <Pressable
                  key={category.id}
                  style={[
                    styles.pickerChip,
                    categoryId === category.id && styles.pickerChipOn,
                  ]}
                  onPress={() => setCategoryId(category.id)}
                >
                  <Text
                    style={[
                      styles.pickerChipText,
                      categoryId === category.id && styles.pickerChipTextOn,
                    ]}
                  >
                    {category.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Field
              label="Paste CSV"
              value={csv}
              onChangeText={(value) => {
                setCsv(value);
                setPreviewItems(null);
                setPreviewError(null);
              }}
              multiline
              placeholder={CSV_TEMPLATE}
            />

            <Pressable style={styles.parsePreviewBtn} onPress={runParsePreview}>
              <Text style={styles.parsePreviewBtnText}>Parse Preview</Text>
            </Pressable>

            {previewError ? (
              <View style={styles.previewErrorBox}>
                <Text style={styles.previewErrorText}>{previewError}</Text>
              </View>
            ) : null}

            {previewItems != null && previewItems.length > 0 ? (
              <View style={styles.previewBox}>
                <Text style={styles.previewTitle}>
                  Preview ready · {previewItems.length} dish
                  {previewItems.length === 1 ? '' : 'es'}
                  {previewItems.length >= BULK_IMPORT_CAP ? ` (capped at ${BULK_IMPORT_CAP})` : ''}
                </Text>
                {previewItems.slice(0, 8).map((item, index) => (
                  <View key={`${item.name}-${index}`} style={styles.previewRow}>
                    <Text style={styles.previewName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.previewMeta} numberOfLines={1}>
                      ₹{item.price}
                      {item.isVeg != null ? (item.isVeg ? ' · Veg' : ' · Non-veg') : ''}
                      {item.spiceLevel ? ` · ${item.spiceLevel}` : ''}
                    </Text>
                  </View>
                ))}
                {previewItems.length > 8 ? (
                  <Text style={styles.previewMore}>
                    +{previewItems.length - 8} more…
                  </Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalPrimary}
                disabled={saving || !categoryId}
                onPress={() => {
                  try {
                    const parsed = previewItems ?? parseMenuCsv(csv);
                    if (!parsed.length) {
                      setPreviewError('No valid rows found. Tap Parse Preview first.');
                      return;
                    }
                    if (parsed.length > BULK_IMPORT_CAP) {
                      setPreviewError(
                        `Import at most ${BULK_IMPORT_CAP} dishes at a time.`
                      );
                      return;
                    }
                    setSaving(true);
                    void onImport(categoryId, parsed).finally(() => setSaving(false));
                  } catch (error) {
                    setPreviewError(
                      error instanceof Error ? error.message : 'Could not parse CSV'
                    );
                  }
                }}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalPrimaryText}>Import</Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ImageUploadModal({
  item,
  onClose,
  onUpload,
  onDelete,
}: {
  item: MenuItem | null;
  onClose: () => void;
  onUpload: (file: {
    uri: string;
    name: string;
    type: string;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to upload images.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setSaving(true);
    try {
      await onUpload({
        uri: asset.uri,
        name: asset.fileName ?? `item-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={Boolean(item)} animationType="fade" transparent>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Upload Item Image</Text>
            <Pressable onPress={onClose}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>
          <Pressable style={styles.uploadBox} onPress={() => void pick()} disabled={saving}>
            {saving ? (
              <ActivityIndicator color={authTheme.brand} />
            ) : (
              <>
                <Camera color={authTheme.textDim} size={28} />
                <Text style={styles.uploadText}>Click to select image</Text>
                <Text style={styles.uploadHint}>{item?.name}</Text>
              </>
            )}
          </Pressable>
          {onDelete ? (
            <Pressable
              style={[styles.modalCancel, { marginBottom: 10 }]}
              disabled={saving}
              onPress={() => {
                Alert.alert('Remove photo?', 'Customers will see no dish image.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: () => {
                      setSaving(true);
                      void onDelete().finally(() => setSaving(false));
                    },
                  },
                ]);
              }}
            >
              <Text style={styles.modalCancelText}>Remove photo</Text>
            </Pressable>
          ) : null}
          <View style={styles.modalActions}>
            <Pressable style={styles.modalCancel} onPress={onClose}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={styles.modalPrimary}
              onPress={() => void pick()}
              disabled={saving}
            >
              <Text style={styles.modalPrimaryText}>Upload</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  headerIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: authTheme.surface,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  headerIconBtnText: {
    color: authTheme.brand,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.medium,
    paddingVertical: 4,
  },
  soldStrip: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  soldStripOn: {
    backgroundColor: '#B91C1C',
    borderColor: '#B91C1C',
  },
  soldStripText: {
    color: '#B91C1C',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  catPillWrap: {
    position: 'relative',
    zIndex: 1,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 220,
  },
  catPillOn: {
    backgroundColor: authTheme.brand,
    borderColor: authTheme.brand,
  },
  catPillText: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.bold,
    maxWidth: 120,
  },
  catPillTextOn: {
    color: '#FFFFFF',
  },
  catPillCount: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  topHeaderCustom: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  topHeaderTitle: {
    fontFamily: fonts.extraBold,
    fontSize: 24,
    color: authTheme.text,
  },
  topHeaderSubtitle: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
  },
  toolbar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 12,
  },
  outlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: authTheme.surface,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    borderRadius: 10,
    paddingVertical: 12,
  },
  outlineBtnText: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  greenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#86EFAC',
    backgroundColor: '#F0FDF4',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  greenBtnText: {
    color: '#15803D',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  scroll: { flex: 1 },
  content: {
    padding: 16,
    paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
    gap: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sectionHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectAllText: {
    color: authTheme.brand,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  reorderHint: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    marginTop: -4,
  },
  sectionTitle: {
    color: authTheme.text,
    fontSize: 17,
    fontFamily: fonts.extraBold,
    flex: 1,
    marginRight: 8,
  },
  sectionMeta: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  categoryList: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 8,
    paddingRight: 8,
  },
  categoryCard: {
    width: 110,
    height: 110,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    zIndex: 1,
  },
  categoryCardActive: {
    borderColor: authTheme.brand,
    backgroundColor: '#FFF8F9',
  },
  categoryMenu: {
    position: 'absolute',
    top: 40,
    left: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 8,
    width: 168,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  categoryMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 10,
    borderRadius: 8,
  },
  categoryMenuItemDisabled: { opacity: 0.5 },
  categoryMenuText: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  categoryMenuTextDisabled: { color: authTheme.textDim },
  categoryMenuDanger: {
    color: '#B91C1C',
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  categoryMenuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: authTheme.cardBorder,
    marginVertical: 4,
  },
  categoryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  categoryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  categoryIconActive: {
    backgroundColor: authTheme.brand,
  },
  categoryName: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.bold,
    textAlign: 'center',
  },
  categorySub: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.medium,
    textAlign: 'center',
    marginTop: 2,
  },
  categoryMoreBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 24,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: {
    marginTop: 8,
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  emptyText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontFamily: fonts.medium,
  },
  bulkBar: {
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
  },
  bulkBarTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bulkBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 14,
  },
  bulkBarText: {
    flex: 1,
    color: authTheme.text,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  bulkAction: {
    color: '#15803D',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  bulkActionDanger: {
    color: '#B91C1C',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  itemList: { gap: 8 },
  itemCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    overflow: 'hidden',
  },
  itemImageContainer: {
    position: 'relative',
    width: '100%',
  },
  itemImageWrap: {
    width: '100%',
    height: 180,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxAbsolute: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: authTheme.brand,
    borderColor: authTheme.brand,
  },
  checkboxMark: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  itemImage: {
    width: '100%',
    height: '100%',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
    padding: 8,
  },
  itemBody: { 
    padding: 16,
  },
  itemName: {
    color: authTheme.text,
    fontSize: 18,
    fontFamily: fonts.bold,
  },
  categoryBelong: {
    color: authTheme.brand,
    fontSize: 10,
    fontFamily: fonts.semiBold,
    marginTop: 1,
  },
  itemDesc: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    lineHeight: 18,
    marginTop: 8,
  },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeOff: { backgroundColor: '#FEF2F2' },
  statusBadgeText: {
    color: '#15803D',
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  statusBadgeTextOff: { color: '#B91C1C' },
  metaBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaBadgeText: {
    color: authTheme.textDim,
    fontSize: 10,
    fontFamily: fonts.semiBold,
    textTransform: 'capitalize',
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  price: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  discount: {
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: {
    backgroundColor: '#F8FAFC',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  tagText: {
    color: authTheme.textMuted,
    fontSize: 10,
    fontFamily: fonts.medium,
  },
  itemActions: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  editBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: authTheme.cardBorder,
  },
  editBtnText: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  deleteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  deleteBtnText: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  busyOverlay: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.1)',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  modalTitle: {
    color: authTheme.text,
    fontSize: 18,
    fontFamily: fonts.extraBold,
  },
  dishPhoto: {
    height: 140,
    borderRadius: 16,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
  },
  dishPhotoImg: { width: '100%', height: '100%' },
  dishPhotoHint: {
    marginTop: 6,
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  vegPickRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  vegPick: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    borderRadius: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  vegPickOn: { borderColor: '#15803D', backgroundColor: '#F0FDF4' },
  vegPickNon: { borderColor: '#B91C1C', backgroundColor: '#FEF2F2' },
  vegPickText: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 13 },
  variantBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    backgroundColor: authTheme.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  variantBtnText: { color: authTheme.text, fontFamily: fonts.medium, fontSize: 13, flex: 1 },
  dishToolRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  dishToolBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    borderRadius: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  dishToolText: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 13 },
  priceModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  priceModeChip: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  priceModeChipOn: {
    borderColor: authTheme.brand,
    backgroundColor: authTheme.brandSoft,
  },
  priceModeChipText: {
    color: authTheme.textMuted,
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  priceModeChipTextOn: { color: authTheme.brand },
  field: { marginBottom: 12 },
  fieldLabel: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.semiBold,
    marginBottom: 6,
  },
  fieldHint: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    marginBottom: 10,
    lineHeight: 16,
  },
  dropdownWrap: {
    marginBottom: 12,
    zIndex: 20,
  },
  dropdownTrigger: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  dropdownValue: {
    flex: 1,
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  dropdownPlaceholder: {
    color: authTheme.textDim,
  },
  dropdownList: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
  },
  dropdownEmpty: {
    padding: 12,
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
  },
  dropdownOption: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E2E8F0',
  },
  dropdownOptionOn: {
    backgroundColor: '#FDF2F4',
  },
  dropdownOptionText: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  dropdownOptionTextOn: {
    color: authTheme.brand,
    fontFamily: fonts.semiBold,
  },
  dropdownReadonly: {
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.medium,
  },
  textarea: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  row2: { flexDirection: 'row' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  spiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  spiceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  spiceChipOn: {
    backgroundColor: authTheme.brandSoft,
    borderColor: authTheme.brand,
  },
  spiceChipText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
    textTransform: 'capitalize',
  },
  spiceChipTextOn: { color: authTheme.brand },
  modalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  modalCancel: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalCancelText: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  modalSecondary: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  modalSecondaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  modalPrimary: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    minHeight: 46,
  },
  modalPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  hintBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  hintText: {
    color: '#9A3412',
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
  },
  categoryPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  pickerChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pickerChipOn: {
    backgroundColor: authTheme.brand,
    borderColor: authTheme.brand,
  },
  pickerChipText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  pickerChipTextOn: { color: '#FFFFFF' },
  previewText: {
    color: '#15803D',
    fontSize: 12,
    fontFamily: fonts.bold,
    marginBottom: 8,
  },
  parsePreviewBtn: {
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginBottom: 12,
  },
  parsePreviewBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  previewBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  previewTitle: {
    color: '#15803D',
    fontSize: 13,
    fontFamily: fonts.bold,
    marginBottom: 2,
  },
  previewRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#BBF7D0',
    paddingTop: 8,
  },
  previewName: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  previewMeta: {
    marginTop: 2,
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  previewMore: {
    color: '#15803D',
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  previewErrorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 12,
    marginBottom: 12,
  },
  previewErrorText: {
    color: '#B91C1C',
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  uploadBox: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#CBD5E1',
    borderRadius: 16,
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
    backgroundColor: '#F8FAFC',
  },
  uploadText: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  uploadHint: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
});
