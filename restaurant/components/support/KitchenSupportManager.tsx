import {
  Headphones,
  Plus,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  useCreateKitchenTicket,
  useKitchenTickets,
} from '@/lib/restaurant/support-hooks';
import type {
  KitchenTicketCategory,
  KitchenTicketPriority,
  KitchenTicketStatus,
  KitchenSupportTicket,
} from '@/lib/restaurant/support-types';

const STATUS_FILTERS: { key: KitchenTicketStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'waiting_on_restaurant', label: 'Need you' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

const CATEGORIES: { key: KitchenTicketCategory; label: string }[] = [
  { key: 'orders', label: 'Orders' },
  { key: 'payout', label: 'Payouts' },
  { key: 'menu', label: 'Menu' },
  { key: 'kyc', label: 'KYC' },
  { key: 'app', label: 'App' },
  { key: 'other', label: 'Other' },
];

const PRIORITIES: { key: KitchenTicketPriority; label: string }[] = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'urgent', label: 'Urgent' },
];

const STATUS_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: '#EFF6FF', fg: '#1D4ED8', label: 'Open' },
  in_progress: { bg: '#FFFBEB', fg: '#B45309', label: 'In progress' },
  waiting_on_restaurant: { bg: '#FEF3C7', fg: '#92400E', label: 'Need you' },
  resolved: { bg: '#ECFDF5', fg: '#047857', label: 'Resolved' },
  closed: { bg: '#F8FAFC', fg: '#475569', label: 'Closed' },
};

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function TicketCard({ ticket }: { ticket: KitchenSupportTicket }) {
  const tone = STATUS_TONE[ticket.status] ?? {
    bg: authTheme.surface,
    fg: authTheme.textMuted,
    label: String(ticket.status).replace(/_/g, ' '),
  };
  const category =
    CATEGORIES.find((row) => row.key === ticket.category)?.label ?? ticket.category;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.ticketNo}>{ticket.ticketNo || ticket.ticketId}</Text>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.fg }]}>{tone.label}</Text>
        </View>
      </View>
      <Text style={styles.subject}>{ticket.subject}</Text>
      <Text style={styles.body} numberOfLines={3}>
        {ticket.description}
      </Text>
      <Text style={styles.meta}>
        {category} · {ticket.priority} · {formatDate(ticket.createdAt)}
      </Text>
    </View>
  );
}

export function KitchenSupportManager() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<KitchenTicketStatus | 'all'>('all');
  const [composer, setComposer] = useState(false);
  const [category, setCategory] = useState<KitchenTicketCategory>('orders');
  const [priority, setPriority] = useState<KitchenTicketPriority>('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const list = useKitchenTickets(
    page,
    status === 'all' ? undefined : status
  );
  const create = useCreateKitchenTicket(list.restaurantId);
  const tickets = list.data?.tickets ?? [];
  const loading = list.isLoading && !list.data;
  const hasNext = list.data?.hasNext ?? false;

  const resetComposer = () => {
    setSubject('');
    setDescription('');
    setCategory('orders');
    setPriority('medium');
    setComposer(false);
  };

  const submit = async () => {
    try {
      const ticket = await create.mutateAsync({
        category,
        priority,
        subject,
        description,
      });
      resetComposer();
      Alert.alert('Ticket raised', `${ticket.ticketNo} is with support.`);
    } catch (error) {
      Alert.alert(
        'Could not raise ticket',
        error instanceof Error ? error.message : 'Please try again'
      );
    }
  };

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
          {STATUS_FILTERS.map((item) => {
            const on = item.key === status;
            return (
              <Pressable
                key={item.key}
                onPress={() => {
                  setStatus(item.key);
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
              {list.error instanceof Error
                ? list.error.message
                : 'Please try again'}
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
              <TicketCard key={ticket.ticketId} ticket={ticket} />
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

      <Modal
        visible={composer}
        transparent
        animationType="fade"
        onRequestClose={resetComposer}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New ticket</Text>
              <Pressable onPress={resetComposer}>
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Topic</Text>
              <View style={styles.wrapChips}>
                {CATEGORIES.map((item) => {
                  const on = item.key === category;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setCategory(item.key)}
                      style={[styles.choice, on && styles.choiceOn]}
                    >
                      <Text style={[styles.choiceText, on && styles.choiceTextOn]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.label}>Priority</Text>
              <View style={styles.wrapChips}>
                {PRIORITIES.map((item) => {
                  const on = item.key === priority;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setPriority(item.key)}
                      style={[styles.choice, on && styles.choiceOn]}
                    >
                      <Text style={[styles.choiceText, on && styles.choiceTextOn]}>
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.label}>Subject</Text>
              <TextInput
                value={subject}
                onChangeText={setSubject}
                placeholder="Short summary (min 5 characters)"
                placeholderTextColor={authTheme.textDim}
                maxLength={200}
                style={styles.input}
              />
              <Text style={styles.label}>Details</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What happened? Include order or payout ids if you have them."
                placeholderTextColor={authTheme.textDim}
                multiline
                maxLength={2000}
                style={[styles.input, styles.area]}
              />
            </ScrollView>
            <Pressable
              style={[styles.sendBtn, create.isPending && styles.disabled]}
              onPress={() => void submit()}
              disabled={create.isPending}
            >
              {create.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.sendText}>Submit ticket</Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14, paddingTop: 12 },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filters: { gap: 8, paddingRight: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: authTheme.surface,
  },
  filterChipOn: { backgroundColor: authTheme.brand },
  filterText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  filterTextOn: { color: '#FFFFFF' },
  list: { gap: 10 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 14,
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  ticketNo: { color: authTheme.brand, fontSize: 12, fontFamily: fonts.bold },
  subject: { color: authTheme.text, fontSize: 15, fontFamily: fonts.bold },
  body: { color: authTheme.textMuted, fontSize: 13, fontFamily: fonts.medium, lineHeight: 18 },
  meta: { color: authTheme.textDim, fontSize: 12, fontFamily: fonts.medium },
  chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 11, fontFamily: fonts.bold },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 12,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { color: authTheme.text, fontSize: 18, fontFamily: fonts.bold },
  label: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
    marginBottom: 6,
    marginTop: 10,
  },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: authTheme.surface,
  },
  choiceOn: { backgroundColor: authTheme.brand },
  choiceText: { color: authTheme.textMuted, fontSize: 13, fontFamily: fonts.semiBold },
  choiceTextOn: { color: '#FFFFFF' },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  area: { minHeight: 110, textAlignVertical: 'top' },
  sendBtn: {
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendText: { color: '#FFFFFF', fontSize: 15, fontFamily: fonts.bold },
});
