/**
 * Listing lifecycle (admin-only) vs kitchen duty vs KYC vs bank.
 *
 * Listing live  → restaurant.status === 'active' after ops approve.
 * Kitchen open  → listing live AND isOnline AND not paused.
 * KYC           → draft | submitted | under_review | rejected (owner submit).
 * Bank          → unverified until ops/penny-drop. Saving an account is not live.
 *
 * Never treat KYC submitted, bank saved, duty online, or "verified" docs as listing live.
 */

export const LISTING_STATUSES = [
  'pending',
  'active',
  'suspended',
  'closed',
  'rejected',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export type ListingBadge = {
  key: ListingStatus | 'unknown';
  label: string;
  color: string;
  soft: string;
};

function normalize(raw?: string | null) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function parseListingStatus(raw?: string | null): ListingStatus {
  const s = normalize(raw);
  if (s === 'pending' || s === 'active' || s === 'suspended' || s === 'closed' || s === 'rejected') {
    return s;
  }
  // Duty `online`/`offline`, doc `uploaded`, bank `verified`, envelope `ok` → not live.
  return 'pending';
}

export function isListingLive(raw?: string | null): boolean {
  return parseListingStatus(raw) === 'active';
}

export function getListingBadge(raw?: string | null): ListingBadge {
  const status = parseListingStatus(raw);
  if (status === 'active') {
    return {
      key: 'active',
      label: 'Listing live',
      color: '#15803D',
      soft: '#DCFCE7',
    };
  }
  if (status === 'suspended') {
    return {
      key: 'suspended',
      label: 'Suspended',
      color: '#B91C1C',
      soft: '#FEE2E2',
    };
  }
  if (status === 'closed') {
    return {
      key: 'closed',
      label: 'Closed',
      color: '#64748B',
      soft: '#F1F5F9',
    };
  }
  if (status === 'rejected') {
    return {
      key: 'rejected',
      label: 'Rejected',
      color: '#B91C1C',
      soft: '#FEE2E2',
    };
  }
  return {
    key: 'pending',
    label: 'Not live',
    color: '#B45309',
    soft: '#FEF3C7',
  };
}
