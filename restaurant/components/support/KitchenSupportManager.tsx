import { Headphones, Plus } from 'lucide-react-native';
import { useState } from 'react';
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

import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { KitchenTicketCard } from '@/components/support/KitchenTicketCard';
import { KitchenTicketComposer } from '@/components/support/KitchenTicketComposer';
import { KitchenTicketDetailSheet } from '@/components/support/KitchenTicketDetailSheet';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  useCreateKitchenTicket,
  useKitchenTickets,
} from '@/lib/restaurant/support-hooks';
import type { KitchenTicketStage } from '@/lib/restaurant/support-types';

const STAGE_FILTERS: { key: KitchenTicketStage | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'initiated', label: 'Initiated' },
  { key: 'working', label: 'Working on it' },
  { key: 'closed', label: 'Closed' },
];

export function KitchenSupportManager() {
  const [page, setPage] = useState(1);
  const [stage, setStage] = useState<KitchenTicketStage | 'all'>('all');
  const [composer, setComposer] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  const list = useKitchenTickets(page, stage === 'all' ? undefined : stage);
  const create = useCreateKitchenTicket(list.restaurantId);
  const tickets = list.data?.tickets ?? [];
  const loading = list.isLoading && !list.data;
  const hasNext = list.data?.hasNext ?? false;

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Help"
        subtitle={
          list.restaurantName
            ? `${list.restaurantName} · support tickets`
            : 'Raise a ticket with TOKAJO'
        }
        showBack
        hideProfile
        headerRight={
          <Pressable
            style={styles.headerBtn}
            onPress={() => setComposer(true)}
            disabled={!list.restaurantId}
          >
            <Plus color={authTheme.text} size={18} strokeWidth={2.4} />
          </Pressable>
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching}
            onRefresh={() => void list.refetch()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {STAGE_FILTERS.map((item) => {
            const on = item.key === stage;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setStage(item.key);
                  setPage(1);
                }}
                style={[styles.filterChip, on && styles.filterChipOn]}
              >
                <Text style={[styles.filterText, on && styles.filterTextOn]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : null}

        {!loading && list.isError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn’t load tickets</Text>
            <Text style={styles.muted}>
              {list.error instanceof Error ? list.error.message : 'Please try again'}
            </Text>
            <Pressable style={styles.retry} onPress={() => void list.refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !list.isError && tickets.length === 0 ? (
          <View style={styles.empty}>
            <Headphones color={authTheme.textDim} size={36} />
            <Text style={styles.emptyTitle}>No tickets yet</Text>
            <Text style={styles.muted}>
              Raise a ticket for orders, payouts, menu, KYC, or the app.
            </Text>
            <Pressable style={styles.retry} onPress={() => setComposer(true)}>
              <Text style={styles.retryText}>New ticket</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !list.isError ? (
          <View style={styles.list}>
            {tickets.map((ticket) => (
              <KitchenTicketCard
                key={ticket.ticketId}
                ticket={ticket}
                onPress={() => setSelectedTicketId(ticket.ticketId)}
              />
            ))}
          </View>
        ) : null}

        {!loading && !list.isError && (page > 1 || hasNext) ? (
          <View style={styles.pager}>
            <Pressable
              disabled={page <= 1 || list.isFetching}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              style={[styles.pageBtn, page <= 1 && styles.disabled]}
            >
              <Text style={styles.pageBtnText}>Previous</Text>
            </Pressable>
            <Pressable
              disabled={!hasNext || list.isFetching}
              onPress={() => setPage((p) => p + 1)}
              style={[styles.pageBtn, !hasNext && styles.disabled]}
            >
              <Text style={styles.pageBtnText}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <KitchenTicketComposer
        visible={composer}
        pending={create.isPending}
        onClose={() => setComposer(false)}
        onSubmit={async (input) => {
          try {
            const ticket = await create.mutateAsync(input);
            setComposer(false);
            Alert.alert('Ticket raised', `${ticket.ticketNo} is with support.`);
          } catch (error) {
            Alert.alert(
              'Could not raise ticket',
              error instanceof Error ? error.message : 'Please try again',
            );
          }
        }}
      />

      <KitchenTicketDetailSheet
        restaurantId={list.restaurantId}
        ticketId={selectedTicketId}
        onClose={() => setSelectedTicketId(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14, paddingTop: 12 },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 8, paddingRight: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: authTheme.surface,
  },
  filterChipOn: { backgroundColor: authTheme.brand },
  filterText: { color: authTheme.textMuted, fontSize: 13, fontFamily: fonts.semiBold },
  filterTextOn: { color: '#FFFFFF' },
  list: { gap: 10 },
  center: { paddingVertical: 48, alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { color: authTheme.text, fontSize: 16, fontFamily: fonts.bold },
  muted: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
    lineHeight: 18,
  },
  retry: {
    marginTop: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: fonts.bold },
  pager: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  pageBtn: {
    backgroundColor: authTheme.surface,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pageBtnText: { color: authTheme.text, fontFamily: fonts.semiBold, fontSize: 13 },
  disabled: { opacity: 0.45 },
});
