import {
  getListingBadge,
  isListingLive,
  type ListingBadge,
} from '@/lib/restaurant/listing-status';

export type RestaurantVerificationBadge = {
  key: 'verified' | 'pending' | 'unverified' | 'rejected';
  label: string;
  color: string;
  soft: string;
};

/**
 * Listing lifecycle only. KYC submitted / bank saved / "verified" docs
 * must never show as listing live — ops approve is the only `active` path.
 */
export function getRestaurantVerificationBadge(
  status?: string | null
): RestaurantVerificationBadge {
  const badge: ListingBadge = getListingBadge(status);
  if (badge.key === 'active') {
    return {
      key: 'verified',
      label: badge.label,
      color: badge.color,
      soft: badge.soft,
    };
  }
  if (badge.key === 'rejected' || badge.key === 'suspended') {
    return {
      key: 'rejected',
      label: badge.label,
      color: badge.color,
      soft: badge.soft,
    };
  }
  if (badge.key === 'closed') {
    return {
      key: 'unverified',
      label: badge.label,
      color: badge.color,
      soft: badge.soft,
    };
  }
  return {
    key: 'pending',
    label: badge.label,
    color: badge.color,
    soft: badge.soft,
  };
}

export { isListingLive };
