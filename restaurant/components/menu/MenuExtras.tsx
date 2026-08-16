import { Image } from 'expo-image';
import {
  ArrowDown,
  ArrowUp,
  Clock3,
  Copy,
  Layers,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import type {
  AttachModifiersPayload,
  CategorySchedulePeriod,
  CreateModifierGroupPayload,
  MealPeriod,
  MenuCategory,
  MenuItem,
  ModifierGroup,
} from '@/lib/restaurant/types';

export const MEAL_OPTIONS: { meal: MealPeriod; label: string; hint: string }[] = [
  { meal: 'breakfast', label: 'Breakfast', hint: '07:00 – 11:00' },
  { meal: 'lunch', label: 'Lunch', hint: '12:00 – 16:00' },
  { meal: 'dinner', label: 'Dinner', hint: '19:00 – 23:00' },
  { meal: 'late_night', label: 'Late night', hint: '23:00 – 02:00' },
];

const WEEKDAYS: { id: string; label: string }[] = [
  { id: 'monday', label: 'M' },
  { id: 'tuesday', label: 'T' },
  { id: 'wednesday', label: 'W' },
  { id: 'thursday', label: 'T' },
  { id: 'friday', label: 'F' },
  { id: 'saturday', label: 'S' },
  { id: 'sunday', label: 'S' },
];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function defaultDays() {
  return WEEKDAYS.map((day) => day.id);
}

export function VegMark({ veg }: { veg?: boolean }) {
  const color = veg === false ? '#B91C1C' : '#15803D';
  return (
    <View style={[styles.vegBox, { borderColor: color }]}>
      <View style={[styles.vegDot, { backgroundColor: color }]} />
    </View>
  );
}

export function money(value?: number) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `₹${Math.round(value)}`;
}

