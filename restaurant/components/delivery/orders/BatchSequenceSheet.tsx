import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { fonts } from '@/constants/typography';
import {
  useDeliveryBatch,
  useDeliveryOrderMutations,
} from '@/lib/delivery-partner/hooks';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';

type Props = {
  visible: boolean;
  batchId: string | null;
  onClose: () => void;
};

export function BatchSequenceSheet({ visible, batchId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const enabled = visible && Boolean(batchId);
  const batchQuery = useDeliveryBatch(batchId ?? undefined, {
    enabled,
    live: true,
  });
  const { confirmSequence } = useDeliveryOrderMutations();
  const batch = batchQuery.data;
  const busy = confirmSequence.isPending;

  const confirm = async () => {
    if (!batchId) return;
    try {
      await confirmSequence.mutateAsync({
        batchId,
        payload: { confirm: true },
      });
      onClose();
    } catch (error) {
      Alert.alert(
        'Could not confirm route',
        formatTripError(error, 'Pickup must come before drop for every order.')
      );
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>Stacked orders</Text>
              <Text style={styles.title}>Confirm pickup–drop route</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <X color="#6B7280" size={20} />
            </Pressable>
          </View>

          {batchQuery.isLoading && !batch ? (
            <View style={styles.center}>
              <ActivityIndicator color="#EA4B14" />
              <Text style={styles.muted}>Loading suggested sequence…</Text>
            </View>
          ) : batchQuery.isError && !batch ? (
            <View style={styles.center}>
              <Text style={styles.errorTitle}>Couldn’t load this stack</Text>
              <Text style={styles.muted}>
                {formatTripError(batchQuery.error, 'Retry to load the route.')}
              </Text>
              <Pressable
                onPress={() => void batchQuery.refetch()}
                style={styles.retryBtn}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={styles.meta}>
                {[
                  batch?.suggested ? 'Suggested nearest route' : 'Your route',
                  batch?.estimatedDistanceKm != null
                    ? `${batch.estimatedDistanceKm.toFixed(1)} km`
                    : null,
                  batch?.estimatedMinutes != null
                    ? `${batch.estimatedMinutes} min`
                    : null,
                  `${batch?.sequence.length ?? 0} stops`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <ScrollView
                style={styles.list}
                showsVerticalScrollIndicator={false}
              >
                {(batch?.sequence ?? []).map((stop) => (
                  <View key={`${stop.seq}-${stop.deliveryId}-${stop.leg}`} style={styles.stop}>
                    <View
                      style={[
                        styles.seq,
                        stop.leg === 'drop' ? styles.seqDrop : styles.seqPickup,
                      ]}
                    >
                      <Text style={styles.seqText}>{stop.seq}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stopLeg}>
                        {stop.label || (stop.leg === 'drop' ? 'Drop' : 'Pickup')}
                      </Text>
                      <Text style={styles.stopAddr} numberOfLines={2}>
                        {stop.address ||
                          (stop.leg === 'drop'
                            ? 'Customer drop'
                            : 'Restaurant pickup')}
                      </Text>
                      {stop.metersFromPrev ? (
                        <Text style={styles.stopDist}>
                          {stop.metersFromPrev >= 1000
                            ? `${(stop.metersFromPrev / 1000).toFixed(1)} km from last stop`
                            : `${stop.metersFromPrev} m from last stop`}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Pressable
                onPress={() => void confirm()}
                disabled={busy || !batch?.canConfirmSequence}
                style={[
                  styles.confirmBtn,
                  (!batch?.canConfirmSequence || busy) && styles.confirmDisabled,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmText}>Confirm route</Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    marginTop: 2,
    fontFamily: fonts.extraBold,
    fontSize: 20,
    color: '#111827',
  },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 14,
  },
  list: {
    maxHeight: 360,
  },
  stop: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  seq: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqPickup: {
    backgroundColor: '#EA4B14',
  },
  seqDrop: {
    backgroundColor: '#2563EB',
  },
  seqText: {
    fontFamily: fonts.extraBold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  stopLeg: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
  },
  stopAddr: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
  },
  stopDist: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  confirmBtn: {
    marginTop: 8,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDisabled: {
    opacity: 0.55,
  },
  confirmText: {
    fontFamily: fonts.extraBold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  center: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 8,
  },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#111827',
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
});
