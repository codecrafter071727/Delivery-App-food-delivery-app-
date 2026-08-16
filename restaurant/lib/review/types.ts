/** Owner review inbox via restaurant-service (proxies review-service). */

export type PaginationMeta = {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasNext?: boolean;
};

export type ReviewStarBucket = {
  stars: number;
  count: number;
  percentage: number;
};

export type ReviewInboxStats = {
  avgRating: number;
  totalReviews: number;
  distribution: ReviewStarBucket[];
};

export type ReviewOwnerReply = {
  message: string;
  repliedAt?: string;
};

export type RestaurantReview = {
  id: string;
  restaurantId?: string;
  orderId?: string | null;
  userName?: string;
  rating: number;
  comment?: string;
  images: string[];
  createdAt?: string;
  reply?: ReviewOwnerReply | null;
  hasReply: boolean;
};

export type ReviewListResult = {
  reviews: RestaurantReview[];
  meta?: PaginationMeta & { stats?: ReviewInboxStats };
};

export type ReviewListQuery = {
  page?: number;
  limit?: number;
  rating?: 1 | 2 | 3 | 4 | 5;
  unanswered?: boolean;
};

export type ReplyReviewPayload = {
  message: string;
};

/** @deprecated Owner app does not submit customer reviews. */
export type SubmitReviewPayload = {
  rating: number;
  comment?: string;
  title?: string;
  orderId?: string;
};

export type RatingDistribution = {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
};

export type ReviewStats = {
  average: number;
  total: number;
  distribution: RatingDistribution;
};
