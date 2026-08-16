import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {
  LIVE_INTERVALS,
  liveRefetchInterval,
  useAppIsActive,
} from '@/lib/live-query';
import { useMyRestaurantId } from '@/lib/order/hooks';
import { reviewApi } from '@/lib/review/api';
import type {
  ReplyReviewPayload,
  RestaurantReview,
  ReviewListQuery,
} from '@/lib/review/types';

export const reviewKeys = {
  all: ['review'] as const,
  restaurant: (restaurantId: string) =>
    [...reviewKeys.all, 'restaurant', restaurantId] as const,
  restaurantReviews: (restaurantId: string, params?: ReviewListQuery) =>
    [...reviewKeys.restaurant(restaurantId), 'list', params ?? {}] as const,
  restaurantStats: (restaurantId: string) =>
    [...reviewKeys.restaurant(restaurantId), 'stats'] as const,
};

async function invalidateRestaurantReviews(
  queryClient: ReturnType<typeof useQueryClient>,
  restaurantId: string
) {
  await queryClient.invalidateQueries({
    queryKey: reviewKeys.restaurant(restaurantId),
  });
}

export function useOwnerRestaurantReviews(params?: ReviewListQuery) {
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id ?? '';
  const isActive = useAppIsActive();
  const queryParams: ReviewListQuery = {
    page: params?.page ?? 1,
    limit: params?.limit ?? 20,
    rating: params?.rating,
    unanswered: params?.unanswered,
  };

  const query = useQuery({
    queryKey: reviewKeys.restaurantReviews(restaurantId, queryParams),
    queryFn: () => reviewApi.getRestaurantReviews(restaurantId, queryParams),
    enabled: Boolean(restaurantId),
    staleTime: 30_000,
    refetchInterval: liveRefetchInterval(LIVE_INTERVALS.reviews, isActive),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
    retry: (count, error) => {
      const code = (error as Error & { code?: string }).code;
      if (code === 'DOWNSTREAM_UNAVAILABLE') return count < 1;
      return count < 2;
    },
  });

  return {
    ...query,
    restaurantId,
    restaurantName: restaurantQuery.data?.name,
  };
}

export function useReviewMutations(restaurantId: string) {
  const queryClient = useQueryClient();

  const reply = useMutation({
    mutationFn: ({
      reviewId,
      payload,
    }: {
      reviewId: string;
      payload: ReplyReviewPayload;
    }) => reviewApi.replyToReview(restaurantId, reviewId, payload),
    onSuccess: async (updated) => {
      queryClient.setQueriesData<{ reviews: RestaurantReview[] }>(
        { queryKey: [...reviewKeys.restaurant(restaurantId), 'list'] },
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            reviews: prev.reviews.map((row) =>
              row.id === updated.id
                ? { ...row, ...updated, reply: updated.reply ?? row.reply }
                : row
            ),
          };
        }
      );
      await invalidateRestaurantReviews(queryClient, restaurantId);
    },
  });

  const remove = useMutation({
    mutationFn: (reviewId: string) =>
      reviewApi.deleteReview(restaurantId, reviewId),
    onSuccess: async (_void, reviewId) => {
      queryClient.setQueriesData<{ reviews: RestaurantReview[] }>(
        { queryKey: [...reviewKeys.restaurant(restaurantId), 'list'] },
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            reviews: prev.reviews.filter((row) => row.id !== reviewId),
          };
        }
      );
      await invalidateRestaurantReviews(queryClient, restaurantId);
    },
  });

  return { reply, remove };
}
