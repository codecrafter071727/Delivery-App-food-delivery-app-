import { StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type {
  CatalogPendingRevision,
  CatalogStatus,
} from '@/lib/restaurant/types';

type CatalogFields = {
  catalogStatus?: CatalogStatus;
  pendingRevision?: CatalogPendingRevision | null;
  rejectionReason?: string | null;
};

function hasRevisionContent(revision?: CatalogPendingRevision | null) {
  if (!revision || typeof revision !== 'object') return false;
  return Object.keys(revision).some(
    (key) =>
      key !== 'submittedAt' &&
      key !== 'submittedBy' &&
      revision[key] !== undefined
  );
}

export function catalogStatusLabel(status?: CatalogStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending review';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'draft':
    default:
      return 'Draft';
  }
}

export function hasPendingCatalogUpdate(fields: CatalogFields) {
  return hasRevisionContent(fields.pendingRevision);
}

export function canSubmitCatalogVerification(fields: CatalogFields) {
  const status = fields.catalogStatus ?? 'draft';
  if (status === 'pending') return false;
  if (status === 'draft' || status === 'rejected') return true;
  if (status === 'approved') {
    return (
      hasRevisionContent(fields.pendingRevision) &&
      !fields.pendingRevision?.submittedAt
    );
  }
  return false;
}

function toneForStatus(status?: CatalogStatus) {
  switch (status) {
    case 'approved':
      return { bg: '#ECFDF5', text: '#15803D' };
    case 'pending':
      return { bg: '#FFF7ED', text: '#C2410C' };
    case 'rejected':
      return { bg: '#FEF2F2', text: '#B91C1C' };
    case 'draft':
    default:
      return { bg: '#F1F5F9', text: authTheme.textMuted };
  }
}

export function CatalogStatusBadge({
  catalogStatus,
  pendingRevision,
  rejectionReason,
  compact,
}: CatalogFields & { compact?: boolean }) {
  const status = catalogStatus ?? 'draft';
  const tone = toneForStatus(status);
  const updatePending = hasPendingCatalogUpdate({ pendingRevision });
  const reason =
    status === 'rejected' && rejectionReason?.trim()
      ? rejectionReason.trim()
      : null;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.chipRow}>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.text }]}>
            {catalogStatusLabel(status)}
          </Text>
        </View>
        {updatePending ? (
          <View style={[styles.chip, styles.updateChip]}>
            <Text style={styles.updateChipText}>
              {pendingRevision?.submittedAt
                ? 'Update in review'
                : 'Update pending'}
            </Text>
          </View>
        ) : null}
      </View>
      {reason ? (
        <Text style={styles.reason} numberOfLines={compact ? 2 : 4}>
          Reason: {reason}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4, marginTop: 6 },
  wrapCompact: { marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipText: {
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  updateChip: { backgroundColor: '#FEF3C7' },
  updateChipText: {
    color: '#B45309',
    fontSize: 11,
    fontFamily: fonts.bold,
  },
  reason: {
    color: '#B91C1C',
    fontSize: 11,
    fontFamily: fonts.medium,
    lineHeight: 15,
  },
});
