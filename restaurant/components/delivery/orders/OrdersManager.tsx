import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  CheckCircle2,
  MapPin,
  Navigation,
  Package,
  Phone,
  Power,
  Store,
  MessageCircle,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useDeliveryHeaderScrollProps } from '@/components/delivery/shared/header-scroll';
import { TripChatSheet } from '@/components/delivery/orders/TripChatSheet';
import { DeliveryTripMap } from '@/components/delivery/orders/DeliveryTripMap';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { usePartnerDutyStatus } from '@/lib/delivery-partner/availability-hooks';
import { isDutySwitchOn } from '@/lib/delivery-partner/availability-types';
import {
  formatGoOnlineError,
  getDocumentProgress,
  getGoOnlineBlocker,
} from '@/lib/delivery-partner/go-online-guard';
import {
  deliveryStatusLabel,
  formatDeliveryAddress,
  isAssignableStatus,
  nextDeliveryAction,
  normalizeDeliveryStatus,
} from '@/lib/delivery-partner/api';
import {
  useActiveDelivery,
  useDeliveryHistory,
  useDeliveryOrderMutations,
  useDeliveryPartnerMe,
} from '@/lib/delivery-partner/hooks';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import {
  useLocationHistory,
  useOrderTracking,
  useTrackingRoute,
} from '@/lib/delivery-partner/tracking-hooks';
import type { OrderTracking } from '@/lib/delivery-partner/tracking-types';
import type { PartnerDelivery } from '@/lib/delivery-partner/types';
import { getApiErrorMessage } from '@/lib/errors';

type TabKey = 'active' | 'history';

import { REJECT_REASON_CODES, toRejectReasonCode } from '@/lib/delivery-partner/rider-gateway-types';

const LIVE_STATUSES = new Set([
  'assigned',
  'accepted',
  'arrived',
  'picked_up',
  'out_for_delivery',
  'at_customer',
]);

function money(amount?: number, currency = 'INR') {
  if (amount == null || !Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `₹${Math.round(amount)}`;
  }
}

function formatWhen(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function callPhone(phone?: string) {
  if (!phone) return;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits) return;
  void Linking.openURL(`tel:${digits}`);
}

