import { Image } from 'expo-image';
import {
  MessageSquare,
  MessageSquareQuote,
  Star,
  Trash2,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  useOwnerRestaurantReviews,
  useReviewMutations,
} from '@/lib/review/hooks';
import type { RestaurantReview, ReviewListQuery } from '@/lib/review/types';

type FilterKey = 'all' | 'unanswered' | 1 | 2 | 3 | 4 | 5;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unanswered', label: 'Unreplied' },
  { key: 5, label: '5★' },
  { key: 4, label: '4★' },
  { key: 3, label: '3★' },
  { key: 2, label: '2★' },
  { key: 1, label: '1★' },
];

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={styles.starsRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={size}
          color={star <= Math.round(value) ? '#F59E0B' : '#E2E8F0'}
          fill={star <= Math.round(value) ? '#F59E0B' : 'transparent'}
        />
      ))}
    </View>
  );
}

function ReviewCard({
  review,
  busy,
  onReply,
  onDelete,
}: {
  review: RestaurantReview;
  busy: boolean;
  onReply: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(review.userName ?? 'C').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName} numberOfLines={1}>
              {review.userName?.trim() || 'Customer'}
            </Text>
            <Text style={styles.date}>{formatDate(review.createdAt)}</Text>
          </View>
          <View style={styles.ratingChip}>
            <Star color="#FFFFFF" fill="#FFFFFF" size={11} />
            <Text style={styles.ratingChipText}>
              {review.rating > 0 ? review.rating.toFixed(1) : '—'}
            </Text>
          </View>
        </View>

        {review.comment ? (
          <Text style={styles.comment}>{review.comment}</Text>
        ) : null}

        {review.images.length ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoRow}
          >
            {review.images.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={styles.photo}
                contentFit="cover"
              />
            ))}
          </ScrollView>
        ) : null}

        {review.reply?.message ? (
          <View style={styles.replyBox}>
            <Text style={styles.replyLabel}>Your reply</Text>
            <Text style={styles.replyText}>{review.reply.message}</Text>
            {review.reply.repliedAt ? (
              <Text style={styles.replyDate}>
                {formatDate(review.reply.repliedAt)}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.needsReply}>Needs a public reply</Text>
        )}
      </View>

      <View style={styles.cardActions}>
        <Pressable
          onPress={onReply}
          disabled={busy}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.replyBtn,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          <MessageSquare color={authTheme.text} size={16} />
          <Text style={styles.replyBtnText}>
            {review.hasReply ? 'Edit reply' : 'Reply'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          disabled={busy}
          style={({ pressed }) => [
            styles.actionBtn,
            styles.deleteBtn,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          <Trash2 color={authTheme.text} size={16} />
          <Text style={styles.deleteBtnText}>Remove</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ReviewsManager() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [replyTarget, setReplyTarget] = useState<RestaurantReview | null>(null);
  const [replyText, setReplyText] = useState('');

  const query: ReviewListQuery = {
    page,
    limit: 20,
    unanswered: filter === 'unanswered' || undefined,
    rating: typeof filter === 'number' ? filter : undefined,
  };

  const reviews = useOwnerRestaurantReviews(query);
  const mutations = useReviewMutations(reviews.restaurantId);

  const list = reviews.data?.reviews ?? [];
  const stats = reviews.data?.meta?.stats;
  const avg = stats?.avgRating ?? 0;
  const total = stats?.totalReviews ?? 0;
  const distribution = stats?.distribution ?? [];
  const maxDist = useMemo(
    () => Math.max(1, ...distribution.map((row) => row.count), 1),
    [distribution]
  );

  const meta = reviews.data?.meta;
  const hasNext =
    meta?.hasNext ??
    (meta?.totalPages != null ? page < meta.totalPages : list.length >= 20);

  const refreshing = reviews.isRefetching;
  const loading = reviews.isLoading && !reviews.data;
  const busy = mutations.reply.isPending || mutations.remove.isPending;
  const downstreamDown =
    (reviews.error as Error & { code?: string } | null)?.code ===
    'DOWNSTREAM_UNAVAILABLE';

  const setFilterAndReset = (next: FilterKey) => {
    setFilter(next);
    setPage(1);
  };

  const openReply = (review: RestaurantReview) => {
    setReplyTarget(review);
    setReplyText(review.reply?.message ?? '');
  };

  const submitReply = async () => {
    if (!replyTarget) return;
    const message = replyText.trim();
    if (!message) {
      Alert.alert('Reply required', 'Write a short public reply before sending.');
      return;
    }
    try {
      await mutations.reply.mutateAsync({
        reviewId: replyTarget.id,
        payload: { message },
      });
      setReplyTarget(null);
      setReplyText('');
    } catch (error) {
      Alert.alert(
        'Reply failed',
        error instanceof Error ? error.message : 'Could not send reply'
      );
    }
  };

  const confirmDelete = (review: RestaurantReview) => {
    Alert.alert(
      'Remove this review?',
      'This hides the review from your outlet. The customer’s rating still counts until support restores it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await mutations.remove.mutateAsync(review.id);
            } catch (error) {
              Alert.alert(
                'Remove failed',
                error instanceof Error ? error.message : 'Could not remove review'
              );
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Reviews"
        subtitle={
          reviews.restaurantName
            ? `${reviews.restaurantName} · customer ratings`
            : 'Ratings & customer feedback'
        }
        showBack
        hideProfile
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void reviews.refetch()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : null}

        {!loading && reviews.isError ? (
          <View style={styles.emptyCard}>
            <Text style={styles.errorTitle}>Couldn’t load reviews</Text>
            <Text style={styles.muted}>
              {reviews.error instanceof Error
                ? reviews.error.message
                : 'Please try again'}
            </Text>
            <Pressable
              style={styles.retry}
              onPress={() => void reviews.refetch()}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!loading && !reviews.isError ? (
          <View style={styles.statsCard}>
            <View style={styles.avgBlock}>
              <Text style={styles.avgValue}>
                {avg > 0 ? avg.toFixed(1) : '—'}
              </Text>
              <Stars value={avg} size={15} />
              <Text style={styles.avgCount}>
                {total > 0
                  ? `${total} review${total === 1 ? '' : 's'}`
                  : 'No reviews yet'}
              </Text>
            </View>
            <View style={styles.bars}>
              {([5, 4, 3, 2, 1] as const).map((star) => {
                const bucket = distribution.find((row) => row.stars === star);
                const count = bucket?.count ?? 0;
                const ratio = Math.max(0, Math.min(1, count / maxDist));
                return (
                  <View key={star} style={styles.barRow}>
                    <Text style={styles.barLabel}>{star}</Text>
                    <View style={styles.barTrack}>
                      <View
                        style={[styles.barFill, { flex: ratio || 0.0001 }]}
                      />
                      <View style={{ flex: Math.max(0.0001, 1 - ratio) }} />
                    </View>
                    <Text style={styles.barCount}>{count}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {!loading && !reviews.isError ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((item) => {
              const active = item.key === filter;
              return (
                <Pressable
                  key={String(item.key)}
                  onPress={() => setFilterAndReset(item.key)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      active && styles.filterTextActive,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {!loading && !reviews.isError && list.length === 0 ? (
          <View style={styles.empty}>
            <MessageSquareQuote color={authTheme.textDim} size={36} />
            <Text style={styles.emptyTitle}>
              {filter === 'unanswered'
                ? 'You’re all caught up'
                : filter === 'all'
                  ? 'No reviews yet'
                  : `No ${filter}★ reviews`}
            </Text>
            <Text style={styles.muted}>
              {downstreamDown
                ? 'Reviews will appear once the service is back.'
                : 'New customer ratings show up here after delivered orders.'}
            </Text>
          </View>
        ) : null}

        {!loading && !reviews.isError && list.length > 0 ? (
          <View style={styles.list}>
            {list.map((review) => (
              <ReviewCard
                key={review.id}
                review={review}
                busy={busy}
                onReply={() => openReply(review)}
                onDelete={() => confirmDelete(review)}
              />
            ))}
          </View>
        ) : null}

        {!loading && !reviews.isError && (page > 1 || hasNext) ? (
          <View style={styles.pager}>
            <Pressable
              disabled={page <= 1 || reviews.isFetching}
              onPress={() => setPage((p) => Math.max(1, p - 1))}
              style={[styles.pageBtn, page <= 1 && styles.disabled]}
            >
              <Text style={styles.pageBtnText}>Previous</Text>
            </Pressable>
            <Pressable
              disabled={!hasNext || reviews.isFetching}
              onPress={() => setPage((p) => p + 1)}
              style={[styles.pageBtn, !hasNext && styles.disabled]}
            >
              <Text style={styles.pageBtnText}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={Boolean(replyTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setReplyTarget(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Public reply</Text>
              <Pressable onPress={() => setReplyTarget(null)}>
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>
            {replyTarget ? (
              <Text style={styles.modalHint} numberOfLines={3}>
                {replyTarget.userName || 'Customer'} · {replyTarget.rating.toFixed(1)}★
                {replyTarget.comment ? ` — ${replyTarget.comment}` : ''}
              </Text>
            ) : null}
            <TextInput
              value={replyText}
              onChangeText={setReplyText}
              placeholder="Thank the guest or explain what you’ll fix…"
              placeholderTextColor={authTheme.textDim}
              multiline
              maxLength={2000}
              style={styles.modalInput}
              autoFocus
            />
            <Pressable
              onPress={() => void submitReply()}
              disabled={mutations.reply.isPending}
              style={[
                styles.sendBtn,
                mutations.reply.isPending && styles.disabled,
              ]}
            >
              {mutations.reply.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.sendBtnText}>Post reply</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14, paddingTop: 12 },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  muted: {
    color: authTheme.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: fonts.medium,
  },
  errorTitle: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  retry: {
    marginTop: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: fonts.bold },
  statsCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    padding: 16,
    gap: 16,
  },
  avgBlock: { width: 110, alignItems: 'center', gap: 6, justifyContent: 'center' },
  avgValue: {
    color: authTheme.text,
    fontSize: 36,
    fontFamily: fonts.extraBold,
  },
  avgCount: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  bars: { flex: 1, gap: 6, justifyContent: 'center' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: {
    width: 12,
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  barTrack: { flex: 1, flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: '#F1F5F9' },
  barFill: { backgroundColor: '#F59E0B', borderRadius: 3 },
  barCount: {
    width: 28,
    textAlign: 'right',
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.medium,
  },
  starsRow: { flexDirection: 'row', gap: 2 },
  filterRow: { gap: 8, paddingRight: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: authTheme.surface,
  },
  filterChipActive: { backgroundColor: authTheme.brand },
  filterText: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  filterTextActive: { color: '#FFFFFF' },
  list: { gap: 12 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.07)',
    overflow: 'hidden',
  },
  cardBody: { padding: 14, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: authTheme.brand, fontFamily: fonts.bold, fontSize: 14 },
  userName: { color: authTheme.text, fontSize: 14, fontFamily: fonts.bold },
  date: { color: authTheme.textMuted, fontSize: 12, fontFamily: fonts.medium },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#16A34A',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  ratingChipText: { color: '#FFFFFF', fontSize: 12, fontFamily: fonts.bold },
  comment: {
    color: authTheme.text,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fonts.medium,
  },
  photoRow: { gap: 8 },
  photo: { width: 72, height: 72, borderRadius: 10, backgroundColor: authTheme.surface },
  replyBox: {
    backgroundColor: authTheme.surface,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  replyLabel: {
    color: authTheme.brand,
    fontSize: 11,
    fontFamily: fonts.bold,
    textTransform: 'uppercase',
  },
  replyText: { color: authTheme.text, fontSize: 13, fontFamily: fonts.medium },
  replyDate: { color: authTheme.textDim, fontSize: 11, fontFamily: fonts.medium },
  needsReply: {
    color: '#B45309',
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  cardActions: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(122, 14, 34, 0.1)',
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  replyBtn: {},
  deleteBtn: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(122, 14, 34, 0.1)',
  },
  replyBtnText: { color: authTheme.text, fontSize: 13, fontFamily: fonts.semiBold },
  deleteBtnText: { color: authTheme.textMuted, fontSize: 13, fontFamily: fonts.semiBold },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  empty: { alignItems: 'center', paddingVertical: 36, gap: 8 },
  emptyTitle: { color: authTheme.text, fontSize: 16, fontFamily: fonts.bold },
  pager: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  pageBtn: {
    backgroundColor: authTheme.surface,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pageBtnText: { color: authTheme.text, fontFamily: fonts.semiBold, fontSize: 13 },
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
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { color: authTheme.text, fontSize: 18, fontFamily: fonts.bold },
  modalHint: { color: authTheme.textMuted, fontSize: 13, fontFamily: fonts.medium },
  modalInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.12)',
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendBtnText: { color: '#FFFFFF', fontSize: 15, fontFamily: fonts.bold },
});
