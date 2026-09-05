import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { canSubmitCatalogVerification } from '@/components/menu/CatalogStatusBadge';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type {
  CatalogPendingRevision,
  CatalogStatus,
} from '@/lib/restaurant/types';

export function SubmitVerificationButton({
  catalogStatus,
  pendingRevision,
  rejectionReason,
  busy,
  onPress,
  label,
}: {
  catalogStatus?: CatalogStatus;
  pendingRevision?: CatalogPendingRevision | null;
  rejectionReason?: string | null;
  busy?: boolean;
  onPress: () => void;
  label?: string;
}) {
  if (
    !canSubmitCatalogVerification({
      catalogStatus,
      pendingRevision,
      rejectionReason,
    })
  ) {
    return null;
  }

  return (
    <Pressable
      style={[styles.btn, busy && styles.btnBusy]}
      disabled={busy}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator color={authTheme.brand} size="small" />
      ) : (
        <Text style={styles.btnText}>
          {label ?? 'Submit for verification'}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: authTheme.brand,
    backgroundColor: '#FFF8F9',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  btnBusy: { opacity: 0.7 },
  btnText: {
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
});
