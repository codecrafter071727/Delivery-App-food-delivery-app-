import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { restaurantMenuApi } from '@/lib/restaurant/menu-api';
import {
  useCategoryItems,
  useMenuMutations,
} from '@/lib/restaurant/menu-hooks';
import type { MenuItem, ModifierGroup } from '@/lib/restaurant/types';

type ItemAddonTogglesProps = {
  restaurantId: string;
  categoryId: string;
  groups: ModifierGroup[];
};

/** Per-dish checkboxes: which category add-ons customers see on that item. */
export function ItemAddonToggles({
  restaurantId,
  categoryId,
  groups,
}: ItemAddonTogglesProps) {
  const itemsQuery = useCategoryItems(restaurantId, categoryId);
  const mutations = useMenuMutations(restaurantId);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const items = itemsQuery.data ?? [];

  const toggle = async (item: MenuItem, group: ModifierGroup, on: boolean) => {
    setError(null);
    setBusyItemId(item.id);
    try {
      const fresh = await restaurantMenuApi.getItem(restaurantId, item.id);
      const current = fresh.modifierGroups ?? item.modifierGroups ?? [];
      const attachedIds = new Set(current.map((g) => g.id));
      if (on) attachedIds.add(group.id);
      else attachedIds.delete(group.id);
      await mutations.attachItemModifiers.mutateAsync({
        itemId: item.id,
        payload: {
          attachments: [...attachedIds].map((groupId) => ({ groupId })),
        },
      });
      await itemsQuery.refetch();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not update dish add-ons'));
    } finally {
      setBusyItemId(null);
    }
  };

  if (!groups.length) {
    return (
      <Text style={styles.hint}>
        Create an add-on above, then tick dishes that should show it to customers.
      </Text>
    );
  }

  if (itemsQuery.isLoading) {
    return <ActivityIndicator color={authTheme.brand} style={{ marginTop: 12 }} />;
  }

  return (
    <View style={{ gap: 10, marginTop: 8 }}>
      <Text style={styles.sectionTitle}>Show on dishes</Text>
      <Text style={styles.hint}>
        Checked add-ons appear for customers on that dish and on the bill.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {items.length === 0 ? (
        <Text style={styles.hint}>No dishes in this category yet.</Text>
      ) : (
        items.map((item) => {
          const attached = new Set((item.modifierGroups ?? []).map((g) => g.id));
          return (
            <View key={item.id} style={styles.itemCard}>
              <Text style={styles.itemName}>{item.name}</Text>
              {groups.map((group) => {
                const on = attached.has(group.id);
                return (
                  <View key={group.id} style={styles.rowBetween}>
                    <Text style={styles.groupChip}>{group.name}</Text>
                    <Switch
                      value={on}
                      disabled={busyItemId === item.id}
                      onValueChange={(next) => void toggle(item, group, next)}
                      trackColor={{
                        false: '#E2E8F0',
                        true: 'rgba(34, 197, 94, 0.45)',
                      }}
                      thumbColor={on ? '#16A34A' : '#F8FAFC'}
                    />
                  </View>
                );
              })}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.medium, fontSize: 12, color: authTheme.textMuted },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: authTheme.text,
  },
  error: { color: '#B91C1C', fontFamily: fonts.medium, fontSize: 12 },
  itemCard: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 10,
    gap: 6,
    backgroundColor: '#FFF',
  },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, color: authTheme.text },
  groupChip: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
