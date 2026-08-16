import { formatDutyError } from '@/lib/delivery-partner/availability-api';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import {
  PARTNER_DOC_TYPES,
  displayDocumentStatus,
} from '@/lib/delivery-partner/documents-types';
import type { DeliveryPartnerProfile } from '@/lib/delivery-partner/types';

export type GoOnlineBlocker = {
  reason: 'documents' | 'pending_review' | 'inactive';
  title: string;
  message: string;
  actionLabel: string;
  actionHref: string;
};

function normalizePartnerAccountStatus(status?: string) {
  return (status ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** Partner account is approved to accept deliveries. */
export function isPartnerAccountActive(
  profile?: DeliveryPartnerProfile | null
): boolean {
  const status = normalizePartnerAccountStatus(profile?.status);
  return (
    status === 'active' ||
    status === 'approved' ||
    status === 'verified' ||
    status === 'enabled'
  );
}

export function getDocumentProgress(profile?: DeliveryPartnerProfile | null) {
  const docs = profile?.documents;
  const total = PARTNER_DOC_TYPES.length;
  let submitted = 0;
  let verified = 0;
  let rejected = 0;
  let pending = 0;

  for (const item of PARTNER_DOC_TYPES) {
    const status = displayDocumentStatus(docs?.[item.type]);
    if (status === 'verified') {
      submitted += 1;
      verified += 1;
    } else if (status === 'pending') {
      submitted += 1;
      pending += 1;
    } else if (status === 'rejected') {
      rejected += 1;
    }
  }

  return { submitted, verified, rejected, pending, total };
}

export type PartnerVerificationBadge = {
  key: 'verified' | 'pending' | 'unverified' | 'rejected' | 'incomplete';
  label: string;
  color: string;
  soft: string;
};

/**
 * Profile badge for account + KYC verification state.
 */
export function getPartnerVerificationBadge(
  profile?: DeliveryPartnerProfile | null
): PartnerVerificationBadge {
  const status = normalizePartnerAccountStatus(profile?.status);
  const { submitted, verified, rejected, pending, total } =
    getDocumentProgress(profile);

  if (
    status === 'rejected' ||
    status === 'suspended' ||
    status === 'blocked' ||
    status === 'disabled'
  ) {
    return {
      key: 'rejected',
      label:
        status === 'suspended'
          ? 'Suspended'
          : status === 'blocked' || status === 'disabled'
            ? 'Blocked'
            : 'Rejected',
      color: '#B91C1C',
      soft: '#FEE2E2',
    };
  }

  if (rejected > 0) {
    return {
      key: 'rejected',
      label: 'Docs rejected',
      color: '#B91C1C',
      soft: '#FEE2E2',
    };
  }

  if (isPartnerAccountActive(profile) && verified >= total) {
    return {
      key: 'verified',
      label: 'Verified',
      color: '#15803D',
      soft: '#DCFCE7',
    };
  }

  if (isPartnerAccountActive(profile)) {
    return {
      key: 'verified',
      label: 'Account active',
      color: '#15803D',
      soft: '#DCFCE7',
    };
  }

  if (submitted >= total && (pending > 0 || verified < total)) {
    return {
      key: 'pending',
      label: 'Pending review',
      color: '#B45309',
      soft: '#FEF3C7',
    };
  }

  if (
    status === 'pending' ||
    status === 'under_review' ||
    status === 'in_review' ||
    status === 'submitted'
  ) {
    return {
      key: 'pending',
      label: 'Pending review',
      color: '#B45309',
      soft: '#FEF3C7',
    };
  }

  if (submitted === 0) {
    return {
      key: 'unverified',
      label: 'Unverified',
      color: '#64748B',
      soft: '#F1F5F9',
    };
  }

  return {
    key: 'incomplete',
    label: `KYC ${verified}/${total}`,
    color: '#C2410C',
    soft: '#FFEDD5',
  };
}

/**
 * Client-side gate before calling go-online.
 * Returns null when the request is allowed to proceed.
 */
export function getGoOnlineBlocker(
  profile?: DeliveryPartnerProfile | null
): GoOnlineBlocker | null {
  if (!profile) return null;

  const { submitted, verified, total } = getDocumentProgress(profile);

  if (submitted < total) {
    return {
      reason: 'documents',
      title: 'Documents required',
      message: `Upload all required documents first (${submitted}/${total} submitted). Then wait for verification before going online.`,
      actionLabel: 'Open Documents',
      actionHref: DELIVERY_ROUTES.documents,
    };
  }

  if (isPartnerAccountActive(profile)) {
    return null;
  }

  if (verified < total) {
    return {
      reason: 'pending_review',
      title: 'Verification pending',
      message: `Documents are under review (${verified}/${total} verified). Only active partners can go online after approval.`,
      actionLabel: 'View Documents',
      actionHref: DELIVERY_ROUTES.documents,
    };
  }

  return {
    reason: 'inactive',
    title: 'Account not active yet',
    message:
      'Only active partners can go online. Your documents look complete — wait for admin activation, or contact support.',
    actionLabel: 'View Documents',
    actionHref: DELIVERY_ROUTES.documents,
  };
}

/** Friendlier copy for go-online API failures. */
export function formatGoOnlineError(error: unknown, fallback: string): string {
  return formatDutyError(error, fallback);
}