function openMaps(lat?: number, lng?: number, label?: string) {
  if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    );
    return;
  }
  if (label?.trim()) {
    void Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(label.trim())}`
    );
  }
}

function statusTone(status: string) {
  const s = normalizeDeliveryStatus(status);
  if (s === 'assigned') return '#D97706';
  if (s === 'accepted' || s === 'arrived') return '#EA4B14';
  if (s === 'picked_up' || s === 'out_for_delivery' || s === 'at_customer') return '#B45309';
  if (s === 'delivered') return '#10B981';
  if (s === 'rejected' || s === 'cancelled') return '#EF4444';
  return '#6B7280';
}

function primaryActionLabel(status: string): string | null {
  const action = nextDeliveryAction(status);
  if (action === 'arrived') return 'Arrived at restaurant';
  if (action === 'pickup') return 'Order picked up';
  if (action === 'reached_customer') return 'Arrived at customer';
  if (action === 'deliver') return 'Mark delivered';
  return null;
}

function isLiveDelivery(status: string) {
  return LIVE_STATUSES.has(normalizeDeliveryStatus(status));
}

function isPastDelivery(status: string) {
  const s = normalizeDeliveryStatus(status);
  return s === 'delivered' || s === 'rejected' || s === 'cancelled';
}

export function PartnerOrdersManager() {
  const router = useRouter();
  const headerScroll = useDeliveryHeaderScrollProps();
  const [tab, setTab] = useState<TabKey>('active');
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [deliverTargetId, setDeliverTargetId] = useState<string | null>(null);
  const [pickupTargetId, setPickupTargetId] = useState<string | null>(null);
  const [pickupOtp, setPickupOtp] = useState('');
  const [chatDelivery, setChatDelivery] = useState<PartnerDelivery | null>(null);
  const [otp, setOtp] = useState('');
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const me = useDeliveryPartnerMe();
  const duty = usePartnerDutyStatus();
  const dutyStatus = duty.data?.dutyStatus ?? me.data?.dutyStatus;
  const isOnline = isDutySwitchOn(
    dutyStatus,
    Boolean(me.data?.isOnline ?? me.data?.isAvailable ?? duty.data?.isOnline)
  );
  const onDelivery = dutyStatus === 'on_delivery';
  const goOnlineBlocker = getGoOnlineBlocker(me.data);
  const docProgress = getDocumentProgress(me.data);
  const active = useActiveDelivery(true, { fast: isOnline });
  const history = useDeliveryHistory(20, true);
  const mutations = useDeliveryOrderMutations();

  const historyRows = useMemo(
    () => history.data?.pages.flatMap((p) => p.deliveries) ?? [],
    [history.data?.pages]
  );

  /** Live assignments from active-delivery + deliveries list (assigned / in progress). */
  const liveOrders = useMemo(() => {
    const map = new Map<string, PartnerDelivery>();
    for (const row of historyRows) {
      if (row.id && isLiveDelivery(row.status)) {
        map.set(row.id, row);
      }
    }
    const current = active.data;
    if (current?.id && isLiveDelivery(current.status)) {
      map.set(current.id, current);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aAssigned = isAssignableStatus(a.status) ? 0 : 1;
      const bAssigned = isAssignableStatus(b.status) ? 0 : 1;
      if (aAssigned !== bAssigned) return aAssigned - bAssigned;
      const aTime = Date.parse(a.assignedAt || a.createdAt || '') || 0;
      const bTime = Date.parse(b.assignedAt || b.createdAt || '') || 0;
      return bTime - aTime;
    });
  }, [active.data, historyRows]);

  const pastOrders = useMemo(
    () => historyRows.filter((row) => isPastDelivery(row.status)),
    [historyRows]
  );

  const mutating =
    mutations.accept.isPending ||
    mutations.reject.isPending ||
    mutations.arrived.isPending ||
    mutations.pickup.isPending ||
    mutations.reachedCustomer.isPending ||
    mutations.deliver.isPending ||
    mutations.setOnline.isPending;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([active.refetch(), me.refetch(), history.refetch(), duty.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  };

  const showError = (error: unknown, fallback: string) => {
    Alert.alert('Could not complete', getApiErrorMessage(error, fallback));
  };

  const handleGoOnline = async () => {
    const next = !isOnline;
    if (onDelivery && isOnline) {
      Alert.alert(
        'Active delivery',
        'Complete your active delivery before going offline.'
      );
      return;
    }
    if (next && goOnlineBlocker) {
      Alert.alert(goOnlineBlocker.title, goOnlineBlocker.message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: goOnlineBlocker.actionLabel,
          onPress: () => router.push(goOnlineBlocker.actionHref as never),
        },
      ]);
      return;
    }

    setBusyLabel(next ? 'Going online…' : 'Going offline…');
    try {
      await mutations.setOnline.mutateAsync(next);
      await Promise.all([active.refetch(), history.refetch(), duty.refetch()]);
    } catch (error) {
      Alert.alert(
        'Could not go online',
        formatGoOnlineError(error, 'Could not update online status.')
      );
    } finally {
      setBusyLabel(null);
    }
  };

  const handleAccept = async (deliveryId: string) => {
    setBusyLabel('Accepting…');
    try {
      await mutations.accept.mutateAsync(deliveryId);
      await Promise.all([active.refetch(), history.refetch()]);
    } catch (error) {
      showError(error, 'Could not accept delivery.');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleReject = async () => {
    if (!rejectTargetId) return;
    const reason = rejectReason.trim();
    if (!reason) {
      Alert.alert('Reason required', 'Please tell us why you are declining.');
      return;
    }
    setBusyLabel('Declining…');
    try {
      await mutations.reject.mutateAsync({
        deliveryId: rejectTargetId,
        reason,
        reasonCode: toRejectReasonCode(reason),
      });
      setRejectTargetId(null);
      setRejectReason('');
      await Promise.all([active.refetch(), history.refetch()]);
    } catch (error) {
      showError(error, 'Could not decline delivery.');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleArrived = async (deliveryId: string) => {
    setBusyLabel('Marking arrived…');
    try {
      await mutations.arrived.mutateAsync(deliveryId);
    } catch (error) {
      showError(error, 'Could not mark arrived.');
    } finally {
      setBusyLabel(null);
    }
  };

  const handlePickup = async () => {
    if (!pickupTargetId) return;
    setBusyLabel('Confirming pickup…');
    try {
      await mutations.pickup.mutateAsync({
        deliveryId: pickupTargetId,
        otp: pickupOtp.trim() || undefined,
      });
      setPickupTargetId(null);
      setPickupOtp('');
    } catch (error) {
      showError(error, 'Could not mark pickup. Enter the kitchen OTP if asked.');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleReachedCustomer = async (deliveryId: string) => {
    setBusyLabel('Marking arrived at customer…');
    try {
      await mutations.reachedCustomer.mutateAsync(deliveryId);
    } catch (error) {
      showError(error, 'Could not mark arrived at customer.');
    } finally {
      setBusyLabel(null);
    }
  };

  const handleDeliver = async () => {
    if (!deliverTargetId) return;
    setBusyLabel('Completing delivery…');
    try {
      await mutations.deliver.mutateAsync({
        deliveryId: deliverTargetId,
        payload: {
          otp: otp.trim() || undefined,
          proofUri: proofUri ?? undefined,
          proofFileName: proofUri ? `proof-${Date.now()}.jpg` : undefined,
        },
      });
      setDeliverTargetId(null);
      setOtp('');
      setProofUri(null);
      Alert.alert('Delivered', 'Order marked as delivered.');
      await Promise.all([active.refetch(), history.refetch()]);
    } catch (error) {
      showError(error, 'Could not mark delivered.');
    } finally {
      setBusyLabel(null);
    }
  };

  const runPrimaryAction = (delivery: PartnerDelivery) => {
    const action = nextDeliveryAction(delivery.status);
    if (action === 'arrived') void handleArrived(delivery.id);
    else if (action === 'pickup') {
      setPickupOtp('');
      setPickupTargetId(delivery.id);
    }
    else if (action === 'reached_customer') void handleReachedCustomer(delivery.id);
    else if (action === 'deliver') setDeliverTargetId(delivery.id);
  };

  const pickProof = async (fromCamera: boolean) => {
    if (fromCamera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission needed', 'Allow camera access for delivery proof.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (!result.canceled && result.assets[0]?.uri) {
        setProofUri(result.assets[0].uri);
      }
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach proof.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setProofUri(result.assets[0].uri);
    }
  };

  const loadingActive =
    (active.isLoading && !active.data && !liveOrders.length) ||
    (history.isLoading && !historyRows.length && !active.data);

  return (
    <View style={[styles.root, { paddingTop: headerScroll.contentInsetTop }]}>
      <View style={styles.periodBar}>
        {(
          [
            { key: 'active', label: 'Active' },
            { key: 'history', label: 'History' },
          ] as const
        ).map((item) => {
          const selected = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={[styles.periodHit, selected && styles.periodHitActive]}
            >
              <Text
                style={[
                  styles.periodText,
                  selected && styles.periodTextActive,
                ]}
              >
                {item.label}
                {item.key === 'active' && liveOrders.length
                  ? ` (${liveOrders.length})`
                  : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16 },
        ]}
        onScroll={headerScroll.onScroll}
        scrollEventThrottle={headerScroll.scrollEventThrottle}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={'#EA4B14'}
            colors={['#EA4B14']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Online status */}
        <View style={styles.onlineCard}>
          <View style={styles.onlineLeft}>
            <View
              style={[
                styles.onlineDot,
                {
                  backgroundColor: isOnline
                    ? '#10B981'
                    : '#9CA3AF',
                },
              ]}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.onlineTitle}>
                {isOnline ? 'You’re online' : 'You’re offline'}
              </Text>
              <Text style={styles.onlineSub}>
                {goOnlineBlocker
                  ? goOnlineBlocker.reason === 'documents'
                    ? `Upload documents (${docProgress.submitted}/${docProgress.total})`
                    : goOnlineBlocker.reason === 'pending_review'
                      ? `Under review (${docProgress.verified}/${docProgress.total} verified)`
                      : 'Account activation pending'
                  : isOnline
                    ? 'Receiving new delivery requests'
                    : 'Go online to get assignments'}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => void handleGoOnline()}
            disabled={mutations.setOnline.isPending}
            style={[
              styles.onlineBtn,
              {
                backgroundColor: isOnline
                  ? '#6B7280'
                  : goOnlineBlocker
                    ? '#EA4B14'
                    : '#15803D',
              },
            ]}
          >
            {mutations.setOnline.isPending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Power color="#fff" size={14} />
                <Text style={styles.onlineBtnText}>
                  {isOnline ? 'Go offline' : 'Go online'}
                </Text>
              </>
            )}
          </Pressable>
        </View>

        {goOnlineBlocker && !isOnline ? (
          <Pressable
            onPress={() =>
              router.push(goOnlineBlocker.actionHref as never)
            }
            style={styles.blockerCard}
          >
            <Text style={styles.blockerTitle}>{goOnlineBlocker.title}</Text>
            <Text style={styles.blockerText}>{goOnlineBlocker.message}</Text>
            <Text style={styles.blockerLink}>
              {goOnlineBlocker.actionLabel} →
            </Text>
          </Pressable>
        ) : null}

        {tab === 'active' ? (
          loadingActive ? (
            <View style={styles.center}>
              <ActivityIndicator color={'#EA4B14'} size="large" />
              <Text style={styles.muted}>Checking for orders…</Text>
            </View>
          ) : active.isError && !liveOrders.length ? (
            <View style={styles.cardPad}>
              <Text style={styles.sectionTitle}>Couldn’t load orders</Text>
              <Text style={[styles.muted, { marginTop: 6 }]}>
                {getApiErrorMessage(active.error, 'Pull to retry.')}
              </Text>
              <Pressable
                onPress={() => void onRefresh()}
                style={styles.retryBtn}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : liveOrders.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                {liveOrders.some((d) => isAssignableStatus(d.status))
                  ? 'Incoming requests'
                  : 'Current delivery'}
              </Text>
              {liveOrders.map((delivery) => (
                <DeliveryCard
                  key={delivery.id}
                  delivery={delivery}
                  busy={mutating}
                  onAccept={() => void handleAccept(delivery.id)}
                  onDecline={() => {
                    setRejectReason('');
                    setRejectTargetId(delivery.id);
                  }}
                  onPrimary={() => runPrimaryAction(delivery)}
                  onChat={() => setChatDelivery(delivery)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Package color={'#9CA3AF'} size={28} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>
                {isOnline ? 'Waiting for orders' : 'No active orders'}
              </Text>
              <Text style={styles.emptySub}>
                {isOnline
                  ? 'New assignments will appear here automatically. Keep the app open.'
                  : 'Go online above to start receiving delivery requests.'}
              </Text>
            </View>
          )
        ) : history.isLoading && !pastOrders.length ? (
          <View style={styles.center}>
            <ActivityIndicator color={'#EA4B14'} size="large" />
            <Text style={styles.muted}>Loading history…</Text>
          </View>
        ) : history.isError && !pastOrders.length ? (
          <View style={styles.cardPad}>
            <Text style={styles.sectionTitle}>Couldn’t load history</Text>
            <Text style={[styles.muted, { marginTop: 6 }]}>
              {getApiErrorMessage(history.error, 'Pull to retry.')}
            </Text>
            <Pressable
              onPress={() => void history.refetch()}
              style={styles.retryBtn}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : pastOrders.length === 0 ? (
          <View style={styles.emptyCard}>
            <Package color={'#9CA3AF'} size={28} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No past deliveries</Text>
            <Text style={styles.emptySub}>
              Completed and declined trips will show up here.
            </Text>
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Past deliveries</Text>
            <View style={styles.card}>
              {pastOrders.map((row, index) => (
                <HistoryRow
                  key={row.id}
                  delivery={row}
                  bordered={index < pastOrders.length - 1}
                />
              ))}
              {history.hasNextPage ? (
                <Pressable
                  onPress={() => void history.fetchNextPage()}
                  disabled={history.isFetchingNextPage}
                  style={styles.loadMore}
                >
                  {history.isFetchingNextPage ? (
                    <ActivityIndicator color={'#EA4B14'} />
                  ) : (
                    <Text style={styles.loadMoreText}>Load more</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </ScrollView>

      {busyLabel ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <View style={styles.busyCard}>
            <ActivityIndicator color={'#EA4B14'} />
            <Text style={styles.busyText}>{busyLabel}</Text>
          </View>
        </View>
      ) : null}

      <Modal
        visible={Boolean(rejectTargetId)}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectTargetId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Decline delivery</Text>
              <Pressable onPress={() => setRejectTargetId(null)} hitSlop={8}>
                <X color={'#6B7280'} size={20} />
              </Pressable>
            </View>
            <Text style={styles.modalSub}>
              Choose a reason so dispatch can reassign quickly.
            </Text>
            <View style={styles.chipRow}>
              {REJECT_REASON_CODES.map((preset) => (
                <Pressable
                  key={preset.code}
                  onPress={() => setRejectReason(preset.label)}
                  style={[
                    styles.chip,
                    rejectReason === preset.label && styles.chipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      rejectReason === preset.label && styles.chipTextActive,
                    ]}
                  >
                    {preset.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Decline reason"
              placeholderTextColor={'#9CA3AF'}
              style={styles.input}
              multiline
            />
            <Pressable onPress={() => void handleReject()} style={styles.dangerBtn}>
              <Text style={styles.dangerBtnText}>Confirm decline</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(pickupTargetId)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setPickupTargetId(null);
          setPickupOtp('');
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirm pickup</Text>
              <Pressable
                onPress={() => {
                  setPickupTargetId(null);
                  setPickupOtp('');
                }}
                hitSlop={8}
              >
                <X color={'#6B7280'} size={20} />
              </Pressable>
            </View>
            <Text style={styles.modalSub}>
              Enter the kitchen pickup OTP if the restaurant asks for it, then
              confirm. Same as Swiggy / Zomato pickup.
            </Text>
            <TextInput
              value={pickupOtp}
              onChangeText={setPickupOtp}
              placeholder="Pickup OTP (if required)"
              placeholderTextColor={'#9CA3AF'}
              keyboardType="number-pad"
              style={styles.input}
              maxLength={8}
            />
            <Pressable onPress={() => void handlePickup()} style={styles.primaryBtn}>
              <Package color="#fff" size={18} />
              <Text style={styles.primaryBtnText}>Order picked up</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(deliverTargetId)}
        transparent
        animationType="fade"
        onRequestClose={() => setDeliverTargetId(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Complete delivery</Text>
              <Pressable onPress={() => setDeliverTargetId(null)} hitSlop={8}>
                <X color={'#6B7280'} size={20} />
              </Pressable>
            </View>
            <Text style={styles.modalSub}>
              Enter customer OTP if asked, and optionally attach a proof photo.
            </Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="OTP (optional)"
              placeholderTextColor={'#9CA3AF'}
              keyboardType="number-pad"
              style={styles.input}
              maxLength={8}
            />
            <Pressable
              onPress={() => void pickProof(true)}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>
                {proofUri ? 'Proof photo added ✓' : 'Take proof photo'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void pickProof(false)}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>Choose from gallery</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleDeliver()}
              style={styles.primaryBtn}
            >
              <CheckCircle2 color="#fff" size={18} />
              <Text style={styles.primaryBtnText}>Mark delivered</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {chatDelivery ? (
        <TripChatSheet
          visible
          deliveryId={chatDelivery.id}
          orderId={chatDelivery.orderId}
          onClose={() => setChatDelivery(null)}
        />
      ) : null}
    </View>
  );
}

function DeliveryCard({
  delivery,
  busy,
  onAccept,
  onDecline,
  onPrimary,
  onChat,
}: {
  delivery: PartnerDelivery;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onPrimary: () => void;
  onChat: () => void;
}) {
  const status = normalizeDeliveryStatus(delivery.status);
  const isNew = isAssignableStatus(status);
  const live = isLiveDelivery(status) && !isNew;
  const trackingQuery = useOrderTracking({
    orderId: delivery.orderId,
    deliveryId: delivery.id,
    enabled: live,
  });
  const routeQuery = useTrackingRoute(delivery.orderId, live && Boolean(delivery.orderId));
  const historyQuery = useLocationHistory(delivery.id, live);
  const [trackingPatch, setTrackingPatch] = useState<Partial<OrderTracking> | null>(
    null
  );
  const tracking: OrderTracking | null = trackingQuery.data
    ? { ...trackingQuery.data, ...trackingPatch }
    : trackingPatch
      ? ({
          orderId: delivery.orderId ?? '',
          deliveryId: delivery.id,
          status: delivery.status,
          ...trackingPatch,
        } as OrderTracking)
      : null;

  const action = nextDeliveryAction(status);
  const geo = tracking?.geofence;
  const geoBlocked =
    (action === 'arrived' && (!geo || !geo.atPickup)) ||
    (action === 'reached_customer' && (!geo || !geo.atDrop)) ||
    (action === 'deliver' && (!geo || !geo.atDrop));
  const geoHint =
    action === 'arrived'
      ? `Get within ${geo?.pickupMeters ?? 150}m of the restaurant to mark arrived.`
      : action === 'reached_customer'
        ? `Get within ${geo?.dropMeters ?? 100}m of the customer to mark arrived.`
      : action === 'deliver'
        ? `Get within ${geo?.dropMeters ?? 100}m of the customer to complete delivery.`
        : null;

  const primary = primaryActionLabel(status);
  const pickupLabel = formatDeliveryAddress(delivery.restaurantAddress);
  const dropLabel = formatDeliveryAddress(delivery.deliveryAddress);
  const amount = money(delivery.amount, delivery.currency);
  const earning = money(delivery.earning, delivery.currency);
  const routePoints = (routeQuery.data?.points ?? []).map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  }));
  const historyPoints = (historyQuery.data?.points ?? []).map((p) => ({
    latitude: p.latitude,
    longitude: p.longitude,
  }));

  return (
    <View style={styles.jobCard}>
      <View style={styles.jobTop}>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>
            {deliveryStatusLabel(delivery.status)}
          </Text>
        </View>
        <Text style={styles.orderNo}>
          #{delivery.orderNumber || delivery.orderId || delivery.id.slice(-6)}
        </Text>
      </View>

      {(amount || earning || delivery.distanceKm != null) && (
        <View style={styles.metaRow}>
          {amount ? <Text style={styles.metaStrong}>{amount}</Text> : null}
          {earning ? <Text style={styles.metaEarn}>Earn {earning}</Text> : null}
          {delivery.distanceKm != null ? (
            <Text style={styles.metaMuted}>
              {delivery.distanceKm.toFixed(1)} km
            </Text>
          ) : null}
          {delivery.etaMinutes != null ? (
            <Text style={styles.metaMuted}>{delivery.etaMinutes} min</Text>
          ) : null}
        </View>
      )}

      <DeliveryTripMap
        delivery={delivery}
        tracking={tracking}
        routePolyline={routeQuery.data?.polyline}
        routePoints={routePoints}
        historyPolyline={historyQuery.data?.polyline}
        historyPoints={historyPoints}
        onTrackingPatch={(patch) =>
          setTrackingPatch((prev) => ({ ...prev, ...patch }))
        }
      />

      <View style={styles.timelineContainer}>
        <View style={styles.timelineLine} />
        
        <View style={styles.stop}>
          <View style={styles.timelineDot} />
          <View style={styles.stopBody}>
            <Text style={styles.stopLabel}>PICKUP</Text>
            <Text style={styles.stopTitle}>
              {delivery.restaurantName || 'Restaurant'}
            </Text>
            {pickupLabel ? (
              <Text style={styles.stopAddr} numberOfLines={2}>
                {pickupLabel}
              </Text>
            ) : null}
            <View style={styles.stopActions}>
              {delivery.restaurantPhone ? (
                <Pressable
                  onPress={() => callPhone(delivery.restaurantPhone)}
                  style={styles.miniBtn}
                >
                  <Phone color={'#000000'} size={14} />
                  <Text style={styles.miniBtnText}>Call</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() =>
                  openMaps(
                    delivery.restaurantAddress?.lat,
                    delivery.restaurantAddress?.lng,
                    pickupLabel || delivery.restaurantName
                  )
                }
                style={styles.miniBtn}
              >
                <Navigation color={'#000000'} size={14} />
                <Text style={styles.miniBtnText}>Map</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={[styles.stop, { marginTop: 24 }]}>
          <View style={[styles.timelineDot, styles.timelineDotDrop]} />
          <View style={styles.stopBody}>
            <Text style={styles.stopLabel}>DROP-OFF</Text>
            <Text style={styles.stopTitle}>
              {delivery.customerName || 'Customer'}
            </Text>
            {dropLabel ? (
              <Text style={styles.stopAddr} numberOfLines={2}>
                {dropLabel}
              </Text>
            ) : null}
            <View style={styles.stopActions}>
              {delivery.customerPhone ? (
                <Pressable
                  onPress={() => callPhone(delivery.customerPhone)}
                  style={styles.miniBtn}
                >
                  <Phone color={'#000000'} size={14} />
                  <Text style={styles.miniBtnText}>Call</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() =>
                  openMaps(
                    delivery.deliveryAddress?.lat,
                    delivery.deliveryAddress?.lng,
                    dropLabel
                  )
                }
                style={styles.miniBtn}
              >
                <Navigation color={'#000000'} size={14} />
                <Text style={styles.miniBtnText}>Map</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      {isNew ? (
        <View style={styles.actionRow}>
          <Pressable
            onPress={onDecline}
            disabled={busy}
            style={styles.declineBtn}
          >
            <Text style={styles.declineBtnText}>Decline</Text>
          </Pressable>
          <Pressable
            onPress={onAccept}
            disabled={busy}
            style={styles.acceptBtn}
          >
            <Text style={styles.acceptBtnText}>Accept</Text>
          </Pressable>
        </View>
      ) : primary ? (
        <View style={{ gap: 8 }}>
          {geoBlocked && geoHint ? (
            <Text style={styles.geoHint}>{geoHint}</Text>
          ) : null}
          <Pressable
            onPress={onPrimary}
            disabled={busy || geoBlocked}
            style={[styles.workflowBtn, geoBlocked && styles.workflowBtnDisabled]}
          >
            <Text style={styles.workflowBtnText}>{primary}</Text>
          </Pressable>
          <Pressable
            onPress={onChat}
            disabled={busy}
            style={styles.chatBtn}
          >
            <MessageCircle color="#EA4B14" size={16} />
            <Text style={styles.chatBtnText}>Chat</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function HistoryRow({
  delivery,
  bordered,
}: {
  delivery: PartnerDelivery;
  bordered: boolean;
}) {
  const amount = money(delivery.amount, delivery.currency);
  const earning = money(delivery.earning, delivery.currency);
  const when =
    formatWhen(delivery.deliveredAt) ||
    formatWhen(delivery.updatedAt) ||
    formatWhen(delivery.createdAt);

  return (
    <View style={[styles.historyRow, bordered && styles.rowBorder]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.historyTitle} numberOfLines={1}>
          {delivery.restaurantName || 'Delivery'}
        </Text>
        <Text style={styles.historyMeta} numberOfLines={1}>
          #{delivery.orderNumber || delivery.id.slice(-6)}
          {when ? ` · ${when}` : ''}
        </Text>
        <Text
          style={styles.historyStatus}
        >
          {deliveryStatusLabel(delivery.status)}
        </Text>
      </View>
      <Text style={styles.historyAmount}>{earning || amount || '—'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  periodBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 16,
    padding: 4,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    gap: 2,
  },
  periodHit: {
    flex: 1,
    minHeight: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodHitActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  periodText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#6B7280',
  },
  periodTextActive: {
    color: '#000000',
    fontFamily: fonts.semiBold,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 20,
  },
  onlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  onlineLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  onlineTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#000000',
  },
  onlineSub: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  onlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  onlineBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.semiBold,
    fontSize: 13,
  },
  blockerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.02,
    shadowRadius: 8,
    elevation: 2,
  },
  blockerTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#000000',
  },
  blockerText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  blockerLink: {
    marginTop: 4,
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#000000',
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#000000',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
  },
  cardPad: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  muted: {
    color: '#6B7280',
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingVertical: 48,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
  },
  emptyTitle: {
    marginTop: 8,
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#000000',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  emptySub: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  jobCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.03)',
  },
  jobTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusPill: {
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  statusPillText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#374151',
  },
  orderNo: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#9CA3AF',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 12,
  },
  metaStrong: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: '#000000',
  },
  metaEarn: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#000000',
  },
  metaMuted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  timelineContainer: {
    position: 'relative',
    paddingLeft: 8,
    marginTop: 8,
  },
  timelineLine: {
    position: 'absolute',
    top: 24,
    bottom: 24,
    left: 11,
    width: 2,
    backgroundColor: '#E5E7EB',
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D1D5DB',
    marginTop: 6,
    marginRight: 16,
  },
  timelineDotDrop: {
    backgroundColor: '#000000',
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stopBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  stopLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stopTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#000000',
  },
  stopAddr: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  stopActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  miniBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#374151',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  declineBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  declineBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#374151',
  },
  acceptBtn: {
    flex: 1.5,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000', // Sleek black primary action
  },
  acceptBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  workflowBtn: {
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    marginTop: 8,
  },
  workflowBtnDisabled: {
    backgroundColor: '#9CA3AF',
  },
  workflowBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  chatBtn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  chatBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#EA4B14',
  },
  geoHint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#B45309',
    lineHeight: 17,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 16,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  historyTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#000000',
  },
  historyMeta: {
    marginTop: 4,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  historyStatus: {
    marginTop: 6,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#000000',
  },
  historyAmount: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#000000',
  },
  loadMore: {
    alignItems: 'center',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  loadMoreText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#000000',
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  busyText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#000000',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 16,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#000000',
    letterSpacing: -0.2,
  },
  modalSub: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    borderColor: '#000000',
    backgroundColor: '#F9FAFB',
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#4B5563',
  },
  chipTextActive: {
    color: '#000000',
    fontFamily: fonts.semiBold,
  },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: '#000000',
    textAlignVertical: 'top',
    backgroundColor: '#F9FAFB',
  },
  dangerBtn: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  dangerBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  secondaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#374151',
  },
  primaryBtn: {
    minHeight: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000000',
  },
  primaryBtnText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  retryBtn: {
    marginTop: 16,
    alignSelf: 'flex-start',
    backgroundColor: '#000000',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  retryText: {
    color: '#FFFFFF',
    fontFamily: fonts.semiBold,
    fontSize: 14,
  },
});