export function MenuItemRow({
  item,
  selected,
  soldOut,
  canMoveUp,
  canMoveDown,
  onSelect,
  onToggleStock,
  onEdit,
  onPhoto,
  onDuplicate,
  onCustomisations,
  onTimed86,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  item: MenuItem;
  selected: boolean;
  soldOut: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onSelect: () => void;
  onToggleStock: () => void;
  onEdit: () => void;
  onPhoto: () => void;
  onDuplicate: () => void;
  onCustomisations: () => void;
  onTimed86: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const inStock = item.isAvailable !== false && !soldOut;
  return (
    <View style={[styles.itemRow, !inStock && styles.itemRowOff]}>
      <Pressable onPress={onSelect} style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Text style={styles.checkMark}>✓</Text> : null}
      </Pressable>
      <Pressable onPress={onPhoto} style={styles.thumb}>
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.thumbImg} contentFit="cover" />
        ) : (
          <UtensilsCrossed color={authTheme.textDim} size={22} />
        )}
      </Pressable>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <VegMark veg={item.isVeg} />
          <Text style={styles.itemName} numberOfLines={1}>
            {item.name}
          </Text>
        </View>
        <Text style={styles.itemPrice}>
          {item.discountPrice ? (
            <>
              <Text style={styles.itemPrice}>{money(item.discountPrice)}  </Text>
              <Text style={styles.strike}>{money(item.price)}</Text>
            </>
          ) : (
            money(item.price)
          )}
        </Text>
        {!inStock ? (
          <Text style={styles.soldMeta} numberOfLines={1}>
            {item.unavailableReason || 'Sold out'}
            {item.unavailableUntil
              ? ` · till ${new Date(item.unavailableUntil).toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : ''}
          </Text>
        ) : null}
        <View style={styles.itemActions}>
          {onMoveUp ? (
            <Pressable onPress={onMoveUp} hitSlop={6} disabled={!canMoveUp} style={{ opacity: canMoveUp ? 1 : 0.3 }}>
              <ArrowUp color={authTheme.textMuted} size={15} />
            </Pressable>
          ) : null}
          {onMoveDown ? (
            <Pressable onPress={onMoveDown} hitSlop={6} disabled={!canMoveDown} style={{ opacity: canMoveDown ? 1 : 0.3 }}>
              <ArrowDown color={authTheme.textMuted} size={15} />
            </Pressable>
          ) : null}
          <Pressable onPress={onEdit} hitSlop={6}>
            <Pencil color={authTheme.textMuted} size={15} />
          </Pressable>
          <Pressable onPress={onCustomisations} hitSlop={6}>
            <Layers color={authTheme.textMuted} size={15} />
          </Pressable>
          <Pressable onPress={onDuplicate} hitSlop={6}>
            <Copy color={authTheme.textMuted} size={15} />
          </Pressable>
          <Pressable onPress={onTimed86} hitSlop={6}>
            <Clock3 color={authTheme.textMuted} size={15} />
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={6}>
            <Trash2 color="#B91C1C" size={15} />
          </Pressable>
        </View>
      </View>
      <View style={styles.stockCol}>
        <Text style={styles.stockLabel}>{inStock ? 'In stock' : '86’d'}</Text>
        <Switch
          value={inStock}
          onValueChange={onToggleStock}
          trackColor={{ false: '#FECACA', true: '#BBF7D0' }}
          thumbColor={inStock ? '#15803D' : '#B91C1C'}
        />
      </View>
    </View>
  );
}

export function CategoryScheduleModal({
  visible,
  categoryName,
  periods,
  busy,
  onClose,
  onSave,
}: {
  visible: boolean;
  categoryName: string;
  periods?: CategorySchedulePeriod[];
  busy?: boolean;
  onClose: () => void;
  onSave: (periods: CategorySchedulePeriod[]) => Promise<void>;
}) {
  const [rows, setRows] = useState<CategorySchedulePeriod[]>(periods ?? []);

  useEffect(() => {
    if (visible) setRows(periods?.length ? periods : []);
  }, [visible, periods]);

  const toggleMeal = (meal: MealPeriod) => {
    setRows((current) => {
      const exists = current.find((row) => row.meal === meal);
      if (exists) return current.filter((row) => row.meal !== meal);
      const defaults: Record<MealPeriod, { from: string; to: string }> = {
        breakfast: { from: '07:00', to: '11:00' },
        lunch: { from: '12:00', to: '16:00' },
        dinner: { from: '19:00', to: '23:00' },
        late_night: { from: '23:00', to: '02:00' },
      };
      return [...current, { meal, ...defaults[meal], days: defaultDays() }];
    });
  };

  const setTime = (meal: MealPeriod, key: 'from' | 'to', value: string) => {
    setRows((current) =>
      current.map((row) => (row.meal === meal ? { ...row, [key]: value } : row))
    );
  };

  const toggleDay = (meal: MealPeriod, day: string) => {
    setRows((current) =>
      current.map((row) => {
        if (row.meal !== meal) return row;
        const days = row.days?.length ? [...row.days] : defaultDays();
        const next = days.includes(day)
          ? days.filter((item) => item !== day)
          : [...days, day];
        return { ...row, days: next.length ? next : defaultDays() };
      })
    );
  };

  const save = async () => {
    for (const row of rows) {
      if (!HHMM.test(row.from) || !HHMM.test(row.to)) {
        Alert.alert('Use 24-hour time', 'Times must look like 07:00 or 23:30.');
        return;
      }
    }
    await onSave(rows);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetWrap}>
        <Pressable style={styles.sheetDim} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Meal hours</Text>
          <Text style={styles.sheetSub}>
            {categoryName} · customers only see this section during these windows
            (same as Partner breakfast / lunch / dinner)
          </Text>
          <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
            {MEAL_OPTIONS.map((option) => {
              const row = rows.find((item) => item.meal === option.meal);
              return (
                <View key={option.meal} style={styles.mealCard}>
                  <Pressable onPress={() => toggleMeal(option.meal)} style={styles.mealToggle}>
                    <View style={[styles.check, row && styles.checkOn]}>
                      {row ? <Text style={styles.checkMark}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mealLabel}>{option.label}</Text>
                      {!row ? (
                        <Text style={styles.sheetSub}>{option.hint}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                  {row ? (
                    <>
                      <View style={styles.timePair}>
                        <TextInput
                          value={row.from}
                          onChangeText={(text) => setTime(option.meal, 'from', text)}
                          placeholder="07:00"
                          keyboardType="numbers-and-punctuation"
                          style={styles.timeInput}
                          maxLength={5}
                        />
                        <Text style={styles.timeDash}>–</Text>
                        <TextInput
                          value={row.to}
                          onChangeText={(text) => setTime(option.meal, 'to', text)}
                          placeholder="11:00"
                          keyboardType="numbers-and-punctuation"
                          style={styles.timeInput}
                          maxLength={5}
                        />
                      </View>
                      <View style={styles.dayRow}>
                        {WEEKDAYS.map((day) => {
                          const on = (row.days?.length ? row.days : defaultDays()).includes(
                            day.id
                          );
                          return (
                            <Pressable
                              key={day.id}
                              onPress={() => toggleDay(option.meal, day.id)}
                              style={[styles.dayChip, on && styles.dayChipOn]}
                            >
                              <Text style={[styles.dayChipText, on && styles.dayChipTextOn]}>
                                {day.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <PrimaryButton
            label={rows.length ? 'Save hours' : 'Show all day'}
            loading={busy}
            onPress={() =>
              void save().catch((error) =>
                Alert.alert('Could not save hours', getApiErrorMessage(error))
              )
            }
          />
          {periods?.length ? (
            <Pressable
              onPress={() =>
                void onSave([]).catch((error) =>
                  Alert.alert('Could not clear hours', getApiErrorMessage(error))
                )
              }
              style={{ alignItems: 'center', padding: 8 }}
            >
              <Text style={styles.cancel}>Clear hours (always visible)</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

export function Timed86Modal({
  visible,
  item,
  busy,
  onClose,
  onSave,
  onRestore,
}: {
  visible: boolean;
  item: MenuItem | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (input: { until?: string; reason: string }) => Promise<void>;
  onRestore?: () => Promise<void>;
}) {
  const [minutes, setMinutes] = useState('60');
  const [reason, setReason] = useState('sold_out');
  if (!item) return null;
  const soldOut = item.isAvailable === false;
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.centerWrap}>
        <View style={styles.card}>
          <Text style={styles.sheetTitle}>{soldOut ? 'Sold out' : 'Mark sold out'}</Text>
          <Text style={styles.sheetSub}>{item.name} · 86 like Partner — customers see “sold out”</Text>
          {soldOut && onRestore ? (
            <PrimaryButton
              label="Back in stock"
              loading={busy}
              onPress={() =>
                void onRestore().catch((error) =>
                  Alert.alert('Could not restore', getApiErrorMessage(error))
                )
              }
            />
          ) : null}
          <Text style={styles.fieldLabel}>Until</Text>
          <View style={styles.chipRow}>
            {[
              { label: '1 hour', value: '60' },
              { label: '2 hours', value: '120' },
              { label: 'Rest of day', value: '' },
            ].map((chip) => (
              <Pressable
                key={chip.label}
                onPress={() => setMinutes(chip.value)}
                style={[styles.reasonChip, minutes === chip.value && styles.reasonChipOn]}
              >
                <Text
                  style={[
                    styles.reasonChipText,
                    minutes === chip.value && styles.reasonChipTextOn,
                  ]}
                >
                  {chip.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={minutes}
            onChangeText={setMinutes}
            keyboardType="number-pad"
            placeholder="Minutes from now"
            style={styles.input}
          />
          <Text style={styles.fieldLabel}>Reason</Text>
          <View style={styles.chipRow}>
            {[
              { id: 'sold_out', label: 'Sold out' },
              { id: 'quality', label: 'Quality' },
              { id: 'packaging', label: 'Packaging' },
              { id: 'closing_soon', label: 'Closing soon' },
            ].map((chip) => (
              <Pressable
                key={chip.id}
                onPress={() => setReason(chip.id)}
                style={[styles.reasonChip, reason === chip.id && styles.reasonChipOn]}
              >
                <Text
                  style={[
                    styles.reasonChipText,
                    reason === chip.id && styles.reasonChipTextOn,
                  ]}
                >
                  {chip.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <PrimaryButton
            label="86 this item"
            loading={busy}
            onPress={() => {
              const mins = Number(minutes);
              const until =
                Number.isFinite(mins) && mins > 0
                  ? new Date(Date.now() + mins * 60_000).toISOString()
                  : undefined;
              void onSave({ until, reason: reason.trim() || 'sold_out' }).catch((error) =>
                Alert.alert('Could not 86', getApiErrorMessage(error))
              );
            }}
          />
          <Pressable onPress={onClose} style={{ alignItems: 'center', padding: 10 }}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function ModifierLibraryModal({
  visible,
  groups,
  busy,
  error,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  visible: boolean;
  groups: ModifierGroup[];
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onCreate: (payload: CreateModifierGroupPayload) => Promise<void>;
  onUpdate: (groupId: string, payload: CreateModifierGroupPayload) => Promise<void>;
  onDelete: (groupId: string) => Promise<void>;
}) {
  type DraftOption = {
    id?: string;
    name: string;
    price: string;
    isDefault: boolean;
    isAvailable: boolean;
  };

  const emptyOption = (): DraftOption => ({
    name: '',
    price: '0',
    isDefault: false,
    isAvailable: true,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [required, setRequired] = useState(true);
  const [allowMany, setAllowMany] = useState(false);
  const [draftOptions, setDraftOptions] = useState<DraftOption[]>([
    { name: 'Regular', price: '0', isDefault: true, isAvailable: true },
    { name: 'Large', price: '40', isDefault: false, isAvailable: true },
  ]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setRequired(true);
    setAllowMany(false);
    setDraftOptions([
      { name: 'Regular', price: '0', isDefault: true, isAvailable: true },
      { name: 'Large', price: '40', isDefault: false, isAvailable: true },
    ]);
  };

  useEffect(() => {
    if (!visible) resetForm();
  }, [visible]);

  const loadGroup = (group: ModifierGroup) => {
    setEditingId(group.id);
    setName(group.name);
    setRequired(group.isRequired);
    setAllowMany(group.maxSelect > 1);
    setDraftOptions(
      group.options.length
        ? group.options.map((option, index) => ({
            id: option.id || undefined,
            name: option.name,
            price: String(option.price ?? 0),
            isDefault: option.isDefault === true || index === 0,
            isAvailable: option.isAvailable !== false,
          }))
        : [emptyOption()]
    );
  };

  const save = async () => {
    const parsed = draftOptions
      .map((option, index) => ({
        id: option.id,
        name: option.name.trim(),
        price: Number(option.price) || 0,
        isDefault: option.isDefault || index === 0,
        isAvailable: option.isAvailable,
      }))
      .filter((option) => option.name);
    const groupName = name.trim() || (editingId ? '' : 'Size');
    if (!groupName) {
      Alert.alert('Name required', 'e.g. Size, Crust, Extra cheese');
      return;
    }
    if (parsed.length < 1) {
      Alert.alert('Add options', 'Customers need at least one choice, like Regular / Large.');
      return;
    }
    if (parsed.length > 20) {
      Alert.alert('Too many options', 'A group can have at most 20 choices.');
      return;
    }
    const payload: CreateModifierGroupPayload = {
      name: groupName,
      isRequired: required,
      minSelect: required ? 1 : 0,
      maxSelect: allowMany ? Math.min(20, parsed.length) : 1,
      options: parsed,
    };
    try {
      if (editingId) await onUpdate(editingId, payload);
      else await onCreate(payload);
      resetForm();
    } catch (caught) {
      Alert.alert('Could not save', getApiErrorMessage(caught));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.sheetDim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Customisations</Text>
              <Text style={styles.sheetSub}>
                Size, crust, toppings — customers pick these like on Swiggy / Zomato.
                Max 50 groups per outlet.
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <ScrollView
            style={styles.sheetScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {groups.length === 0 ? (
              <View style={styles.emptyLib}>
                <Layers color={authTheme.textDim} size={22} />
                <Text style={styles.sheetSub}>
                  No variants yet. Add Size to start — then attach it on each dish.
                </Text>
              </View>
            ) : (
              groups.map((group) => (
                <View key={group.id} style={styles.groupCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName}>{group.name}</Text>
                    <Text style={styles.sheetSub}>
                      {group.isRequired ? 'Required' : 'Optional'}
                      {group.maxSelect > 1 ? ' · pick several' : ' · pick one'}
                      {' · '}
                      {group.options
                        .map((option) =>
                          option.price
                            ? `${option.name} +₹${option.price}`
                            : option.name
                        )
                        .join(' · ')}
                    </Text>
                  </View>
                  <Pressable onPress={() => loadGroup(group)} hitSlop={8}>
                    <Pencil color={authTheme.textMuted} size={16} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert(
                        'Delete customisation?',
                        `${group.name} will be removed from dishes that use it.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () =>
                              void onDelete(group.id).catch((caught) =>
                                Alert.alert('Could not delete', getApiErrorMessage(caught))
                              ),
                          },
                        ]
                      )
                    }
                  >
                    <Trash2 color="#B91C1C" size={16} />
                  </Pressable>
                </View>
              ))
            )}

            <Text style={styles.fieldLabel}>
              {editingId ? 'Edit group' : 'New group'}
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Size, Crust, Extra topping…"
              style={styles.input}
            />
            <Pressable
              onPress={() => setRequired((value) => !value)}
              style={styles.mealToggle}
            >
              <View style={[styles.check, required && styles.checkOn]}>
                {required ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              <Text style={styles.mealLabel}>Required (customer must pick)</Text>
            </Pressable>
            <Pressable
              onPress={() => setAllowMany((value) => !value)}
              style={styles.mealToggle}
            >
              <View style={[styles.check, allowMany && styles.checkOn]}>
                {allowMany ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
              <Text style={styles.mealLabel}>Allow multiple (toppings)</Text>
            </Pressable>

            <Text style={styles.fieldLabel}>Options</Text>
            {draftOptions.map((option, index) => (
              <View key={`${option.id ?? 'new'}-${index}`} style={styles.optionRow}>
                <TextInput
                  value={option.name}
                  onChangeText={(text) =>
                    setDraftOptions((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, name: text } : row
                      )
                    )
                  }
                  placeholder="Regular"
                  style={[styles.input, styles.optionName]}
                />
                <TextInput
                  value={option.price}
                  onChangeText={(text) =>
                    setDraftOptions((current) =>
                      current.map((row, rowIndex) =>
                        rowIndex === index ? { ...row, price: text } : row
                      )
                    )
                  }
                  placeholder="0"
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.optionPrice]}
                />
                <Pressable
                  onPress={() =>
                    setDraftOptions((current) =>
                      current.map((row, rowIndex) => ({
                        ...row,
                        isDefault: rowIndex === index,
                      }))
                    )
                  }
                  style={[styles.defaultChip, option.isDefault && styles.defaultChipOn]}
                >
                  <Text
                    style={[
                      styles.defaultChipText,
                      option.isDefault && styles.defaultChipTextOn,
                    ]}
                  >
                    Default
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    setDraftOptions((current) =>
                      current.length === 1
                        ? current
                        : current.filter((_, rowIndex) => rowIndex !== index)
                    )
                  }
                  hitSlop={6}
                >
                  <Trash2 color="#B91C1C" size={14} />
                </Pressable>
              </View>
            ))}
            {draftOptions.length < 20 ? (
              <Pressable
                style={styles.addOption}
                onPress={() =>
                  setDraftOptions((current) => [...current, emptyOption()])
                }
              >
                <Plus color={authTheme.brand} size={16} />
                <Text style={styles.addOptionText}>Add option</Text>
              </Pressable>
            ) : null}
            {editingId ? (
              <Pressable onPress={resetForm} style={{ alignItems: 'center', padding: 8 }}>
                <Text style={styles.cancel}>Cancel edit</Text>
              </Pressable>
            ) : null}
          </ScrollView>
          <View style={styles.sheetFooter}>
            <PrimaryButton
              label={editingId ? 'Save' : 'Save group'}
              loading={busy}
              onPress={() => {
                if (!name.trim() && !editingId) setName('Size');
                void save();
              }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function CategoryActionsSheet({
  category,
  itemCount,
  canMoveUp,
  canMoveDown,
  onClose,
  onEdit,
  onSchedule,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  category: MenuCategory | null;
  itemCount: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSchedule: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}) {
  if (!category) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetWrap}>
        <Pressable style={styles.sheetDim} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{category.name}</Text>
          <Text style={styles.sheetSub}>
            {itemCount} dish{itemCount === 1 ? '' : 'es'}
            {category.isActive === false ? ' · hidden on customer menu' : ''}
            {category.schedule?.periods?.length
              ? ` · ${category.schedule.periods.length} meal window(s)`
              : ''}
          </Text>
          <Pressable style={styles.actionRow} onPress={onEdit}>
            <Pencil color={authTheme.text} size={18} />
            <Text style={styles.actionText}>Edit name</Text>
          </Pressable>
          <Pressable style={styles.actionRow} onPress={onSchedule}>
            <Clock3 color={authTheme.text} size={18} />
            <Text style={styles.actionText}>Breakfast / lunch / dinner hours</Text>
          </Pressable>
          <Pressable
            style={[styles.actionRow, !canMoveUp && { opacity: 0.4 }]}
            disabled={!canMoveUp}
            onPress={onMoveUp}
          >
            <Text style={styles.actionText}>Move left</Text>
          </Pressable>
          <Pressable
            style={[styles.actionRow, !canMoveDown && { opacity: 0.4 }]}
            disabled={!canMoveDown}
            onPress={onMoveDown}
          >
            <Text style={styles.actionText}>Move right</Text>
          </Pressable>
          <Pressable style={styles.actionRow} onPress={onDelete}>
            <Trash2 color="#B91C1C" size={18} />
            <Text style={[styles.actionText, { color: '#B91C1C' }]}>
              Delete category & dishes
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function ItemModifiersModal({
  visible,
  item,
  library,
  attached,
  busy,
  onClose,
  onSave,
}: {
  visible: boolean;
  item: MenuItem | null;
  library: ModifierGroup[];
  attached: ModifierGroup[];
  busy?: boolean;
  onClose: () => void;
  onSave: (payload: AttachModifiersPayload) => Promise<void>;
}) {
  const attachedById = useMemo(() => {
    const map = new Map<string, ModifierGroup>();
    for (const group of attached) {
      if (group.id) map.set(group.id, group);
      map.set(group.name.trim().toLowerCase(), group);
    }
    return map;
  }, [attached]);

  const [picked, setPicked] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible) return;
    const nextIds: string[] = [];
    const nextPrices: Record<string, string> = {};
    for (const group of library) {
      const attachedGroup =
        attachedById.get(group.id) ||
        attachedById.get(group.name.trim().toLowerCase());
      if (!attachedGroup) continue;
      if (group.id) nextIds.push(group.id);
      for (const option of group.options) {
        if (!option.id) continue;
        const override = attachedGroup.options.find(
          (row) => row.id === option.id || row.name === option.name
        );
        nextPrices[`${group.id}:${option.id}`] = String(
          override?.price ?? option.price ?? 0
        );
      }
    }
    setPicked(nextIds);
    setPrices(nextPrices);
  }, [visible, library, attachedById]);

  if (!item) return null;

  const toggleGroup = (group: ModifierGroup) => {
    if (!group.id) return;
    const on = picked.includes(group.id);
    if (!on && picked.length >= 10) {
      Alert.alert('Limit reached', 'A dish can have at most 10 customisation groups.');
      return;
    }
    setPicked((current) =>
      on ? current.filter((id) => id !== group.id) : [...current, group.id]
    );
    if (!on) {
      setPrices((current) => {
        const next = { ...current };
        for (const option of group.options) {
          if (!option.id) continue;
          const key = `${group.id}:${option.id}`;
          if (next[key] == null) next[key] = String(option.price ?? 0);
        }
        return next;
      });
    }
  };

  const buildPayload = (): AttachModifiersPayload => ({
    attachments: picked.map((groupId) => {
      const group = library.find((row) => row.id === groupId);
      const options = (group?.options ?? [])
        .filter((option) => option.id)
        .map((option) => ({
          optionId: option.id,
          price: Number(prices[`${groupId}:${option.id}`] ?? option.price) || 0,
          isAvailable: option.isAvailable !== false,
        }));
      return {
        groupId,
        ...(options.length ? { options } : {}),
      };
    }),
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.sheetWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.sheetDim} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetTitle}>Variants for {item.name}</Text>
              <Text style={styles.sheetSub}>
                Attach Size / crust from your library. Override add-on price for this dish
                only — same as Partner.
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.sheetScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {library.length === 0 ? (
              <Text style={styles.sheetSub}>
                Create a customisation group first (Variants in the header).
              </Text>
            ) : (
              library.map((group) => {
                const on = picked.includes(group.id);
                return (
                  <View key={group.id} style={styles.attachCard}>
                    <Pressable style={styles.mealToggle} onPress={() => toggleGroup(group)}>
                      <View style={[styles.check, on && styles.checkOn]}>
                        {on ? <Text style={styles.checkMark}>✓</Text> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemName}>{group.name}</Text>
                        <Text style={styles.sheetSub}>
                          {group.isRequired ? 'Required' : 'Optional'}
                          {group.maxSelect > 1 ? ' · pick several' : ' · pick one'}
                        </Text>
                      </View>
                    </Pressable>
                    {on
                      ? group.options.map((option) => (
                          <View key={option.id || option.name} style={styles.overrideRow}>
                            <Text style={styles.overrideName} numberOfLines={1}>
                              {option.name}
                            </Text>
                            <Text style={styles.overridePrefix}>+₹</Text>
                            <TextInput
                              value={
                                prices[`${group.id}:${option.id}`] ??
                                String(option.price ?? 0)
                              }
                              onChangeText={(text) =>
                                setPrices((current) => ({
                                  ...current,
                                  [`${group.id}:${option.id}`]: text,
                                }))
                              }
                              keyboardType="decimal-pad"
                              style={styles.overrideInput}
                            />
                          </View>
                        ))
                      : null}
                  </View>
                );
              })
            )}
          </ScrollView>
          <View style={styles.sheetFooter}>
            <PrimaryButton
              label="Save"
              loading={busy}
              onPress={() =>
                void onSave(buildPayload()).catch((error) =>
                  Alert.alert('Could not attach', getApiErrorMessage(error))
                )
              }
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  vegBox: {
    width: 14,
    height: 14,
    borderWidth: 1.4,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  itemRowOff: { opacity: 0.72 },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.4,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: authTheme.brand, borderColor: authTheme.brand },
  checkMark: { color: '#FFFFFF', fontSize: 12, fontFamily: fonts.bold },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: 64, height: 64 },
  itemBody: { flex: 1, minWidth: 0, gap: 4 },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemName: { flex: 1, color: authTheme.text, fontFamily: fonts.bold, fontSize: 15 },
  itemPrice: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 14 },
  strike: {
    color: authTheme.textDim,
    textDecorationLine: 'line-through',
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  soldMeta: { color: '#B91C1C', fontFamily: fonts.medium, fontSize: 11 },
  itemActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
  stockCol: { alignItems: 'flex-end', gap: 4 },
  stockLabel: { color: authTheme.textMuted, fontFamily: fonts.medium, fontSize: 10 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetDim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.35)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 12,
    gap: 12,
    maxHeight: '92%',
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sheetScroll: { maxHeight: 360 },
  sheetFooter: { paddingTop: 4, paddingBottom: 16 },
  sheetTitle: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 18 },
  sheetSub: { color: authTheme.textMuted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  mealCard: {
    backgroundColor: authTheme.surface,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  mealRow: { marginBottom: 10 },
  mealToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  mealLabel: { color: authTheme.text, fontFamily: fonts.medium, fontSize: 14 },
  timePair: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: fonts.medium,
    color: authTheme.text,
  },
  timeDash: { color: authTheme.textMuted },
  dayRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  dayChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
  },
  dayChipOn: { backgroundColor: authTheme.brand, borderColor: authTheme.brand },
  dayChipText: { color: authTheme.textMuted, fontFamily: fonts.bold, fontSize: 11 },
  dayChipTextOn: { color: '#FFFFFF' },
  errorText: { color: '#B91C1C', fontFamily: fonts.medium, fontSize: 13 },
  emptyLib: { gap: 8, paddingVertical: 8 },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  optionName: { flex: 1, paddingVertical: 8 },
  optionPrice: { width: 64, paddingVertical: 8 },
  defaultChip: {
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  defaultChipOn: { backgroundColor: '#ECFDF5', borderColor: '#86EFAC' },
  defaultChipText: { color: authTheme.textMuted, fontFamily: fonts.bold, fontSize: 10 },
  defaultChipTextOn: { color: '#15803D' },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  addOptionText: { color: authTheme.brand, fontFamily: fonts.bold, fontSize: 13 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  actionText: { color: authTheme.text, fontFamily: fonts.medium, fontSize: 15, flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: {
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  reasonChipOn: { backgroundColor: authTheme.brandSoft, borderColor: authTheme.brand },
  reasonChipText: { color: authTheme.textMuted, fontFamily: fonts.bold, fontSize: 12 },
  reasonChipTextOn: { color: authTheme.brand },
  attachCard: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
    paddingVertical: 10,
  },
  overrideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 28,
    marginBottom: 6,
  },
  overrideName: { flex: 1, color: authTheme.text, fontFamily: fonts.medium, fontSize: 13 },
  overridePrefix: { color: authTheme.textMuted, fontFamily: fonts.medium },
  overrideInput: {
    width: 72,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: fonts.medium,
    color: authTheme.text,
  },
  centerWrap: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 },
  fieldLabel: { color: authTheme.textMuted, fontFamily: fonts.medium, fontSize: 12 },
  input: {
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.medium,
    color: authTheme.text,
  },
  cancel: { color: authTheme.textMuted, fontFamily: fonts.medium },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
});
