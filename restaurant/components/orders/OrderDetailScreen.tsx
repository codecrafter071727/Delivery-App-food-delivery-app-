import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  Ban,
  Banknote,
  Clock3,
  Package,
  Phone,
  Printer,
  ShoppingBag,
  Timer,
  UtensilsCrossed,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import {
  AcceptPrepSheet,
  RejectOrderSheet,
} from '@/components/orders/KitchenActionSheets';
import {
  DelayOrderSheet,
  ItemsUnavailableSheet,
  KotPreviewSheet,
  PrepTimeSheet,
  RatePartnerSheet,
  RiderHandoverCard,
} from '@/components/orders/KitchenTicketSheets';
import { KitchenOrderChat } from '@/components/orders/KitchenOrderChat';
import { KitchenRiderCard } from '@/components/orders/KitchenRiderCard';
import { AssignPartnerModal } from '@/components/partners/AssignPartnerModal';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useKitchenTicketMutations,
  useMyRestaurantId,
  useOrderHandover,
  useOrderRider,
  useOrderSla,
  useRejectReasons,
  useRestaurantOrder,
  useUpdateRestaurantOrderStatus,
} from '@/lib/order/hooks';
import type { KotPrintResult, RestaurantOrderAction } from '@/lib/order/owner-api';
import {
  addressText,
  canReject,
  displayStatus,
  kitchenTimeline,
  money,
  nextKitchenAction,
  kitchenHandoverCopy,
  orderPlacedLabel,
  rejectBlockedReason,
  resolveOrderTotal,
  shortOrderId,
  statusCaption,
  statusRank,
  statusTone,
} from '@/lib/order/ui';

type Props = {
  orderId: string;
};

