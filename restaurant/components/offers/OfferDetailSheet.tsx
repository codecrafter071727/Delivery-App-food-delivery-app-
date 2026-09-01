import { Copy, Pencil, Trash2, X } from 'lucide-react-native';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { discountLabel, offerEffectSummary } from '@/lib/restaurant/offer-copy';
import {
  useOfferDetail,
  useOfferMutations,
} from '@/lib/restaurant/offers-hooks';
import type { RestaurantOffer } from '@/lib/restaurant/types';

function formatDateInput(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return value;
    return value.slice(0, 10);
  }
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${date.getFullYear()}`;
}

function formatDisplayDate(value?: string) {
  return formatDateInput(value) || '—';
}

function lifecycleLabel(offer: RestaurantOffer) {
  if (offer.isActive === false) return 'Paused';
  if (offer.status === 'scheduled') return 'Upcoming';
  if (offer.status === 'inactive') return 'Ended';
  return 'Live';
}

function offerErrorTitle(error: unknown) {
  const message = getApiErrorMessage(error);
  if (message.toLowerCase().includes('already exists') || message.includes('409')) {
    return 'Code already used';
  }
  if (message.includes('VALIDATION_ERROR') || message.includes('422')) {
    return 'Check the form';
  }
  if (message.includes('OFFER_NOT_FOUND') || message.includes('404')) {
    return 'Offer not found';
  }
  if (message.includes('FORBIDDEN') || message.includes('403')) {
    return 'Not allowed';
  }
  return 'Could not save offer';
}

async function copyCode(code: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      const clipboard = (
        navigator as Navigator & {
          clipboard?: { writeText?: (value: string) => Promise<void> };
        }
      ).clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(code);
        Alert.alert('Copied', `${code} copied.`);
        return;
      }
    }
    await Share.share({ message: code, title: 'Promo code' });
  } catch {
    Alert.alert('Could not copy', code);
  }
}

export function OfferDetailSheet({
  restaurantId,
  offer,
  onClose,
  onEdit,
  onDeleted,
}: {
  restaurantId: string;
  offer: RestaurantOffer | null;
  onClose: () => void;
  onEdit: (offer: RestaurantOffer) => void;
  onDeleted: () => void;
}) {
  const detail = useOfferDetail(
    restaurantId,
    offer?.id,
    Boolean(offer?.id)
  );
  const mutations = useOfferMutations(restaurantId);
  const row = detail.data ?? offer;
  const busy =
    mutations.updateOffer.isPending || mutations.deleteOffer.isPending;

  const pause = () => {
    if (!row) return;
    const next = row.isActive === false;
    void mutations.updateOffer
      .mutateAsync({ offerId: row.id, payload: { isActive: next } })
      .then(onClose)
      .catch((error) => {
        Alert.alert(offerErrorTitle(error), getApiErrorMessage(error));
      });
  };

  const remove = () => {
    if (!row) return;
    Alert.alert(
      'Delete this offer?',
      'Customers will no longer see this promo. This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void mutations.deleteOffer
              .mutateAsync(row.id)
              .then(() => {
                onDeleted();
                onClose();
              })
              .catch((error) => {
                Alert.alert(offerErrorTitle(error), getApiErrorMessage(error));
              });
          },
        },
      ]
    );
  };

  return (
    <Modal
      visible={Boolean(offer)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.detailBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.detailSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Offer details</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>

          {detail.isLoading && !row ? (
            <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 24 }} />
          ) : detail.isError && !row ? (
            <Text style={styles.errorText}>{getApiErrorMessage(detail.error)}</Text>
          ) : row ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.detailHero}>
                <Text style={styles.detailDiscount}>{discountLabel(row)}</Text>
                <Text style={styles.detailTitle}>{row.title}</Text>
                <Text style={styles.offerMeta}>{lifecycleLabel(row)}</Text>
              </View>

              {row.code ? (
                <Pressable
                  onPress={() => void copyCode(row.code!)}
                  style={styles.codeBox}
                >
                  <Text style={styles.codeBoxText}>{row.code}</Text>
                  <Copy color={authTheme.brand} size={16} />
                </Pressable>
              ) : null}

              {row.description ? (
                <Text style={styles.offerDesc}>{row.description}</Text>
              ) : (
                <Text style={styles.offerDesc}>{offerEffectSummary(row)}</Text>
              )}

              <Text style={styles.kv}>Effect: {offerEffectSummary(row)}</Text>
              <Text style={styles.kv}>
                Valid {formatDisplayDate(row.validFrom)} →{' '}
                {formatDisplayDate(row.validUntil)}
              </Text>
              {row.minOrderAmount != null ? (
                <Text style={styles.kv}>
                  Min item total Rs {Math.round(row.minOrderAmount)}
                </Text>
              ) : null}
              {row.maxDiscountAmount != null ? (
                <Text style={styles.kv}>
                  Max discount Rs {Math.round(row.maxDiscountAmount)}
                </Text>
              ) : null}
              <Text style={styles.kv}>
                Used {row.usageCount ?? 0}
                {row.usageLimit ? ` / ${row.usageLimit}` : ' (no cap)'}
                {row.perUserLimit != null
                  ? ` · ${row.perUserLimit} per customer`
                  : ''}
              </Text>

              <View style={styles.detailActions}>
                <Pressable
                  disabled={busy}
                  onPress={pause}
                  style={styles.secondaryBtn}
                >
                  <Text style={styles.secondaryBtnText}>
                    {row.isActive === false ? 'Go live' : 'Pause'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={() => onEdit(row)}
                  style={styles.secondaryBtn}
                >
                  <Pencil color={authTheme.text} size={14} />
                  <Text style={styles.secondaryBtnText}>Edit</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  onPress={remove}
                  style={styles.dangerBtn}
                >
                  <Trash2 color="#FFFFFF" size={14} />
                </Pressable>
              </View>
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  detailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  detailSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: authTheme.text,
  },
  detailHero: { gap: 4, marginBottom: 12 },
  detailDiscount: {
    fontFamily: fonts.extraBold,
    fontSize: 22,
    color: authTheme.brand,
  },
  detailTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  offerMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  offerDesc: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    marginBottom: 8,
    lineHeight: 18,
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderStyle: 'dashed',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  codeBoxText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.brand,
    letterSpacing: 1,
  },
  kv: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.text,
    marginBottom: 6,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontFamily: fonts.medium,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  secondaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
  dangerBtn: {
    width: 48,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
