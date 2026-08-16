import axios from 'axios';

import { api } from '@/lib/api';
import type {
  ReplyReviewPayload,
  RestaurantReview,
  ReviewInboxStats,
  ReviewListQuery,
  ReviewListResult,
  ReviewStats,
} from '@/lib/review/types';

const RESTAURANT_BASE = '/api/v1/restaurant-service/restaurants';

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
  meta?: ReviewListResult['meta'];
  code?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function throwOutletError(error: unknown, fallback: string): never {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      throw new Error(
        'Network request failed. Check your internet connection and try again.'
      );
    }
    const data = error.response.data as
      | { message?: string; error?: string; code?: string }
      | undefined;
    const code = data?.code;
    if (code === 'DOWNSTREAM_UNAVAILABLE' || error.response.status === 503) {
      const err = new Error(
        'Reviews are temporarily unavailable. Try again in a moment. (DOWNSTREAM_UNAVAILABLE)'
      ) as Error & { status?: number; code?: string };
      err.status = error.response.status;
      err.code = 'DOWNSTREAM_UNAVAILABLE';
      throw err;
    }
    const message =
      data?.message || data?.error || `Request failed (${error.response.status})`;
    if (message.toLowerCase().includes('csrf')) {
      throw new Error(
        'Security token expired. Close and reopen the app, then try again.'
      );
    }
    const suffix = code ? ` (${code})` : ` (${error.response.status})`;
    const err = new Error(`${message}${suffix}`) as Error & {
      status?: number;
      code?: string;
    };
    err.status = error.response.status;
    err.code = code;
    throw err;
  }
  if (error instanceof Error) throw error;
  throw new Error(fallback);
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function mapReview(raw: Record<string, unknown>): RestaurantReview {
  const replyText =
    typeof raw.reply === 'string' && raw.reply.trim() ? raw.reply.trim() : '';
  const imagesRaw = raw.images;
  const images = Array.isArray(imagesRaw)
    ? imagesRaw.filter((url): url is string => typeof url === 'string' && url.length > 0)
    : [];
  const repliedAt =
    typeof raw.repliedAt === 'string' && raw.repliedAt ? raw.repliedAt : undefined;

  return {
    id: String(raw.reviewId ?? raw._id ?? raw.id ?? ''),
    orderId: raw.orderId ? String(raw.orderId) : null,
    userName: String(raw.customerName ?? raw.userName ?? 'Customer').trim() || 'Customer',
    rating: pickNumber(raw, ['rating']),
    comment: typeof raw.comment === 'string' ? raw.comment : undefined,
    images,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    hasReply: Boolean(raw.hasReply) || Boolean(replyText),
    reply: replyText ? { message: replyText, repliedAt } : null,
  };
}

function mapStats(raw: unknown): ReviewInboxStats | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const distRaw = Array.isArray(record.distribution) ? record.distribution : [];
  return {
    avgRating: pickNumber(record, ['avgRating', 'average']),
    totalReviews: pickNumber(record, ['totalReviews', 'total']),
    distribution: distRaw
      .map((row) => {
        const item = asRecord(row);
        if (!item) return null;
        const stars = pickNumber(item, ['stars']);
        if (stars < 1 || stars > 5) return null;
        return {
          stars,
          count: pickNumber(item, ['count']),
          percentage: pickNumber(item, ['percentage']),
        };
      })
      .filter(Boolean) as ReviewInboxStats['distribution'],
  };
}

function toLegacyStats(stats?: ReviewInboxStats): ReviewStats {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const bucket of stats?.distribution ?? []) {
    const star = bucket.stars as 1 | 2 | 3 | 4 | 5;
    if (star >= 1 && star <= 5) distribution[star] = bucket.count;
  }
  return {
    average: stats?.avgRating ?? 0,
    total: stats?.totalReviews ?? 0,
    distribution,
  };
}

export const reviewApi = {
  getRestaurantReviews: async (
    restaurantId: string,
    params?: ReviewListQuery
  ): Promise<ReviewListResult> => {
    try {
      const res = await api.get<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/reviews`,
        {
          params: {
            page: params?.page ?? 1,
            limit: params?.limit ?? 20,
            ...(params?.rating ? { rating: params.rating } : {}),
            ...(params?.unanswered ? { unanswered: '1' } : {}),
          },
        }
      );
      const rows = Array.isArray(res.data?.data) ? res.data.data : [];
      const reviews = rows
        .map((row) => mapReview(asRecord(row) ?? {}))
        .filter((row) => row.id);
      return {
        reviews,
        meta: {
          ...res.data?.meta,
          stats: mapStats(res.data?.meta?.stats),
        },
      };
    } catch (error) {
      throwOutletError(error, 'Failed to load reviews');
    }
  },

  /** Histogram from the owner inbox meta — never calls review-service directly. */
  getRestaurantReviewStats: async (
    restaurantId: string
  ): Promise<ReviewStats> => {
    const inbox = await reviewApi.getRestaurantReviews(restaurantId, {
      page: 1,
      limit: 1,
    });
    return toLegacyStats(inbox.meta?.stats);
  },

  replyToReview: async (
    restaurantId: string,
    reviewId: string,
    payload: ReplyReviewPayload
  ): Promise<RestaurantReview> => {
    const reply = payload.message.trim();
    if (!reply) throw new Error('Reply cannot be empty.');
    try {
      const res = await api.post<Envelope<unknown>>(
        `${RESTAURANT_BASE}/${restaurantId}/reviews/${reviewId}/reply`,
        { reply }
      );
      const mapped = mapReview(asRecord(res.data?.data) ?? {});
      if (!mapped.id) {
        return {
          id: reviewId,
          rating: 0,
          images: [],
          hasReply: true,
          reply: { message: reply },
        };
      }
      if (!mapped.reply) {
        mapped.reply = { message: reply };
        mapped.hasReply = true;
      }
      return mapped;
    } catch (error) {
      throwOutletError(error, 'Failed to send reply');
    }
  },

  deleteReview: async (
    restaurantId: string,
    reviewId: string
  ): Promise<void> => {
    try {
      await api.delete(
        `${RESTAURANT_BASE}/${restaurantId}/reviews/${reviewId}`
      );
    } catch (error) {
      throwOutletError(error, 'Failed to delete review');
    }
  },
};
