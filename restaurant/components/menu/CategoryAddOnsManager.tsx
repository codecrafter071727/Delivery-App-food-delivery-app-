import { ChevronLeft, Layers, Plus, Trash2, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryAddonEditor } from '@/components/menu/CategoryAddonEditor';
import { ItemAddonToggles } from '@/components/menu/ItemAddonToggles';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useMenuMutations,
  useModifierGroups,
} from '@/lib/restaurant/menu-hooks';
import type { MenuCategory, ModifierGroup } from '@/lib/restaurant/types';

type CategoryAddOnsManagerProps = {
  visible: boolean;
  restaurantId: string;
  categories: MenuCategory[];
  onClose: () => void;
  onOpenLibrary?: () => void;
};

export function CategoryAddOnsManager({
  visible,
  restaurantId,
  categories,
  onClose,
  onOpenLibrary,
}: CategoryAddOnsManagerProps) {
  const insets = useSafeAreaInsets();
  const [category, setCategory] = useState<MenuCategory | null>(null);
  const [editing, setEditing] = useState<ModifierGroup | null | 'new'>(null);
  const modifiersQuery = useModifierGroups(restaurantId, category?.id);
  const mutations = useMenuMutations(restaurantId);

  const groups = useMemo(() => {
    const all = modifiersQuery.data ?? [];
    if (!category) return all;
    return all.filter(
      (g) => !g.categoryId || g.categoryId === category.id
    );
  }, [modifiersQuery.data, category]);

  const closeAll = () => {
    setEditing(null);
    setCategory(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={closeAll}
      presentationStyle="pageSheet"
    >
      <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
        <View style={styles.header}>
          {category ? (
            <Pressable
              onPress={() => {
                setEditing(null);
                setCategory(null);
              }}
              hitSlop={8}
              style={styles.iconBtn}
            >
              <ChevronLeft color={authTheme.text} size={22} />
            </Pressable>
          ) : (
            <View style={styles.iconBtn} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {category ? category.name : 'Add-ons'}
            </Text>
            <Text style={styles.subtitle}>
              {category
                ? 'Create size / toppings, then tick dishes for customers'
                : 'Pick a category to manage add-ons'}
            </Text>
          </View>
          <Pressable onPress={closeAll} hitSlop={8} style={styles.iconBtn}>
            <X color={authTheme.textMuted} size={20} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {!category ? (
            <View style={{ gap: 8 }}>
              {onOpenLibrary ? (
                <Pressable
                  style={styles.libraryBtn}
                  onPress={() => {
                    onClose();
                    onOpenLibrary();
                  }}
                >
                  <Layers color={authTheme.brand} size={16} />
                  <Text style={styles.libraryBtnText}>
                    Restaurant-wide variants library
                  </Text>
                </Pressable>
              ) : null}
              {categories.length === 0 ? (
                <Text style={styles.empty}>
                  Create a menu category first, then add add-ons for it.
                </Text>
              ) : (
                categories.map((cat) => (
                  <Pressable
                    key={cat.id}
                    style={styles.catRow}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={styles.catName}>{cat.name}</Text>
                    <Text style={styles.catMeta}>
                      {(cat.itemCount ?? 0) > 0
                        ? `${cat.itemCount} dishes`
                        : 'Open'}
                    </Text>
                  </Pressable>
                ))
              )}
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {editing === 'new' || editing ? (
                <CategoryAddonEditor
                  restaurantId={restaurantId}
                  category={category}
                  editing={editing === 'new' ? null : editing}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    void modifiersQuery.refetch();
                  }}
                />
              ) : (
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => setEditing('new')}
                >
                  <Plus color="#FFF" size={16} />
                  <Text style={styles.primaryBtnText}>Add add-on group</Text>
                </Pressable>
              )}

              {modifiersQuery.isLoading ? (
                <ActivityIndicator color={authTheme.brand} />
              ) : modifiersQuery.isError ? (
                <Text style={styles.error}>
                  {getApiErrorMessage(
                    modifiersQuery.error,
                    'Could not load add-ons'
                  )}
                </Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {groups.map((group) => (
                    <View key={group.id} style={styles.groupCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupName}>{group.name}</Text>
                        <Text style={styles.groupMeta}>
                          {group.options
                            .map(
                              (o) =>
                                `${o.name}${o.price ? ` (+₹${o.price})` : ''}`
                            )
                            .join(' · ') || 'No options'}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => setEditing(group)}
                        hitSlop={8}
                      >
                        <Text style={styles.editLink}>Edit</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          void mutations.deleteModifierGroup
                            .mutateAsync(group.id)
                            .then(() => modifiersQuery.refetch())
                        }
                        hitSlop={8}
                      >
                        <Trash2 color="#B91C1C" size={16} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              <ItemAddonToggles
                restaurantId={restaurantId}
                categoryId={category.id}
                groups={groups}
              />
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFF' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.bold, fontSize: 18, color: authTheme.text },
  subtitle: { fontFamily: fonts.medium, fontSize: 12, color: authTheme.textMuted },
  content: { padding: 16, gap: 10, paddingBottom: 40 },
  empty: { fontFamily: fonts.medium, color: authTheme.textMuted, fontSize: 13 },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFF',
  },
  catName: { fontFamily: fonts.semibold, fontSize: 15, color: authTheme.text },
  catMeta: { fontFamily: fonts.medium, fontSize: 12, color: authTheme.textMuted },
  libraryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: authTheme.brandSoft,
    marginBottom: 4,
  },
  libraryBtnText: {
    fontFamily: fonts.semibold,
    color: authTheme.brand,
    fontSize: 13,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingVertical: 12,
  },
  primaryBtnText: { fontFamily: fonts.semibold, color: '#FFF', fontSize: 14 },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  groupName: { fontFamily: fonts.semibold, fontSize: 14, color: authTheme.text },
  groupMeta: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textMuted,
    marginTop: 2,
  },
  editLink: { fontFamily: fonts.semibold, color: authTheme.brand, fontSize: 13 },
  error: { color: '#B91C1C', fontFamily: fonts.medium, fontSize: 12 },
});