function formatClock(sec: number | null) {
  if (sec == null) return null;
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function moneyOutcomeCopy(result: {
  refundAmount: number;
  refundIssued: boolean;
  refundError?: string | null;
  newTotal?: number;
  previousTotal?: number;
  codAmountSynced?: boolean;
  deliveryCancelled?: boolean;
}) {
  const bits: string[] = [];
  if (result.newTotal != null) bits.push(`New total ${money(result.newTotal)}.`);
  if (result.refundIssued && result.refundAmount > 0) {
    bits.push(`${money(result.refundAmount)} will be refunded.`);
  } else if (result.refundError) {
    bits.push(
      'Refund did not go through. The order is updated — support must retry the refund.'
    );
  } else if (result.codAmountSynced) {
    bits.push('Rider collectible was updated.');
  } else if (result.refundAmount === 0) {
    bits.push('No prepaid refund (COD / unpaid).');
  }
  if (result.deliveryCancelled) bits.push('Assigned rider trip was cancelled.');
  return bits.join(' ') || 'Updated.';
}

export function OrderDetailScreen({ orderId }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const restaurantQuery = useMyRestaurantId();
  const restaurantId = restaurantQuery.data?.id;
  const waitingRestaurant =
    restaurantQuery.isPending || restaurantQuery.isLoading;
  const detailQuery = useRestaurantOrder(
    restaurantId,
    orderId,
    Boolean(restaurantId)
  );
  const updateStatus = useUpdateRestaurantOrderStatus(restaurantId);
  const ticket = useKitchenTicketMutations(restaurantId);
  const reasonsQuery = useRejectReasons(restaurantId);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [delayOpen, setDelayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [eightySixOpen, setEightySixOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [rated, setRated] = useState(false);
  const [kot, setKot] = useState<KotPrintResult | null>(null);

  const order = detailQuery.data;
  const slaQuery = useOrderSla(restaurantId, orderId, order?.status);
  const handoverQuery = useOrderHandover(restaurantId, orderId, order);
  const riderQuery = useOrderRider(restaurantId, orderId, order);
  const action = order ? nextKitchenAction(order) : null;
  const ActionIcon = action?.Icon;

  const runAction = async (
    action: RestaurantOrderAction,
    payload?: { prepTime?: number; reasonCode?: string; note?: string }
  ) => {
    if (!order) return;
    if (action === 'accept' && payload?.prepTime == null) {
      setAcceptOpen(true);
      return;
    }
    if (action === 'reject') {
      const blocked = rejectBlockedReason(order);
      if (blocked) {
        Alert.alert('Cannot reject yet', blocked);
        return;
      }
    }
    try {
      const updated = await updateStatus.mutateAsync({
        orderId: order.id,
        action,
        prepTime: payload?.prepTime,
        reasonCode: payload?.reasonCode,
        note: payload?.note,
      });
      setRejectOpen(false);
      setAcceptOpen(false);

      if (
        action === 'ready' &&
        (updated.fulfillmentTone ?? order.fulfillmentTone) === 'delivery' &&
        restaurantId
      ) {
        setAssignOpen(true);
      }
    } catch (error) {
      Alert.alert('Could not update order', getApiErrorMessage(error));
    }
  };

  const runTicketAction = async () => {
    if (!order || !action) return;
    if (action.kind === 'pickup-ready') {
      try {
        await ticket.pickupReady.mutateAsync(order.id);
      } catch (error) {
        Alert.alert('Could not mark pickup ready', getApiErrorMessage(error));
      }
      return;
    }
    if (action.kind === 'complete-takeaway') {
      try {
        await ticket.completeTakeaway.mutateAsync(order.id);
        Alert.alert('Collected', 'Takeaway handed to the customer.');
      } catch (error) {
        Alert.alert('Could not complete takeaway', getApiErrorMessage(error));
      }
      return;
    }
    if (action.kind === 'handover') {
      try {
        const result = await ticket.handToRider.mutateAsync(order.id);
        const copy = kitchenHandoverCopy(
          result.outcome,
          result.handover.message
        );
        Alert.alert(copy.title, copy.body);
      } catch (error) {
        Alert.alert('Could not hand to rider', getApiErrorMessage(error));
      }
      return;
    }
    await runAction(action.action);
  };

  const confirmHandover = async (method: 'otp' | 'tap', otp?: string) => {
    try {
      await ticket.confirmHandover.mutateAsync({
        orderId,
        method,
        otp,
      });
    } catch (error) {
      Alert.alert('Could not confirm handover', getApiErrorMessage(error));
    }
  };

  const callCustomer = async () => {
    try {
      const result = await ticket.callCustomer.mutateAsync(orderId);
      const to = result.toMasked ? ` ${result.toMasked}` : ' the customer';
      Alert.alert(
        'Calling customer',
        `Your restaurant phone will ring first, then we connect${to}. Their number stays hidden.`
      );
    } catch (error) {
      const message = getApiErrorMessage(error);
      const title = message.includes('MASKED_CALL_UNAVAILABLE')
        ? 'Calling unavailable'
        : message.includes('CALL_RATE_LIMITED')
          ? 'Too many calls'
          : 'Could not call customer';
      Alert.alert(
        title,
        message.includes('MASKED_CALL_UNAVAILABLE')
          ? 'Masked calling is down right now. Use trip chat, or try again later.'
          : message
      );
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/orders');
  };

  const tone = statusTone(order?.status ?? 'pending');
  const rank = statusRank(order?.status ?? 'pending');
  const cancelled = rank < 0;
  const total = order ? resolveOrderTotal(order) : 0;
  const address = order ? addressText(order) : '';
  const cooking =
    order?.status === 'accepted' || order?.status === 'preparing';
  const canDelay =
    cooking || order?.status === 'ready';
  const canPrint = Boolean(order) && statusRank(order?.status ?? 'pending') >= 0;
  const lineIds = (order?.items ?? []).filter((item) => item.id);
  const busy = updateStatus.isPending || ticket.isPending;
  const sla = slaQuery.data;
  const rider = riderQuery.data;
  const canCall = Boolean(
    order &&
      order.fulfillmentTone !== 'table' &&
      (order.status === 'accepted' ||
        order.status === 'preparing' ||
        order.status === 'ready' ||
        order.status === 'out_for_delivery')
  );
  const canAssign = Boolean(
    order?.fulfillmentTone === 'delivery' &&
      (order.status === 'accepted' ||
        order.status === 'preparing' ||
        order.status === 'ready')
  );
  const canRate = Boolean(
    !rated &&
      rider?.assigned &&
      (handoverQuery.data?.available ||
        handoverQuery.data?.confirmed ||
        order?.status === 'out_for_delivery' ||
        order?.status === 'delivered' ||
        `${rider.dutyStatus ?? rider.status ?? ''}`
          .toLowerCase()
          .includes('arrived'))
  );

  const printKot = async () => {
    try {
      const result = await ticket.printKot.mutateAsync(orderId);
      setKot(result);
    } catch (error) {
      Alert.alert('Could not print KOT', getApiErrorMessage(error));
    }
  };

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title={order ? `#${shortOrderId(order)}` : 'Order'}
        subtitle={
          order
            ? `${displayStatus(order.status)}${
                order.prepMinutes ? ` · ${order.prepMinutes} min prep` : ''
              }`
            : restaurantQuery.data?.name || 'Ticket'
        }
        showBack
        headerRight={
          canPrint ? (
            <Pressable
              accessibilityLabel="Print KOT"
              disabled={ticket.printKot.isPending}
              onPress={() => void printKot()}
              style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              {ticket.printKot.isPending ? (
                <ActivityIndicator color={authTheme.text} size="small" />
              ) : (
                <Printer color={authTheme.text} size={18} strokeWidth={2.4} />
              )}
            </Pressable>
          ) : null
        }
      />

      {waitingRestaurant || (detailQuery.isLoading && !order) ? (
        <View style={styles.center}>
          <ActivityIndicator color={authTheme.brand} size="large" />
          <Text style={styles.muted}>Loading order details…</Text>
        </View>
      ) : detailQuery.isError && !order ? (
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Couldn’t load order</Text>
          <Text style={styles.muted}>
            {getApiErrorMessage(detailQuery.error)}
          </Text>
          <Pressable
            style={styles.retryBtn}
            onPress={() => void detailQuery.refetch()}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
          <Pressable onPress={goBack} style={{ marginTop: 8 }}>
            <Text style={styles.backToOrdersText}>Back to Orders</Text>
          </Pressable>
        </View>
      ) : order ? (
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.content,
              {
                paddingBottom:
                  PARTNER_BOTTOM_NAV_INSET +
                  Math.max(insets.bottom, 12) +
                  (action || canReject(order) ? 72 : 0),
              },
            ]}
            refreshControl={
              <RefreshControl
                refreshing={detailQuery.isRefetching}
                onRefresh={() => {
                  void detailQuery.refetch();
                  void slaQuery.refetch();
                  void handoverQuery.refetch();
                  void riderQuery.refetch();
                }}
                tintColor={authTheme.brand}
                colors={[authTheme.brand]}
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {sla ? (
              <View
                style={[
                  styles.slaCard,
                  (sla.isAcceptOverdue || sla.isPrepOverdue) && styles.slaLate,
                ]}
              >
                <Clock3
                  color={
                    sla.isAcceptOverdue || sla.isPrepOverdue
                      ? '#DC2626'
                      : authTheme.brand
                  }
                  size={16}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.slaTitle}>
                    {sla.isAcceptOverdue
                      ? 'Accept overdue'
                      : sla.isPrepOverdue
                        ? 'Prep overdue'
                        : sla.acceptRemainingSec != null &&
                            (order.status === 'placed' || order.status === 'pending')
                          ? `Accept in ${formatClock(sla.acceptRemainingSec)}`
                          : sla.prepRemainingSec != null
                            ? `Promised ready in ${formatClock(sla.prepRemainingSec)}`
                            : 'On time'}
                  </Text>
                  <Text style={styles.slaCopy}>
                    {order.isDelayed
                      ? `Marked late${order.delayMinutes ? ` +${order.delayMinutes}m` : ''}`
                      : 'Live kitchen timer'}
                  </Text>
                </View>
              </View>
            ) : slaQuery.isError ? (
              <Text style={styles.muted}>{getApiErrorMessage(slaQuery.error)}</Text>
            ) : null}

            {order.fulfillmentTone === 'delivery' &&
            (order.status === 'ready' || order.status === 'out_for_delivery') ? (
              <RiderHandoverCard
                handover={handoverQuery.data}
                loading={handoverQuery.isLoading}
                error={handoverQuery.error}
                busy={ticket.confirmHandover.isPending}
                onRetry={() => void handoverQuery.refetch()}
                onConfirmOtp={(otp) => void confirmHandover('otp', otp)}
                onConfirmTap={() => void confirmHandover('tap')}
              />
            ) : null}

            {order.fulfillmentTone === 'pickup' &&
            (order.status === 'preparing' || order.status === 'ready') ? (
              <View
                style={[
                  styles.slaCard,
                  order.status === 'ready' && { borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' },
                ]}
              >
                <ShoppingBag
                  color={order.status === 'ready' ? '#059669' : authTheme.brand}
                  size={16}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.slaTitle}>
                    {order.status === 'ready'
                      ? 'Customer can collect'
                      : 'Takeaway order'}
                  </Text>
                  <Text style={styles.slaCopy}>
                    {order.status === 'ready'
                      ? 'Hand the bag at the counter, then tap Handed to customer. Do not use rider handover.'
                      : 'When packed, tap Ready for pickup. The customer is notified to come collect.'}
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Customer Details */}
            <View style={styles.card}>
              <Text style={styles.customerNameCustom}>
                {order.customerName?.trim() || 'Guest'}
              </Text>
              
              <View style={styles.kvRowCustom}>
                <Text style={styles.kvLabelCustom}>Delivery Address</Text>
                <Text style={styles.kvValueCustom}>
                  {address ||
                    (order.fulfillmentTone === 'pickup'
                      ? 'Pickup order'
                      : order.fulfillmentTone === 'table'
                        ? order.fulfillmentLabel
                        : '—')}
                </Text>
              </View>
              
              <View style={styles.kvRowCustom}>
                <Text style={styles.kvLabelCustom}>Order Type</Text>
                <Text style={styles.kvValueCustom}>{order.fulfillmentLabel}</Text>
              </View>

              {order.customerPhone ? (
                <View style={styles.kvRowCustom}>
                  <Text style={styles.kvLabelCustom}>Phone</Text>
                  <Text style={styles.kvValueCustom}>{order.customerPhone}</Text>
                </View>
              ) : null}

              <View style={styles.kvRowCustom}>
                <Text style={styles.kvLabelCustom}>Placed</Text>
                <Text style={styles.kvValueCustom}>
                  {orderPlacedLabel(order.createdAt)}
                </Text>
              </View>
              <View style={styles.kvRowCustom}>
                <Text style={styles.kvLabelCustom}>Status</Text>
                <Text style={[styles.kvValueCustom, { color: tone.color }]}>
                  {displayStatus(order.status)}
                </Text>
              </View>
              {order.prepMinutes ? (
                <View style={styles.kvRowCustom}>
                  <Text style={styles.kvLabelCustom}>Prep time</Text>
                  <Text style={styles.kvValueCustom}>{order.prepMinutes} min</Text>
                </View>
              ) : null}
              {canCall ? (
                <Pressable
                  disabled={ticket.callCustomer.isPending}
                  onPress={() => void callCustomer()}
                  style={styles.callBtn}
                >
                  {ticket.callCustomer.isPending ? (
                    <ActivityIndicator color={authTheme.brand} size="small" />
                  ) : (
                    <Phone color={authTheme.brand} size={15} />
                  )}
                  <Text style={styles.callBtnText}>Call customer</Text>
                </Pressable>
              ) : null}
            </View>

            {(cooking || canDelay || canPrint) ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Kitchen</Text>
                <View style={styles.toolGrid}>
                  <Pressable
                    disabled={!canPrint || ticket.printKot.isPending}
                    onPress={() => void printKot()}
                    style={styles.tool}
                  >
                    <Printer color={authTheme.text} size={16} />
                    <Text style={styles.toolText}>Print KOT</Text>
                  </Pressable>
                  {cooking ? (
                    <Pressable
                      onPress={() => setPrepOpen(true)}
                      style={styles.tool}
                    >
                      <Timer color={authTheme.text} size={16} />
                      <Text style={styles.toolText}>Prep time</Text>
                    </Pressable>
                  ) : null}
                  {canDelay ? (
                    <Pressable
                      onPress={() => setDelayOpen(true)}
                      style={styles.tool}
                    >
                      <Clock3 color={authTheme.text} size={16} />
                      <Text style={styles.toolText}>Running late</Text>
                    </Pressable>
                  ) : null}
                  {cooking && order.items.length > 1 && lineIds.length >= 1 ? (
                    <Pressable
                      onPress={() => setEightySixOpen(true)}
                      style={styles.tool}
                    >
                      <UtensilsCrossed color={authTheme.text} size={16} />
                      <Text style={styles.toolText}>Item 86</Text>
                    </Pressable>
                  ) : null}
                  {cooking ? (
                    <Pressable
                      onPress={() => setCancelOpen(true)}
                      style={styles.tool}
                    >
                      <Ban color={authTheme.error} size={16} />
                      <Text style={[styles.toolText, { color: authTheme.error }]}>
                        Cancel
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Vertical Timeline */}
            <View style={styles.card}>
              {kitchenTimeline(order).map((step, index, steps) => {
                const stepRank = statusRank(step.key);
                const done = !cancelled && rank > stepRank;
                const active = !cancelled && rank === stepRank;
                const isLast = index === steps.length - 1;
                
                return (
                  <View key={step.key} style={styles.vTimelineRow}>
                    <View style={styles.vTimelineLeft}>
                       <View style={[styles.vTimelineDot, done && styles.vTimelineDotDone, active && styles.vTimelineDotActive]}>
                         {done ? <View style={styles.vTimelineInnerDotDone} /> : <View style={active ? styles.vTimelineInnerDotActive : styles.vTimelineInnerDot} />}
                       </View>
                       {!isLast && <View style={[styles.vTimelineLine, (done || active) && styles.vTimelineLineActive]} />}
                    </View>
                    <View style={styles.vTimelineRight}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={[styles.vTimelineTitle, (active || done) && styles.vTimelineTitleActive]}>{step.label}</Text>
                        {active && (
                          <View style={styles.vTimelineBadge}>
                            <Text style={styles.vTimelineBadgeText}>{displayStatus(order.status)}</Text>
                          </View>
                        )}
                      </View>
                      {active && (
                        <Text style={styles.vTimelineDesc}>
                          {statusCaption(order.status, order.fulfillmentTone)}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Items */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Package color={authTheme.brand} size={16} />
                <Text style={styles.cardTitle}>Order Items</Text>
              </View>
              {order.items.length === 0 ? (
                <Text style={styles.muted}>No items returned for this order.</Text>
              ) : (
                order.items.map((item, index) => (
                  <View
                    key={item.id || `${item.name}-${index}`}
                    style={[
                      styles.itemRow,
                      index < order.items.length - 1 && styles.itemBorder,
                    ]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <Text style={styles.itemMeta}>Qty: {item.quantity}</Text>
                      {item.specialInstructions ? (
                        <Text style={styles.itemNote}>
                          {item.specialInstructions}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.itemPrice}>
                      {item.price != null
                        ? money(item.price * item.quantity)
                        : '—'}
                    </Text>
                  </View>
                ))
              )}
            </View>

            {order.specialInstructions ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Instructions</Text>
                <Text style={styles.fieldValue}>{order.specialInstructions}</Text>
              </View>
            ) : null}

            {/* Summary */}
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Banknote color={authTheme.brand} size={16} />
                <Text style={styles.cardTitle}>Order Summary</Text>
              </View>
              {(() => {
                const subtotal = order.subtotal;
                const deliveryFee = order.deliveryFee ?? 0;
                const discount = order.discount ?? 0;
                // If API omits tax but total is higher, derive the gap so the math is clear.
                const derivedTax =
                  order.tax != null && order.tax > 0
                    ? order.tax
                    : subtotal != null && total > 0
                      ? Math.round(
                          (total - subtotal - deliveryFee + discount) * 100
                        ) / 100
                      : 0;
                const tax =
                  order.tax != null && order.tax > 0
                    ? order.tax
                    : derivedTax > 0.009
                      ? derivedTax
                      : null;

                return (
                  <>
                    {subtotal != null ? (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Subtotal</Text>
                        <Text style={styles.summaryValue}>{money(subtotal)}</Text>
                      </View>
                    ) : null}
                    {tax != null ? (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Tax / GST</Text>
                        <Text style={styles.summaryValue}>{money(tax)}</Text>
                      </View>
                    ) : null}
                    {order.deliveryFee != null ? (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Delivery fee</Text>
                        <Text style={styles.summaryValue}>
                          {money(order.deliveryFee)}
                        </Text>
                      </View>
                    ) : null}
                    {discount > 0 ? (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Discount</Text>
                        <Text style={styles.summaryValue}>-{money(discount)}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.summaryRow, styles.summaryTotal]}>
                      <Text style={styles.totalLabel}>Total</Text>
                      <Text style={styles.totalValue}>{money(total)}</Text>
                    </View>
                    {subtotal != null && tax != null ? (
                      <Text style={styles.summaryHint}>
                        Total = subtotal {money(subtotal)}
                        {tax > 0 ? ` + tax ${money(tax)}` : ''}
                        {deliveryFee > 0 ? ` + delivery ${money(deliveryFee)}` : ''}
                        {discount > 0 ? ` − discount ${money(discount)}` : ''}
                      </Text>
                    ) : null}
                    {order.paymentMethod ? (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Payment method</Text>
                        <Text style={styles.summaryValue}>
                          {order.paymentMethod}
                        </Text>
                      </View>
                    ) : null}
                    {order.paymentStatus ? (
                      <View style={styles.summaryRow}>
                        <Text style={styles.summaryLabel}>Payment status</Text>
                        <Text style={styles.summaryValue}>
                          {displayStatus(order.paymentStatus)}
                        </Text>
                      </View>
                    ) : null}
                  </>
                );
              })()}
            </View>

            {/* Partner */}
            {order.fulfillmentTone === 'delivery' ? (
              <KitchenRiderCard
                rider={rider}
                loading={riderQuery.isLoading}
                error={riderQuery.error}
                canAssign={canAssign}
                canRate={canRate}
                callBusy={ticket.callCustomer.isPending}
                onRetry={() => void riderQuery.refetch()}
                onCallCustomer={() => void callCustomer()}
                onAssign={() => setAssignOpen(true)}
                onRate={() => setRateOpen(true)}
              />
            ) : null}

            <KitchenOrderChat
              orderId={order.id}
              fulfillmentTone={order.fulfillmentTone}
              hasPartner={Boolean(rider?.assigned)}
            />

            <Pressable onPress={goBack} style={styles.backToOrders}>
              <ArrowLeft color={authTheme.brand} size={16} />
              <Text style={styles.backToOrdersText}>Back to Orders</Text>
            </Pressable>
          </ScrollView>

          {(action || canReject(order)) && (
            <View
              style={[
                styles.actionBar,
                { paddingBottom: Math.max(insets.bottom, 12) },
              ]}
            >
              {canReject(order) ? (
                <Pressable
                  disabled={busy}
                  onPress={() => setRejectOpen(true)}
                  style={[styles.barBtn, styles.rejectBtn]}
                >
                  <X color={authTheme.error} size={16} />
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
              ) : null}
              {action ? (
                <Pressable
                  disabled={busy}
                  onPress={() => void runTicketAction()}
                  style={[styles.barBtn, styles.primaryBtn]}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      {ActionIcon ? (
                        <ActionIcon color="#FFFFFF" size={16} />
                      ) : null}
                      <Text style={styles.primaryText}>{action.label}</Text>
                    </>
                  )}
                </Pressable>
              ) : null}
            </View>
          )}
        </>
      ) : null}

      <AcceptPrepSheet
        visible={acceptOpen}
        order={order ?? null}
        busy={updateStatus.isPending}
        onClose={() => setAcceptOpen(false)}
        onConfirm={(prepTime) => void runAction('accept', { prepTime })}
      />
      <RejectOrderSheet
        visible={rejectOpen}
        order={order ?? null}
        reasons={reasonsQuery.data ?? []}
        reasonsError={reasonsQuery.error}
        busy={updateStatus.isPending}
        onClose={() => setRejectOpen(false)}
        onConfirm={(reasonCode, note) =>
          void runAction('reject', { reasonCode, note })
        }
      />
      <PrepTimeSheet
        key={`prep-${order?.prepMinutes ?? 20}`}
        visible={prepOpen}
        current={order?.prepMinutes ?? 20}
        busy={ticket.prepTime.isPending}
        onClose={() => setPrepOpen(false)}
        onConfirm={(prepMinutes) => {
          void ticket.prepTime
            .mutateAsync({ orderId, prepMinutes })
            .then(() => setPrepOpen(false))
            .catch((error) =>
              Alert.alert('Could not update prep time', getApiErrorMessage(error))
            );
        }}
      />
      <DelayOrderSheet
        visible={delayOpen}
        busy={ticket.delay.isPending}
        onClose={() => setDelayOpen(false)}
        onConfirm={(extraMinutes, reason) => {
          void ticket.delay
            .mutateAsync({ orderId, extraMinutes, reason })
            .then(() => {
              setDelayOpen(false);
              Alert.alert(
                'Customer notified',
                `This order is marked +${extraMinutes} minutes late.`
              );
            })
            .catch((error) =>
              Alert.alert('Could not delay order', getApiErrorMessage(error))
            );
        }}
      />
      <RejectOrderSheet
        visible={cancelOpen}
        order={order ?? null}
        reasons={reasonsQuery.data ?? []}
        reasonsError={reasonsQuery.error}
        busy={ticket.cancel.isPending}
        title="Cancel this order?"
        copy="Use this after you’ve already accepted. Prepaid orders are refunded when payment-service allows it."
        confirmLabel="Cancel order"
        onClose={() => setCancelOpen(false)}
        onConfirm={(reasonCode, note) => {
          void ticket.cancel
            .mutateAsync({ orderId, reasonCode, note })
            .then((result) => {
              setCancelOpen(false);
              Alert.alert('Order cancelled', moneyOutcomeCopy(result));
            })
            .catch((error) =>
              Alert.alert('Could not cancel order', getApiErrorMessage(error))
            );
        }}
      />
      <ItemsUnavailableSheet
        visible={eightySixOpen}
        order={order ?? null}
        busy={ticket.itemsUnavailable.isPending}
        onClose={() => setEightySixOpen(false)}
        onConfirm={(itemIds, note) => {
          void ticket.itemsUnavailable
            .mutateAsync({ orderId, itemIds, note })
            .then((result) => {
              setEightySixOpen(false);
              Alert.alert('Items removed', moneyOutcomeCopy(result));
            })
            .catch((error) =>
              Alert.alert('Could not remove items', getApiErrorMessage(error))
            );
        }}
      />
      <KotPreviewSheet result={kot} onClose={() => setKot(null)} />
      <RatePartnerSheet
        visible={rateOpen}
        riderName={rider?.name}
        busy={ticket.ratePartner.isPending}
        onClose={() => setRateOpen(false)}
        onConfirm={(stars, comment) => {
          void ticket.ratePartner
            .mutateAsync({
              orderId,
              stars,
              comment,
              partnerId: rider?.partnerId,
            })
            .then((result) => {
              setRateOpen(false);
              setRated(true);
              Alert.alert(
                result.alreadySubmitted ? 'Already rated' : 'Thanks',
                result.alreadySubmitted
                  ? 'This pickup was already rated.'
                  : `Saved ${result.stars}★ for ${rider?.name || 'the rider'}.`
              );
            })
            .catch((error) =>
              Alert.alert('Could not rate rider', getApiErrorMessage(error))
            );
        }}
      />

      {restaurantId ? (
        <AssignPartnerModal
          visible={assignOpen}
          restaurantId={restaurantId}
          orderId={orderId}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            void riderQuery.refetch();
          }}
        />
      ) : null}
    </View>
  );
}

/** Route wrapper — reads orderId from params. */
export function OrderDetailRoute() {
  const params = useLocalSearchParams<{ orderId?: string | string[] }>();
  const raw = params.orderId;
  const encoded = Array.isArray(raw) ? raw[0] : raw;
  let orderId = encoded?.trim() || '';
  try {
    orderId = decodeURIComponent(orderId);
  } catch {
    // keep raw
  }

  if (!orderId) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.errorTitle}>Missing order id</Text>
      </View>
    );
  }

  return <OrderDetailScreen orderId={orderId} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: authTheme.surface,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  topCopy: { flex: 1, minWidth: 0 },
  restaurantName: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  orderHeading: {
    marginTop: 2,
    fontFamily: fonts.extraBold,
    fontSize: 22,
    color: authTheme.text,
    letterSpacing: -0.4,
  },
  placedAt: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textDim,
  },
  scroll: { flex: 1 },
  content: {
    padding: 16,
    gap: 12,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  errorTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
  },
  retryText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
  },
  slaCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slaLate: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  slaTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  slaCopy: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    marginTop: 2,
  },
  toolGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  tool: {
    minWidth: '30%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: authTheme.surface,
  },
  toolText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.text,
  },
  twoCol: {
    flexDirection: 'row',
    gap: 10,
  },
  halfCard: {
    flex: 1,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  timelineRow: {
    paddingBottom: 4,
    gap: 0,
  },
  timelineStep: {
    width: 88,
    alignItems: 'center',
  },
  timelineTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 8,
  },
  timelineLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E2E8F0',
  },
  timelineLineOn: {
    backgroundColor: authTheme.brand,
  },
  timelineLineSpacer: {
    flex: 1,
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  timelineDotDone: {
    backgroundColor: authTheme.brandSoft,
  },
  timelineDotActive: {
    backgroundColor: '#FFE4E8',
    borderWidth: 2,
    borderColor: authTheme.brand,
  },
  timelineLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: authTheme.textDim,
    textAlign: 'center',
    lineHeight: 13,
  },
  timelineLabelOn: {
    color: authTheme.text,
    fontFamily: fonts.semiBold,
  },
  statusBlock: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  statusEyebrow: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: authTheme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statusTitle: {
    marginTop: 4,
    fontFamily: fonts.extraBold,
    fontSize: 20,
    color: authTheme.text,
  },
  statusPill: {
    maxWidth: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: {
    flexShrink: 1,
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  paymentWaitHint: {
    marginTop: 12,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#B45309',
    lineHeight: 17,
  },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textDim,
    marginBottom: 3,
  },
  fieldValue: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
    lineHeight: 19,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
  },
  itemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  itemName: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  itemMeta: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  itemNote: {
    marginTop: 4,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.brand,
  },
  itemPrice: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  summaryLabel: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
  },
  summaryValue: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
  summaryTotal: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  totalLabel: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  totalValue: {
    fontFamily: fonts.extraBold,
    fontSize: 18,
    color: authTheme.brand,
  },
  summaryHint: {
    marginTop: 6,
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textDim,
    lineHeight: 15,
  },
  assignBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: authTheme.brandMuted,
    backgroundColor: authTheme.brandSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  assignBtnText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: authTheme.brand,
  },
  callBtn: {
    marginTop: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: authTheme.brandMuted,
    backgroundColor: authTheme.brandSoft,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  callBtnText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: authTheme.brand,
  },
  backToOrders: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  backToOrdersText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.brand,
  },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  barBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rejectBtn: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    flex: 0.45,
  },
  rejectText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.error,
  },
  primaryBtn: {
    backgroundColor: authTheme.brand,
    flex: 1,
  },
  primaryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    gap: 10,
  },
  dialogTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: authTheme.text,
  },
  dialogText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  rejectChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rejectChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: authTheme.surface,
  },
  rejectChipOn: {
    backgroundColor: authTheme.brandSoft,
  },
  rejectChipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  rejectChipTextOn: {
    color: authTheme.brand,
    fontFamily: fonts.semiBold,
  },
  reasonInput: {
    minHeight: 90,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    padding: 12,
    textAlignVertical: 'top',
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  dialogBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogCancel: {
    backgroundColor: authTheme.surface,
  },
  dialogCancelText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.textMuted,
  },
  dialogConfirm: {
    backgroundColor: authTheme.error,
  },
  dialogConfirmText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#FFFFFF',
  },
  topHeaderCustom: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 16,
  },
  backBtnInline: {
    paddingRight: 8,
  },
  topOrderIdCustom: {
    fontFamily: fonts.extraBold,
    fontSize: 16,
    color: authTheme.text,
  },
  topPlacedOnCustom: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    marginTop: 4,
    marginLeft: 32,
  },
  topActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    marginLeft: 32,
  },
  outlineBtnCustom: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  outlineBtnTextCustom: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
  customerNameCustom: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: authTheme.text,
    marginBottom: 16,
  },
  kvRowCustom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  kvLabelCustom: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.textMuted,
  },
  kvValueCustom: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
    flexShrink: 1,
    textAlign: 'right',
  },
  vTimelineRow: {
    flexDirection: 'row',
  },
  vTimelineLeft: {
    width: 32,
    alignItems: 'center',
    marginRight: 12,
  },
  vTimelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vTimelineDotDone: {
    backgroundColor: authTheme.textDim,
  },
  vTimelineDotActive: {
    backgroundColor: '#E0F2FE',
    borderWidth: 2,
    borderColor: '#0284C7',
  },
  vTimelineInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CBD5E1',
  },
  vTimelineInnerDotDone: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  vTimelineInnerDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0284C7',
  },
  vTimelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  vTimelineLineActive: {
    backgroundColor: '#0284C7',
  },
  vTimelineRight: {
    flex: 1,
    paddingBottom: 24,
  },
  vTimelineTitle: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: authTheme.textMuted,
  },
  vTimelineTitleActive: {
    fontFamily: fonts.bold,
    color: authTheme.text,
  },
  vTimelineDesc: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
    marginTop: 6,
  },
  vTimelineBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  vTimelineBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#92400E',
  },
  expandTrackingText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#0284C7',
    textAlign: 'center',
  },
});
