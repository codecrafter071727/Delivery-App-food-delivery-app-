import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Building2,
  CircleAlert,
  Copy,
  IndianRupee,
  Settings2,
  Store,
  UtensilsCrossed,
} from 'lucide-react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useChainMutations,
  useChainSiblings,
} from '@/lib/restaurant/chain-hooks';
import type {
  ChainApplyResult,
  ChainCloneMode,
  ChainCloneResult,
  ChainMatchBy,
  ChainSettingsResult,
  ChainSibling,
} from '@/lib/restaurant/chain-types';

const MAX_TARGETS = 20;

type ResultState =
  | { kind: 'clone'; data: ChainCloneResult }
  | { kind: 'apply'; data: ChainApplyResult }
  | { kind: 'settings'; data: ChainSettingsResult };

export function ChainManager() {
  const siblingsQuery = useChainSiblings();
  const restaurantId = siblingsQuery.restaurantId;
  const mutations = useChainMutations(restaurantId);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cloneMode, setCloneMode] = useState<ChainCloneMode>('merge');
  const [matchBy, setMatchBy] = useState<ChainMatchBy>('name_and_category');
  const [result, setResult] = useState<ResultState | null>(null);

  const siblings = siblingsQuery.data ?? [];
  const source = siblings.find((row) => row.isSource);
  const targets = siblings.filter((row) => !row.isSource);

  const selected = useMemo(
    () => targets.filter((row) => selectedIds.includes(row.restaurantId)),
    [targets, selectedIds]
  );

  const busy =
    mutations.cloneMenu.isPending ||
    mutations.applyPrices.isPending ||
    mutations.applyAvailability.isPending ||
    mutations.applySettings.isPending;

  const fail = (title: string, error: unknown) => {
    Alert.alert(title, getApiErrorMessage(error));
  };

  const requireTargets = () => {
    if (!selected.length) {
      Alert.alert(
        'Pick outlets',
        'Select at least one other outlet. This outlet stays the source.'
      );
      return false;
    }
    if (selected.length > MAX_TARGETS) {
      Alert.alert(
        'Too many outlets',
        `You can sync at most ${MAX_TARGETS} outlets at a time.`
      );
      return false;
    }
    return true;
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id]
    );
  };

  const runClone = () => {
    if (!requireTargets()) return;
    const names = selected.map((row) => row.name).join(', ');
    Alert.alert(
      cloneMode === 'replace' ? 'Replace menus?' : 'Copy menu?',
      cloneMode === 'replace'
        ? `This will clear menus at ${names} and copy this outlet’s catalog. Dishes that already exist by name+category are not kept.`
        : `Dishes from this outlet will be added to ${names}. Same name in the same category is skipped.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: cloneMode === 'replace' ? 'Replace' : 'Copy menu',
          style: cloneMode === 'replace' ? 'destructive' : 'default',
          onPress: () => {
            void mutations.cloneMenu
              .mutateAsync({
                targetRestaurantIds: selected.map((row) => row.restaurantId),
                mode: cloneMode,
              })
              .then((data) => setResult({ kind: 'clone', data }))
              .catch((error) => fail('Could not copy menu', error));
          },
        },
      ]
    );
  };

  const runPrices = () => {
    if (!requireTargets()) return;
    void mutations.applyPrices
      .mutateAsync({
        targetRestaurantIds: selected.map((row) => row.restaurantId),
        matchBy,
      })
      .then((data) => setResult({ kind: 'apply', data }))
      .catch((error) => fail('Could not push prices', error));
  };

  const runAvailability = (isAvailable: boolean) => {
    if (!requireTargets()) return;
    const count = selected.length;
    Alert.alert(
      isAvailable ? 'Put back in stock?' : 'Mark sold out?',
      isAvailable
        ? `Matched dishes at ${count} outlet${count === 1 ? '' : 's'} will be visible to customers again.`
        : `Matched dishes at ${count} outlet${count === 1 ? '' : 's'} will be hidden until you put them back in stock.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isAvailable ? 'In stock' : 'Sold out',
          style: isAvailable ? 'default' : 'destructive',
          onPress: () => {
            void mutations.applyAvailability
              .mutateAsync({
                targetRestaurantIds: selected.map((row) => row.restaurantId),
                matchBy,
                isAvailable,
                reason: isAvailable ? null : 'sold_out',
              })
              .then((data) => setResult({ kind: 'apply', data }))
              .catch((error) => fail('Could not push availability', error));
          },
        },
      ]
    );
  };

  const runSettings = () => {
    if (!requireTargets()) return;
    Alert.alert(
      'Copy operations?',
      'Tax, packing, min order, radius, prep time, auto-accept, COD, UPI and veg flags copy to selected outlets. Commission never copies. Alcohol is re-checked per city.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy settings',
          onPress: () => {
            void mutations.applySettings
              .mutateAsync({
                targetRestaurantIds: selected.map((row) => row.restaurantId),
                copyFromSource: true,
              })
              .then((data) => setResult({ kind: 'settings', data }))
              .catch((error) => fail('Could not sync settings', error));
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Other outlets"
        subtitle={
          source?.name
            ? `Push from ${source.name}`
            : siblingsQuery.restaurantName || 'Chain menu & 86'
        }
        showBack
        hideActions
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={siblingsQuery.isRefetching}
            onRefresh={() => void siblingsQuery.refetch()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
      >
        {siblingsQuery.isError ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>
              {getApiErrorMessage(
                siblingsQuery.error,
                'Could not load other outlets'
              )}
            </Text>
            <Pressable onPress={() => void siblingsQuery.refetch()}>
              <Text style={styles.link}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {siblingsQuery.isLoading && !siblingsQuery.data ? (
          <ActivityIndicator color={authTheme.brand} style={{ marginTop: 32 }} />
        ) : targets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Store color={authTheme.textDim} size={28} />
            <Text style={styles.emptyTitle}>Only this outlet</Text>
            <Text style={styles.emptyText}>
              Add another restaurant under the same owner to copy menus, prices
              and sold-out like Swiggy / Zomato Partner.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.sourceCard}>
              <Building2 color={authTheme.brand} size={18} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceLabel}>Pushing from</Text>
                <Text style={styles.sourceName}>
                  {source?.name ?? siblingsQuery.restaurantName ?? 'This outlet'}
                </Text>
                <Text style={styles.meta}>
                  {source?.city ? `${source.city} · ` : ''}
                  {source?.isOnline ? 'Kitchen online' : 'Kitchen offline'}
                  {source?.status ? ` · listing ${source.status}` : ''}
                </Text>
              </View>
            </View>

            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>
                Select outlets ({selected.length}/{targets.length})
              </Text>
              <Pressable
                onPress={() =>
                  setSelectedIds(
                    selected.length === targets.length
                      ? []
                      : targets.map((row) => row.restaurantId)
                  )
                }
              >
                <Text style={styles.link}>
                  {selected.length === targets.length ? 'Clear' : 'Select all'}
                </Text>
              </Pressable>
            </View>

            {targets.map((outlet) => (
              <OutletRow
                key={outlet.restaurantId}
                outlet={outlet}
                selected={selectedIds.includes(outlet.restaurantId)}
                onToggle={() => toggle(outlet.restaurantId)}
              />
            ))}

            <Text style={styles.sectionTitle}>Match dishes by</Text>
            <View style={styles.chipRow}>
              {(
                [
                  { id: 'name_and_category' as const, label: 'Name + category' },
                  { id: 'name' as const, label: 'Name only' },
                ] as const
              ).map((chip) => (
                <Pressable
                  key={chip.id}
                  style={[styles.chip, matchBy === chip.id && styles.chipOn]}
                  onPress={() => setMatchBy(chip.id)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      matchBy === chip.id && styles.chipTextOn,
                    ]}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.hint}>
              Name + category is safer for chains with the same dish in two
              sections. Commission is never copied.
            </Text>

            <Text style={styles.sectionTitle}>Copy menu</Text>
            <View style={styles.chipRow}>
              {(
                [
                  { id: 'merge' as const, label: 'Add missing (merge)' },
                  { id: 'replace' as const, label: 'Replace catalog' },
                ] as const
              ).map((chip) => (
                <Pressable
                  key={chip.id}
                  style={[styles.chip, cloneMode === chip.id && styles.chipOn]}
                  onPress={() => setCloneMode(chip.id)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      cloneMode === chip.id && styles.chipTextOn,
                    ]}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.actions}>
              <PrimaryButton
                label="Copy menu"
                icon={Copy}
                loading={mutations.cloneMenu.isPending}
                disabled={busy}
                onPress={runClone}
              />
              <Pressable
                style={styles.secondary}
                disabled={busy}
                onPress={runPrices}
              >
                <IndianRupee color={authTheme.brand} size={16} />
                <Text style={styles.secondaryText}>Push prices</Text>
              </Pressable>
              <View style={styles.splitRow}>
                <Pressable
                  style={[styles.secondary, { flex: 1 }]}
                  disabled={busy}
                  onPress={() => runAvailability(false)}
                >
                  <UtensilsCrossed color="#B91C1C" size={16} />
                  <Text style={[styles.secondaryText, { color: '#B91C1C' }]}>
                    Sold out
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.secondary, { flex: 1 }]}
                  disabled={busy}
                  onPress={() => runAvailability(true)}
                >
                  <UtensilsCrossed color="#15803D" size={16} />
                  <Text style={[styles.secondaryText, { color: '#15803D' }]}>
                    In stock
                  </Text>
                </Pressable>
              </View>
              <Pressable
                style={styles.secondary}
                disabled={busy}
                onPress={runSettings}
              >
                <Settings2 color={authTheme.brand} size={16} />
                <Text style={styles.secondaryText}>Copy operations</Text>
              </Pressable>
            </View>

            {result ? <ResultCard result={result} /> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function OutletRow({
  outlet,
  selected,
  onToggle,
}: {
  outlet: ChainSibling;
  selected: boolean;
  onToggle: () => void;
}) {
  const listingLive = outlet.status === 'active';
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.outletRow, selected && styles.outletRowOn]}
    >
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.outletName}>{outlet.name}</Text>
        <Text style={styles.meta}>
          {outlet.city ? `${outlet.city} · ` : ''}
          {outlet.isOnline ? 'Online' : 'Offline'}
          {` · listing ${outlet.status ?? 'pending'}`}
        </Text>
      </View>
      {!listingLive ? (
        <View style={styles.pendingPill}>
          <Text style={styles.pendingPillText}>Pending</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ResultCard({ result }: { result: ResultState }) {
  return (
    <View style={styles.resultCard}>
      <Text style={styles.sectionTitle}>Last sync</Text>
      {result.kind === 'clone'
        ? result.data.targets.map((target) => (
            <Text key={target.restaurantId} style={styles.resultLine}>
              {target.error
                ? `${target.name}: ${target.error}`
                : `${target.name}: ${target.itemsCreated} dishes added${
                    target.itemsSkipped ? `, ${target.itemsSkipped} skipped` : ''
                  }${target.cleared ? ' · catalog replaced' : ''}`}
            </Text>
          ))
        : null}
      {result.kind === 'apply'
        ? result.data.targets.map((target) => (
            <View key={target.restaurantId} style={{ gap: 4 }}>
              <Text style={styles.resultLine}>
                {target.error
                  ? `${target.name}: ${target.error}`
                  : `${target.name}: ${target.updated}/${target.matched} updated`}
              </Text>
              {target.unmatched.slice(0, 6).map((sku) => (
                <Text key={`${target.restaurantId}-${sku.name}`} style={styles.unmatched}>
                  Not at {target.name}: {sku.name}
                  {sku.categoryName ? ` (${sku.categoryName})` : ''}
                </Text>
              ))}
            </View>
          ))
        : null}
      {result.kind === 'settings'
        ? result.data.targets.map((target) => (
            <Text key={target.restaurantId} style={styles.resultLine}>
              {target.applied
                ? `${target.name}: operations copied`
                : `${target.name}: ${target.error || 'not applied'}`}
            </Text>
          ))
        : null}
      {result.kind === 'settings' && result.data.appliedKeys.length ? (
        <Text style={styles.meta}>
          Keys: {result.data.appliedKeys.join(', ')}
        </Text>
      ) : null}
      {result.kind !== 'settings' &&
      result.data.targets.some((row) => 'error' in row && row.error) ? (
        <View style={styles.warnRow}>
          <CircleAlert color="#B45309" size={14} />
          <Text style={styles.meta}>Some outlets did not fully update.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { flex: 1 },
  content: {
    padding: 16,
    paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
    gap: 12,
  },
  sourceCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    alignItems: 'center',
  },
  sourceLabel: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 11,
  },
  sourceName: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  meta: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    color: authTheme.text,
    fontFamily: fonts.extraBold,
    fontSize: 15,
    marginTop: 4,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: { color: authTheme.brand, fontFamily: fonts.bold, fontSize: 13 },
  outletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
  },
  outletRowOn: {
    borderColor: authTheme.brand,
    backgroundColor: authTheme.brandSoft,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.4,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: authTheme.brand, borderColor: authTheme.brand },
  checkMark: { color: '#FFFFFF', fontSize: 12, fontFamily: fonts.bold },
  outletName: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 15 },
  pendingPill: {
    backgroundColor: '#FFF7ED',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pendingPillText: {
    color: '#C2410C',
    fontFamily: fonts.bold,
    fontSize: 10,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  chipOn: { borderColor: authTheme.brand, backgroundColor: authTheme.brandSoft },
  chipText: { color: authTheme.textMuted, fontFamily: fonts.bold, fontSize: 12 },
  chipTextOn: { color: authTheme.brand },
  hint: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  actions: { gap: 10, marginTop: 4 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#FFFFFF',
  },
  secondaryText: { color: authTheme.brand, fontFamily: fonts.bold, fontSize: 14 },
  splitRow: { flexDirection: 'row', gap: 8 },
  resultCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
  },
  resultLine: {
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  unmatched: {
    color: '#B45309',
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
  },
  emptyTitle: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 16 },
  emptyText: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorText: { color: '#B91C1C', fontFamily: fonts.medium, fontSize: 13 },
});
