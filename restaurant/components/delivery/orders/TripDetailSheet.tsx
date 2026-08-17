import {
  ActivityIndicator,
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
import { deliveryStatusLabel, isUnpaidTripStatus, tripCreditsEarnings } from '@/lib/delivery-partner/api';
import {
  useDeliveryDetail,
  useDeliveryEvents,
  useDeliveryTimeline,
} from '@/lib/delivery-partner/hooks';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import { useTripEarnings } from '@/lib/delivery-partner/finance-hooks';
import type { PartnerDelivery } from '@/lib/delivery-partner/types';

type Props = {
  visible: boolean;
  deliveryId: string | null;
  fallback?: PartnerDelivery | null;
  live?: boolean;
  onClose: () => void;
};

function money(amount?: number, currency = 'INR') {
  if (amount == null || !Number.isFinite(amount)) return null;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${Math.round(amount)}`;
}

function formatWhen(iso?: string | null) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const KIND_LABEL: Record<string, string> = {
  timeline: 'Trip',
  issue: 'Issue',
  contact: 'Call',
  dispatch: 'Dispatch',
};

export function TripDetailSheet({
  visible,
  deliveryId,
  fallback,
  live = false,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const enabled = visible && Boolean(deliveryId);
  const detail = useDeliveryDetail(deliveryId ?? undefined, enabled);
  const timeline = useDeliveryTimeline(deliveryId ?? undefined, {
    enabled,
    live,
  });
  const events = useDeliveryEvents(deliveryId ?? undefined, {
    enabled,
    live,
  });
  const tripEarn = useTripEarnings(
    deliveryId ?? undefined,
    enabled &&
      Boolean(deliveryId) &&
      tripCreditsEarnings((detail.data ?? fallback)?.status)
  );

  const delivery = detail.data ?? fallback ?? null;
  const loading = detail.isLoading && !delivery;
  const error = !delivery && detail.isError ? detail.error : null;

  const onRetry = () => {
    void detail.refetch();
    void timeline.refetch();
    void events.refetch();
    void tripEarn.refetch();
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
              <Text style={styles.kicker}>Trip details</Text>
              <Text style={styles.title} numberOfLines={1}>
                {delivery?.restaurantName || 'Delivery'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <X color="#6B7280" size={20} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#EA4B14" />
              <Text style={styles.muted}>Loading trip…</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Text style={styles.errorTitle}>Couldn’t load this trip</Text>
              <Text style={styles.muted}>
                {formatTripError(error, 'Pull to retry.')}
              </Text>
              <Pressable onPress={onRetry} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.body}
            >
              {delivery ? (
                <View style={styles.summary}>
                  <Text style={styles.status}>
                    {deliveryStatusLabel(delivery.status)}
                  </Text>
                  <Text style={styles.orderNo}>
                    #{delivery.orderNumber || delivery.orderId || delivery.id.slice(-6)}
                  </Text>
                  {isUnpaidTripStatus(delivery.status) ? (
                    <Text style={styles.muted}>
                      No payout — customer did not receive this order
                    </Text>
                  ) : money(delivery.earning, delivery.currency) ? (
                    <Text style={styles.earn}>
                      {tripCreditsEarnings(delivery.status) ? 'Earned' : 'Est.'}{' '}
                      {money(delivery.earning, delivery.currency)}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {tripEarn.isLoading && !tripEarn.data ? (
                <ActivityIndicator color="#EA4B14" style={{ marginVertical: 8 }} />
              ) : tripEarn.data ? (
                <View style={styles.summary}>
                  <Text style={styles.sectionTitle}>Trip earnings</Text>
                  <Text style={styles.earn}>
                    Net {money(tripEarn.data.net, tripEarn.data.currency)}
                  </Text>
                  <Text style={styles.muted}>
                    Gross {money(tripEarn.data.gross, tripEarn.data.currency)}
                    {tripEarn.data.actualDistanceKm != null
                      ? ` · ${tripEarn.data.actualDistanceKm} km`
                      : ''}
                    {tripEarn.data.waitMinutes
                      ? ` · wait ${tripEarn.data.waitMinutes} min`
                      : ''}
                  </Text>
                  {(
                    [
                      ['Base', tripEarn.data.breakdown.baseFare],
                      ['Distance', tripEarn.data.breakdown.distanceFare],
                      ['Surge', tripEarn.data.breakdown.surge],
                      ['Wait', tripEarn.data.breakdown.waitTime],
                      ['Tip', tripEarn.data.breakdown.tip],
                      ['Incentive', tripEarn.data.breakdown.incentive],
                      ['Platform fee', tripEarn.data.breakdown.platformFee],
                      ['TDS', tripEarn.data.breakdown.tds],
                    ] as const
                  ).map(([label, value]) =>
                    value ? (
                      <Text key={label} style={styles.muted}>
                        {label} {money(value, tripEarn.data.currency)}
                      </Text>
                    ) : null
                  )}
                </View>
              ) : tripEarn.isError ? (
                <Pressable onPress={() => void tripEarn.refetch()} style={styles.inlineError}>
                  <Text style={styles.inlineErrorText}>
                    {formatTripError(tripEarn.error, 'Could not load trip earnings. Retry')}
                  </Text>
                </Pressable>
              ) : null}

              <Text style={styles.sectionTitle}>Timeline</Text>
              {timeline.isLoading && !timeline.data ? (
                <ActivityIndicator color="#EA4B14" style={{ marginVertical: 12 }} />
              ) : timeline.isError ? (
                <Pressable onPress={() => void timeline.refetch()} style={styles.inlineError}>
                  <Text style={styles.inlineErrorText}>
                    {formatTripError(timeline.error, 'Could not load timeline. Retry')}
                  </Text>
                </Pressable>
              ) : !timeline.data?.steps.length ? (
                <Text style={styles.muted}>No timeline steps yet.</Text>
              ) : (
                <View style={styles.steps}>
                  {timeline.data.steps.map((step) => (
                    <View key={`${step.key}-${step.label}`} style={styles.stepRow}>
                      <View
                        style={[
                          styles.stepDot,
                          step.completed && styles.stepDotDone,
                        ]}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.stepLabel,
                            !step.completed && styles.stepLabelPending,
                          ]}
                        >
                          {step.label}
                        </Text>
                        <Text style={styles.stepWhen}>
                          {formatWhen(step.at) || (step.completed ? 'Done' : 'Pending')}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>
                Events
              </Text>
              {events.isLoading && !events.data ? (
                <ActivityIndicator color="#EA4B14" style={{ marginVertical: 12 }} />
              ) : events.isError ? (
                <Pressable onPress={() => void events.refetch()} style={styles.inlineError}>
                  <Text style={styles.inlineErrorText}>
                    {formatTripError(events.error, 'Could not load events. Retry')}
                  </Text>
                </Pressable>
              ) : !events.data?.events.length ? (
                <Text style={styles.muted}>No dispatch or issue events yet.</Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {events.data.events.map((event, index) => (
                    <View
                      key={`${event.kind}-${event.key}-${event.at ?? index}`}
                      style={styles.eventCard}
                    >
                      <Text style={styles.eventKind}>
                        {KIND_LABEL[event.kind] ?? event.kind}
                      </Text>
                      <Text style={styles.eventLabel}>{event.label}</Text>
                      <Text style={styles.eventMeta}>
                        {[formatWhen(event.at), event.actor, event.detail]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
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
    marginBottom: 12,
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
  body: {
    paddingBottom: 24,
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
  summary: {
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
    gap: 2,
  },
  status: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#EA4B14',
  },
  orderNo: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#4B5563',
  },
  earn: {
    fontFamily: fonts.extraBold,
    fontSize: 16,
    color: '#111827',
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: fonts.extraBold,
    fontSize: 15,
    color: '#111827',
    marginBottom: 10,
  },
  steps: {
    gap: 12,
  },
  stepRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D1D5DB',
    marginTop: 5,
  },
  stepDotDone: {
    backgroundColor: '#16A34A',
  },
  stepLabel: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#111827',
  },
  stepLabelPending: {
    color: '#9CA3AF',
  },
  stepWhen: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  inlineError: {
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
  },
  inlineErrorText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#B91C1C',
  },
  eventCard: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
  },
  eventKind: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  eventLabel: {
    marginTop: 2,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#111827',
  },
  eventMeta: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
});
