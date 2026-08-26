import { Plus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { useMenuMutations } from '@/lib/restaurant/menu-hooks';
import type {
  CreateModifierGroupPayload,
  MenuCategory,
  ModifierGroup,
} from '@/lib/restaurant/types';

type OptionDraft = { name: string; price: string };

type CategoryAddonEditorProps = {
  restaurantId: string;
  category: MenuCategory;
  editing: ModifierGroup | null;
  onCancel: () => void;
  onSaved: () => void;
};

export function CategoryAddonEditor({
  restaurantId,
  category,
  editing,
  onCancel,
  onSaved,
}: CategoryAddonEditorProps) {
  const mutations = useMenuMutations(restaurantId);
  const [name, setName] = useState(editing?.name ?? '');
  const [required, setRequired] = useState(editing?.isRequired ?? false);
  const [maxSelect, setMaxSelect] = useState(
    String(editing?.maxSelect ?? (required ? 1 : 3))
  );
  const [options, setOptions] = useState<OptionDraft[]>(
    editing?.options?.length
      ? editing.options.map((o) => ({
          name: o.name,
          price: String(o.price ?? 0),
        }))
      : [
          { name: '', price: '0' },
          { name: '', price: '0' },
        ]
  );
  const [error, setError] = useState<string | null>(null);
  const saving =
    mutations.createModifierGroup.isPending ||
    mutations.updateModifierGroup.isPending;

  const save = async () => {
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 1) {
      setError('Enter an add-on name (e.g. Size, Toppings).');
      return;
    }
    const cleaned = options
      .map((o) => ({
        name: o.name.trim(),
        price: Number(o.price) || 0,
      }))
      .filter((o) => o.name.length > 0);
    if (!cleaned.length) {
      setError('Add at least one option.');
      return;
    }
    const max = Math.max(1, Number(maxSelect) || 1);
    const payload: CreateModifierGroupPayload = {
      name: trimmed,
      categoryId: category.id,
      isRequired: required,
      minSelect: required ? 1 : 0,
      maxSelect: max,
      options: cleaned.map((o) => ({
        name: o.name,
        price: Math.max(0, o.price),
        isAvailable: true,
      })),
    };
    try {
      if (editing) {
        await mutations.updateModifierGroup.mutateAsync({
          groupId: editing.id,
          payload,
        });
      } else {
        await mutations.createModifierGroup.mutateAsync(payload);
      }
      onSaved();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save add-on'));
    }
  };

  return (
    <View style={styles.editor}>
      <Text style={styles.editorTitle}>
        {editing ? 'Edit add-on' : 'New add-on'} · {category.name}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Size / Toppings / Crust"
        placeholderTextColor={authTheme.textDim}
      />
      <View style={styles.rowBetween}>
        <Text style={styles.label}>Required for customer</Text>
        <Switch
          value={required}
          onValueChange={setRequired}
          trackColor={{ false: '#E2E8F0', true: 'rgba(234,75,20,0.45)' }}
          thumbColor={required ? authTheme.brand : '#F8FAFC'}
        />
      </View>
      <Text style={styles.label}>Max selections</Text>
      <TextInput
        style={styles.input}
        value={maxSelect}
        onChangeText={setMaxSelect}
        keyboardType="number-pad"
        placeholder="1"
        placeholderTextColor={authTheme.textDim}
      />
      <Text style={styles.label}>Options</Text>
      {options.map((opt, index) => (
        <View key={`opt-${index}`} style={styles.optionRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={opt.name}
            onChangeText={(v) =>
              setOptions((prev) =>
                prev.map((row, i) => (i === index ? { ...row, name: v } : row))
              )
            }
            placeholder="Option name"
            placeholderTextColor={authTheme.textDim}
          />
          <TextInput
            style={[styles.input, styles.priceInput]}
            value={opt.price}
            onChangeText={(v) =>
              setOptions((prev) =>
                prev.map((row, i) => (i === index ? { ...row, price: v } : row))
              )
            }
            keyboardType="decimal-pad"
            placeholder="₹"
            placeholderTextColor={authTheme.textDim}
          />
          <Pressable
            onPress={() =>
              setOptions((prev) =>
                prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)
              )
            }
            hitSlop={8}
          >
            <Trash2 color={authTheme.textMuted} size={16} />
          </Pressable>
        </View>
      ))}
      <Pressable
        style={styles.linkBtn}
        onPress={() => setOptions((prev) => [...prev, { name: '', price: '0' }])}
      >
        <Plus color={authTheme.brand} size={14} />
        <Text style={styles.linkBtnText}>Add option</Text>
      </Pressable>
      <View style={styles.editorActions}>
        <Pressable style={styles.outlineBtn} onPress={onCancel} disabled={saving}>
          <Text style={styles.outlineBtnText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={styles.primaryBtn}
          onPress={() => void save()}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Save</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  editor: {
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  editorTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: authTheme.text,
  },
  label: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#FFF',
    fontFamily: fonts.medium,
    color: authTheme.text,
  },
  priceInput: { width: 72 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  linkBtnText: {
    fontFamily: fonts.semibold,
    color: authTheme.brand,
    fontSize: 13,
  },
  editorActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  outlineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  outlineBtnText: { fontFamily: fonts.semibold, color: authTheme.text },
  primaryBtn: {
    flex: 1,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryBtnText: { fontFamily: fonts.semibold, color: '#FFF' },
  error: { color: '#B91C1C', fontFamily: fonts.medium, fontSize: 12 },
});
