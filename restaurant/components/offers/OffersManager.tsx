import {
  Calendar,
  Gift,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { OfferDetailSheet } from '@/components/offers/OfferDetailSheet';
import {
  OfferFormModal,
  type OfferModalState,
} from '@/components/offers/OfferFormModal';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { discountLabel, offerEffectSummary } from '@/lib/restaurant/offer-copy';
import {
  useOfferMutations,
  useRestaurantOffers,
} from '@/lib/restaurant/offers-hooks';
import type {
  OfferLifecycleStatus,
  RestaurantOffer,
} from '@/lib/restaurant/types';

type TabKey = OfferLifecycleStatus;

const TABS: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Live' },
  { key: 'scheduled', label: 'Upcoming' },
  { key: 'inactive', label: 'Paused' },
];

function formatDateInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return value;
    return value.slice(0, 10);
  }
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getFullYear()}`;
}

function formatDisplayDate(value?: string) {
  const formatted = formatDateInput(value);
  return formatted || '-';
}

function lifecycleLabel(offer: RestaurantOffer) {
  if (offer.isActive === false) return 'Paused';
  if (offer.status === 'scheduled') return 'Upcoming';
  if (offer.status === 'inactive') return 'Ended';
  return 'Live';
}

function offerErrorTitle(error: unknown) {
  const message = getApiErrorMessage(error);
  if (message.toLowerCase().includes('already exists') || message.includes('409')) {
    return 'Code already used';
  }
  if (message.includes('VALIDATION_ERROR') || message.includes('422')) {
    return 'Check the form';
  }
  if (message.includes('OFFER_NOT_FOUND') || message.includes('404')) {
    return 'Offer not found';
  }
  if (message.includes('FORBIDDEN') || message.includes('403')) {
    return 'Not allowed';
  }
  return 'Could not save offer';
}

function OfferCard({
  offer,
  onPress,
}: {
  offer: RestaurantOffer;
  onPress: () => void;
}) {
  const live = lifecycleLabel(offer) === 'Live';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.offerCard, pressed && styles.pressed]}
    >
      <View style={[styles.badge, live ? styles.badgeLive : styles.badgeMuted]}>
        <Text style={styles.badgeText}>{discountLabel(offer)}</Text>
      </View>
      <View style={styles.offerBody}>
        <View style={styles.offerTop}>
          <Text style={styles.offerTitle} numberOfLines={1}>
            {offer.title}
          </Text>
          <View
            style={[
              styles.statusPill,
              offer.status === 'scheduled' && styles.statusPillScheduled,
              offer.status === 'inactive' && styles.statusPillInactive,
            ]}
          >
            <Text
              style={[
                styles.statusPillText,
                offer.status === 'inactive' && styles.statusPillTextInactive,
              ]}
            >
              {lifecycleLabel(offer)}
            </Text>
          </View>
        </View>
        {offer.code ? (
          <Text style={styles.offerCode}>{offer.code}</Text>
        ) : null}
        <Text style={styles.offerMeta} numberOfLines={2}>
          {offerEffectSummary(offer)}
        </Text>
        <Text style={styles.offerMeta} numberOfLines={1}>
          {[
            `${formatDisplayDate(offer.validFrom)} -> ${formatDisplayDate(offer.validUntil)}`,
            offer.usageCount != null ? `${offer.usageCount} used` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

export function OffersManager() {
  const insets = useSafeAreaInsets();
  const {
    data: offers = [],
    isLoading,
    isRefetching,
    refetch,
    restaurantId,
    restaurantName,
    error,
    isError,
  } = useRestaurantOffers();
  const mutations = useOfferMutations(restaurantId);

  const [tab, setTab] = useState<TabKey>('active');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<OfferModalState>(null);
  const [selected, setSelected] = useState<RestaurantOffer | null>(null);

  const tabCounts = useMemo(() => {
    const counts = { active: 0, scheduled: 0, inactive: 0 };
    for (const offer of offers) {
      const key = (offer.status ?? 'active') as TabKey;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [offers]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return offers.filter((offer) => {
      if ((offer.status ?? 'active') !== tab) return false;
      if (!q) return true;
      const hay = [offer.title, offer.code, offer.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [offers, query, tab]);

  const liveCount = tabCounts.active;
  const used = offers.reduce((sum, offer) => sum + (offer.usageCount ?? 0), 0);

  return (
    <View style={styles.root}>
      <RestaurantPageHeader
        title="Offers"
        subtitle={
          restaurantName
            ? `${restaurantName}  ·  ${liveCount} live`
            : 'Promos customers see on your menu'
        }
        showBack
        hideActions
        headerRight={
          <Pressable
            style={styles.headerPrimaryBtn}
            onPress={() => setModal({ mode: 'create' })}
          >
            <Plus color={authTheme.brand} size={16} />
            <Text style={styles.headerPrimaryBtnText}>Create</Text>
          </Pressable>
        }
      />

      <View style={styles.tabs}>
        {TABS.map((item) => {
          const on = tab === item.key;
          const count = tabCounts[item.key];
          return (
            <Pressable
              key={item.key}
              style={[styles.tab, on && styles.tabOn]}
              onPress={() => setTab(item.key)}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>
                {item.label}
                {count > 0 ? ` ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + PARTNER_BOTTOM_NAV_INSET },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
      >
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Gift color={authTheme.brand} size={18} />
            <Text style={styles.statValue}>{liveCount}</Text>
            <Text style={styles.statLabel}>Live now</Text>
          </View>
          <View style={styles.statCard}>
            <Calendar color={authTheme.brand} size={18} />
            <Text style={styles.statValue}>{tabCounts.scheduled}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{used}</Text>
            <Text style={styles.statLabel}>Times used</Text>
          </View>
        </View>

        {offers.length > 0 ? (
          <View style={styles.searchRow}>
            <Search color={authTheme.textMuted} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search title or code"
              placeholderTextColor={authTheme.textDim}
              style={styles.searchInput}
            />
          </View>
        ) : null}

        {isError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn't load offers</Text>
            <Text style={styles.emptyText}>{getApiErrorMessage(error)}</Text>
            <Pressable style={styles.primaryBtn} onPress={() => void refetch()}>
              <RefreshCw color="#FFFFFF" size={14} />
              <Text style={styles.primaryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : isLoading && !offers.length ? (
          <ActivityIndicator color={authTheme.brand} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.emptyCard}>
            <Gift color={authTheme.textDim} size={42} />
            <Text style={styles.emptyTitle}>
              {offers.length
                ? 'Nothing in this tab'
                : 'No offers yet'}
            </Text>
            <Text style={styles.emptyText}>
              {offers.length
                ? 'Live, upcoming, and paused promos sit in separate tabs.'
                : 'Create a % off, flat discount, free delivery, or BOGO. Customers see live codes on your restaurant.'}
            </Text>
            <Pressable
              style={[styles.primaryBtn, { marginTop: 14 }]}
              onPress={() => setModal({ mode: 'create' })}
            >
              <Plus color="#FFFFFF" size={16} />
              <Text style={styles.primaryBtnText}>Create offer</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                onPress={() => setSelected(offer)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <OfferDetailSheet
        restaurantId={restaurantId}
        offer={selected}
        onClose={() => setSelected(null)}
        onEdit={(offer) => {
          setSelected(null);
          setModal({ mode: 'edit', offer });
        }}
        onDeleted={() => setSelected(null)}
      />

      <OfferFormModal
        state={modal}
        saving={mutations.createOffer.isPending || mutations.updateOffer.isPending}
        onClose={() => setModal(null)}
        onSubmit={async (payload) => {
          if (!modal) return;
          try {
            if (modal.mode === 'create') {
              const created = await mutations.createOffer.mutateAsync(payload);
              const nextTab = (created.status ?? 'active') as TabKey;
              setTab(nextTab);
              Alert.alert(
                'Offer saved',
                created.code
                  ? `${created.code}: ${offerEffectSummary(created)}. Customers see it in cart while it is live.`
                  : 'Offer saved. Customers see it in cart while it is live.'
              );
            } else {
              await mutations.updateOffer.mutateAsync({
                offerId: modal.offer.id,
                payload,
              });
              Alert.alert('Updated', 'Offer changes are saved.');
            }
            setModal(null);
          } catch (err) {
            Alert.alert(offerErrorTitle(err), getApiErrorMessage(err));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  headerPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: authTheme.brandSoft,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerPrimaryBtnText: {
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  primaryBtn: {
    marginTop: 8,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  tabs: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabOn: { backgroundColor: authTheme.brand },
  tabText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  tabTextOn: { color: '#FFFFFF' },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    gap: 12,
  },
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 12,
    gap: 6,
  },
  statValue: {
    color: authTheme.text,
    fontSize: 18,
    fontFamily: fonts.extraBold,
  },
  statLabel: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.medium,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
    paddingVertical: 10,
  },
  emptyCard: {
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: authTheme.text,
    fontSize: 17,
    fontFamily: fonts.bold,
  },
  emptyText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontFamily: fonts.medium,
  },
  list: { gap: 10 },
  offerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    overflow: 'hidden',
    flexDirection: 'row',
    minHeight: 88,
  },
  pressed: { opacity: 0.88 },
  badge: {
    width: 88,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  badgeLive: { backgroundColor: '#7A0E22' },
  badgeMuted: { backgroundColor: '#94A3B8' },
  badgeText: {
    color: '#FFFFFF',
    fontFamily: fonts.extraBold,
    fontSize: 13,
    textAlign: 'center',
  },
  offerBody: { flex: 1, padding: 14, gap: 4 },
  offerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  offerTitle: {
    flex: 1,
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  offerCode: {
    color: authTheme.brand,
    fontSize: 12,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.4,
  },
  statusPill: {
    backgroundColor: '#ECFDF5',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillScheduled: { backgroundColor: '#FFF7ED' },
  statusPillInactive: { backgroundColor: '#F1F5F9' },
  statusPillText: {
    color: '#15803D',
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  statusPillTextInactive: { color: authTheme.textMuted },
  offerMeta: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  offerDesc: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    lineHeight: 18,
    marginTop: 8,
  },
  detailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  detailSheet: {
    maxHeight: '82%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 10,
  },
  detailHero: { gap: 4, marginBottom: 8 },
  detailDiscount: {
    color: authTheme.brand,
    fontFamily: fonts.extraBold,
    fontSize: 22,
  },
  detailTitle: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 18,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: authTheme.brand,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: authTheme.brandSoft,
  },
  codeBoxText: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 16,
    letterSpacing: 1,
  },
  kv: {
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 13,
    marginTop: 6,
  },
  detailActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  secondaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  secondaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  dangerBtn: {
    width: 44,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalDismiss: { flex: 1 },
  modalScroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingTop: 48,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    color: authTheme.text,
    fontSize: 18,
    fontFamily: fonts.extraBold,
  },
  field: { marginBottom: 12 },
  fieldLabel: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.semiBold,
    marginBottom: 6,
  },
  hintText: {
    marginBottom: 12,
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
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
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  row2: { flexDirection: 'row' },
  typeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  typeChip: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  typeChipOn: {
    borderColor: authTheme.brand,
    backgroundColor: authTheme.brandSoft,
  },
  typeChipText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
    textAlign: 'center',
  },
  typeChipTextOn: { color: authTheme.brand },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalCancel: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
  },
  modalCancelText: {
    color: authTheme.textMuted,
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  modalPrimary: {
    flex: 1.3,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    flexDirection: 'row',
    gap: 8,
  },
  modalPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: fonts.bold,
  },
});
