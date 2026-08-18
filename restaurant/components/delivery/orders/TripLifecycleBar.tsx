import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react-native';

import { fonts } from '@/constants/typography';
import { CodUpiSheet } from '@/components/delivery/orders/CodUpiSheet';
import {
  nextDeliveryAction,
  normalizeDeliveryStatus,
  resolveTripStep,
  type TripWorkflowAction,
} from '@/lib/delivery-partner/api';
import { isCodPayment } from '@/lib/delivery-partner/finance-types';
import { useDeliveryOrderMutations } from '@/lib/delivery-partner/hooks';
import {
  formatRtoError,
  formatTripError,
} from '@/lib/delivery-partner/rider-ack';
import { getApiErrorCode } from '@/lib/errors';
import {
  useOrderTracking,
  useTrackingStatus,
} from '@/lib/delivery-partner/tracking-hooks';
import {
  CANCEL_REASON_CODES,
  FAIL_REASON_CODES,
  RETURN_REASON_CODES,
  TRIP_ISSUE_CODES,
  type CancelReasonCode,
  type FailReasonCode,
  type PartnerDelivery,
  type ReturnReasonCode,
  type TripIssueCode,
  type UnreachableChannel,
} from '@/lib/delivery-partner/types';

type SheetKey =
  | 'pickup'
  | 'otp'
  | 'cancel'
  | 'issue'
  | 'deliver'
  | 'rto'
  | 'return'
  | 'return_otp'
  | 'fail'
  | null;

type Props = {
  delivery: PartnerDelivery;
  geoBlocked?: boolean;
  geoHint?: string | null;
  /** Session sheet already has call on the stop card. */
  hideCallActions?: boolean;
};

type TripGeo = {
  atPickup?: boolean;
  atDrop?: boolean;
  pickupMeters?: number;
  dropMeters?: number;
} | null;

export function tripGeofenceState(
  status: string,
  geo?: TripGeo,
  step?: TripWorkflowAction
) {
  const action = step ?? nextDeliveryAction(status);
  // Missing tracking payload ≠ outside geofence. Still allow the tap so we can
  // ping GPS; the server returns GEOFENCE_NOT_MET if they are too far.
  if (!geo) return { blocked: false, hint: null as string | null };
  if (
    action === 'arrived' ||
    action === 'pickup' ||
    action === 'return_store' ||
    action === 'complete_return'
  ) {
    const blocked = !geo.atPickup;
    return {
      blocked,
      hint: blocked
        ? action === 'return_store' || action === 'complete_return'
          ? 'You must be at the restaurant (150 m).'
          : `Get within ${geo.pickupMeters ?? 150}m of the restaurant.`
        : null,
    };
  }
  if (action === 'reached_customer' || action === 'deliver') {
    const blocked = !geo.atDrop;
    return {
      blocked,
      hint: blocked
        ? `Get within ${geo.dropMeters ?? 100}m of the customer.`
        : null,
    };
  }
  return { blocked: false, hint: null as string | null };
}

async function pickImage(fromCamera: boolean): Promise<string | null> {
  if (fromCamera) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow camera access for this photo.');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    return result.canceled ? null : result.assets[0]?.uri ?? null;
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Permission needed', 'Allow photo access to attach a file.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
  });
  return result.canceled ? null : result.assets[0]?.uri ?? null;
}

function rtoRemainingSeconds(delivery: PartnerDelivery) {
  if (delivery.rtoTimerEndsAt) {
    const ms = Date.parse(delivery.rtoTimerEndsAt) - Date.now();
    if (Number.isFinite(ms)) return Math.max(0, Math.ceil(ms / 1000));
  }
  return delivery.rtoRemainingSeconds ?? null;
}

function formatClock(total: number) {
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function waitCopy(delivery: PartnerDelivery) {
  if (!delivery.waitStartedAt && !delivery.orderNotReadyCount) return null;
  const started = delivery.waitStartedAt
    ? Date.parse(delivery.waitStartedAt)
    : NaN;
  const mins =
    delivery.waitMinutes ??
    (Number.isFinite(started)
      ? Math.max(0, Math.round((Date.now() - started) / 60_000))
      : null);
  const parts = [
    mins != null ? `Waiting ${mins} min` : 'Waiting at restaurant',
    delivery.orderNotReadyCount
      ? `Kitchen pinged ${delivery.orderNotReadyCount}×`
      : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function TripLifecycleWithGeo({
  delivery,
}: {
  delivery: PartnerDelivery;
}) {
  const status = normalizeDeliveryStatus(delivery.status);
  const live =
    status === 'accepted' ||
    status === 'arrived' ||
    status === 'picked_up' ||
    status === 'out_for_delivery' ||
    status === 'at_customer' ||
    status === 'returning_to_restaurant';
  const trackingQuery = useOrderTracking({
    orderId: delivery.orderId,
    deliveryId: delivery.id,
    enabled: live,
  });
  const statusQuery = useTrackingStatus(
    delivery.id,
    live && Boolean(delivery.id)
  );
  const geo = (trackingQuery.data ?? statusQuery.data)?.geofence;
  const gate = tripGeofenceState(
    status,
    geo,
    resolveTripStep(delivery)
  );
  return (
    <TripLifecycleBar
      delivery={delivery}
      geoBlocked={gate.blocked}
      geoHint={gate.hint}
    />
  );
}

/**
 * Swiggy/Zomato-style stop actions after accept: restaurant wait/pickup,
 * on-the-way, drop OTP/POD/signature/deliver, plus cancel + report issue.
 */
export function TripLifecycleBar({
  delivery,
  geoBlocked,
  geoHint,
  hideCallActions = false,
}: Props) {
  const mutations = useDeliveryOrderMutations();
  const status = normalizeDeliveryStatus(delivery.status);
  const step = resolveTripStep(delivery);
  const atRestaurant = status === 'arrived';
  const atDrop = status === 'at_customer';
  const postAccept = status !== 'assigned';
  const canCancel =
    delivery.canCancel !== false &&
    postAccept &&
    status !== 'returning_to_restaurant';
  const canIssue = delivery.canReportIssue !== false && postAccept;
  const settledUpi = (delivery.settledVia ?? '').toLowerCase() === 'upi';
  const showCodUpi =
    isCodPayment(delivery.paymentMethod) &&
    (status === 'picked_up' ||
      status === 'out_for_delivery' ||
      status === 'at_customer') &&
    !settledUpi &&
    !delivery.cashCollected;

  const [sheet, setSheet] = useState<SheetKey>(null);
  const [showUpi, setShowUpi] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [checklistOk, setChecklistOk] = useState(true);
  const [pickupPhotoUri, setPickupPhotoUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [cancelCode, setCancelCode] = useState<CancelReasonCode>(
    'vehicle_breakdown'
  );
  const [issueCode, setIssueCode] = useState<TripIssueCode>(
    'customer_unreachable'
  );
  const [rtoChannel, setRtoChannel] = useState<UnreachableChannel>('call');
  const [returnCode, setReturnCode] = useState<ReturnReasonCode>(
    'customer_unreachable'
  );
  const [failCode, setFailCode] = useState<FailReasonCode>(
    'restaurant_closed'
  );
  const [, setRtoTick] = useState(0);

  const mutating =
    mutations.arrived.isPending ||
    mutations.orderNotReady.isPending ||
    mutations.waiting.isPending ||
    mutations.orderReady.isPending ||
    mutations.pickupVerify.isPending ||
    mutations.pickup.isPending ||
    mutations.onTheWay.isPending ||
    mutations.reachedCustomer.isPending ||
    mutations.verifyOtp.isPending ||
    mutations.captureSignature.isPending ||
    mutations.uploadPod.isPending ||
    mutations.deliver.isPending ||
    mutations.cancelTrip.isPending ||
    mutations.reportIssue.isPending ||
    mutations.customerUnreachable.isPending ||
    mutations.returnToRestaurant.isPending ||
    mutations.completeReturn.isPending ||
    mutations.failTrip.isPending ||
    mutations.callCustomer.isPending ||
    mutations.callRestaurant.isPending;

  const disabled = mutating || Boolean(busy);
  const rtoStep =
    status === 'returning_to_restaurant' ||
    step === 'return_store' ||
    step === 'complete_return';

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
    setBusy(label);
    try {
      return await fn();
    } catch (error) {
      const code = getApiErrorCode(error);
      const rtoError =
        rtoStep ||
        (code != null &&
          (code.startsWith('RTO_') ||
            code === 'RETURN_HANDOVER_REQUIRED' ||
            code === 'RIDER_NOT_ARRIVED_FOR_RETURN' ||
            (code === 'GEOFENCE_NOT_MET' &&
              status === 'returning_to_restaurant')));
      Alert.alert(
        'Could not complete',
        rtoError
          ? formatRtoError(error, rtoRemainingSeconds(delivery))
          : formatTripError(error, label)
      );
      throw error;
    } finally {
      setBusy(null);
    }
  };

  const onArrived = () =>
    void run(
      status === 'returning_to_restaurant'
        ? 'Confirming you’re back at the restaurant…'
        : 'Marking arrived…',
      () => mutations.arrived.mutateAsync(delivery.id)
    )
      .then((next) => {
        const nextStatus = normalizeDeliveryStatus(next.status);
        const nextStep = resolveTripStep(next);
        if (
          nextStatus === 'returning_to_restaurant' ||
          nextStep === 'complete_return' ||
          next.nextAction === 'await_return_handover'
        ) {
          setOtp('');
          setSheet('return_otp');
          return;
        }
        setOtp('');
        setChecklistOk(true);
        setPickupPhotoUri(null);
        setSheet('pickup');
      })
      .catch(() => undefined);

  const onNotReady = () =>
    void run('Flagging kitchen wait…', () =>
      mutations.orderNotReady.mutateAsync(delivery.id)
    ).catch(() => undefined);

  const onWaiting = () =>
    void run('Marking waiting…', () =>
      mutations.waiting.mutateAsync(delivery.id)
    ).catch(() => undefined);

  const onReady = () =>
    void run('Confirming kitchen ready…', () =>
      mutations.orderReady.mutateAsync(delivery.id)
    ).catch(() => undefined);

  const onTheWay = () =>
    void run('Starting trip to customer…', () =>
      mutations.onTheWay.mutateAsync(delivery.id)
    ).catch(() => undefined);

  const onReached = () =>
    void run('Marking arrived at customer…', () =>
      mutations.reachedCustomer.mutateAsync(delivery.id)
    )
      .then(() => {
        setOtp('');
        setSheet('otp');
      })
      .catch(() => undefined);

  const submitPickup = async () => {
    const code = otp.trim();
    if (!code && !checklistOk && !pickupPhotoUri?.startsWith('http')) {
      Alert.alert(
        'Pickup check',
        'Enter the kitchen OTP, tick all items collected, or add a hosted pickup photo.'
      );
      return;
    }
    setBusy('Verifying pickup…');
    try {
      await mutations.pickupVerify.mutateAsync({
        deliveryId: delivery.id,
        payload: {
          otp: code || undefined,
          itemChecklistOk: checklistOk,
          photoUrl: pickupPhotoUri?.startsWith('http')
            ? pickupPhotoUri
            : undefined,
        },
      });
      setBusy('Picking up…');
      await mutations.pickup.mutateAsync({
        deliveryId: delivery.id,
        otp: code || undefined,
        photoUrl: pickupPhotoUri?.startsWith('http')
          ? pickupPhotoUri
          : undefined,
      });
      setBusy('Heading to customer…');
      try {
        await mutations.onTheWay.mutateAsync(delivery.id);
      } catch {
        // Pickup often already sets OFD; this call is idempotent then.
      }
      setSheet(null);
      setOtp('');
      setPickupPhotoUri(null);
    } catch (error) {
      Alert.alert(
        'Could not pick up',
        formatTripError(
          error,
          'Enter the kitchen OTP or confirm the item checklist.'
        )
      );
    } finally {
      setBusy(null);
    }
  };

  const submitOtp = async () => {
    const code = otp.trim();
    if (code.length < 4) {
      Alert.alert('OTP required', 'Enter the 4-digit customer OTP.');
      return;
    }
    try {
      await run('Verifying OTP…', () =>
        mutations.verifyOtp.mutateAsync({ deliveryId: delivery.id, otp: code })
      );
      setSheet(null);
      setOtp('');
    } catch {
      // alerted in run()
    }
  };

  const submitDeliver = async () => {
    const code = otp.trim();
    if (
      !code &&
      !delivery.otpVerified &&
      !delivery.proofPhotoUrl &&
      !delivery.signatureUrl
    ) {
      Alert.alert(
        'Proof required',
        'Verify OTP, add a proof photo, or capture a signature first.'
      );
      return;
    }
    try {
      await run('Completing delivery…', () =>
        mutations.deliver.mutateAsync({
          deliveryId: delivery.id,
          payload: {
            otp: code || undefined,
            proofUrl: delivery.proofPhotoUrl,
            signatureUrl: delivery.signatureUrl,
          },
        })
      );
      setSheet(null);
      setOtp('');
      Alert.alert('Delivered', 'Order marked as delivered.');
    } catch {
      // alerted
    }
  };

  const submitCancel = async () => {
    try {
      await run('Cancelling trip…', () =>
        mutations.cancelTrip.mutateAsync({
          deliveryId: delivery.id,
          payload: {
            reasonCode: cancelCode,
            reason: note.trim() || undefined,
          },
        })
      );
      setSheet(null);
      setNote('');
    } catch {
      // alerted
    }
  };

  const submitIssue = async () => {
    try {
      await run('Reporting issue…', () =>
        mutations.reportIssue.mutateAsync({
          deliveryId: delivery.id,
          payload: {
            issueCode,
            note: note.trim() || undefined,
          },
        })
      );
      setSheet(null);
      setNote('');
      Alert.alert('Issue reported', 'Dispatch can see this on the trip.');
    } catch {
      // alerted
    }
  };

  const capturePod = async (fromCamera: boolean) => {
    const uri = await pickImage(fromCamera);
    if (!uri) return;
    void run('Uploading proof photo…', () =>
      mutations.uploadPod.mutateAsync({
        deliveryId: delivery.id,
        photoUri: uri,
      })
    ).catch(() => undefined);
  };

  const captureSign = async (fromCamera: boolean) => {
    const uri = await pickImage(fromCamera);
    if (!uri) return;
    void run('Uploading signature…', () =>
      mutations.captureSignature.mutateAsync({
        deliveryId: delivery.id,
        uri,
      })
    ).catch(() => undefined);
  };

  const submitUnreachable = async () => {
    try {
      const next = await run('Logging customer wait…', () =>
        mutations.customerUnreachable.mutateAsync({
          deliveryId: delivery.id,
          payload: {
            channel: rtoChannel,
            note: note.trim() || undefined,
          },
        })
      );
      setSheet(null);
      setNote('');
      const attempts = next.contactAttemptCount ?? 1;
      Alert.alert(
        attempts >= 2 ? '5-minute wait started' : 'Attempt logged',
        attempts >= 2
          ? 'If no one comes down, you can return the order after the timer.'
          : 'Try calling or chatting once more if they still don’t answer.'
      );
    } catch {
      // alerted
    }
  };

  const submitReturn = async () => {
    try {
      await run('Starting return…', () =>
        mutations.returnToRestaurant.mutateAsync({
          deliveryId: delivery.id,
          payload: {
            reasonCode: returnCode,
            reason: note.trim() || undefined,
          },
        })
      );
      setSheet(null);
      setNote('');
      const fee = delivery.rtoFee;
      Alert.alert(
        'Returning to restaurant',
        fee && fee > 0
          ? `Take the food back to the restaurant. Do not collect cash. You’ll earn ₹${Math.round(fee)} for returning this order.`
          : 'Take the food back to the restaurant. Do not collect cash.'
      );
    } catch {
      // alerted
    }
  };

  const submitCompleteReturn = async () => {
    const code = otp.trim();
    if (!/^\d{4}$/.test(code)) {
      Alert.alert('OTP required', 'Enter the 4-digit kitchen return OTP.');
      return;
    }
    try {
      await run('Handing order back to kitchen…', () =>
        mutations.completeReturn.mutateAsync({
          deliveryId: delivery.id,
          payload: { method: 'otp', otp: code },
        })
      );
      setSheet(null);
      setOtp('');
    } catch {
      // alerted — keep OTP so they can retry
    }
  };

  const submitFail = async () => {
    if (failCode === 'other' && !note.trim()) {
      Alert.alert('Note required', 'Add a short note when the reason is Other.');
      return;
    }
    try {
      await run('Marking failed…', () =>
        mutations.failTrip.mutateAsync({
          deliveryId: delivery.id,
          payload: {
            reasonCode: failCode,
            reason: note.trim() || undefined,
          },
        })
      );
      setSheet(null);
      setNote('');
      Alert.alert(
        'Trip failed',
        'This delivery is closed and will not pay a trip earning. Duty is restored.'
      );
    } catch {
      // alerted
    }
  };

  const announceCall = (
    result: {
      toMasked?: string;
      virtualNumberMasked?: string;
      target: string;
    },
    who: string
  ) => {
    const dest = result.toMasked ? ` ${result.toMasked}` : '';
    const via = result.virtualNumberMasked
      ? ` via ${result.virtualNumberMasked}`
      : '';
    Alert.alert(
      `Calling ${who}`,
      `Masked number${dest}${via}. Your phone should ring — numbers stay hidden.`
    );
  };

  const onCallCustomer = () =>
    void run('Calling customer…', async () => {
      const result = await mutations.callCustomer.mutateAsync(delivery.id);
      announceCall(result, 'customer');
    }).catch(() => undefined);

  const onCallRestaurant = () =>
    void run('Calling restaurant…', async () => {
      const result = await mutations.callRestaurant.mutateAsync(delivery.id);
      announceCall(result, 'restaurant');
    }).catch(() => undefined);

  const rtoLeft = rtoRemainingSeconds(delivery);
  useEffect(() => {
    if (rtoLeft == null) return;
    const timer = setInterval(() => setRtoTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [delivery.rtoTimerEndsAt, rtoLeft]);

  const waitingLabel = waitCopy(delivery);
  const primaryDisabled = disabled || Boolean(geoBlocked);
  const showOnTheWay =
    status === 'picked_up' ||
    (step === 'on_the_way' && status !== 'out_for_delivery' && !atDrop);
  const showArriveCustomer =
    (status === 'out_for_delivery' || step === 'reached_customer') &&
    status !== 'picked_up' &&
    !atDrop;

  if (
    status === 'assigned' ||
    status === 'delivered' ||
    status === 'cancelled' ||
    status === 'rejected' ||
    status === 'reassigned' ||
    status === 'failed' ||
    status === 'returned'
  ) {
    return null;
  }

  return (
    <View style={{ gap: 8 }}>
      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator color="#EA4B14" size="small" />
          <Text style={styles.busyText}>{busy}</Text>
        </View>
      ) : null}

      {geoBlocked && geoHint ? (
        <Text style={styles.geoHint}>{geoHint}</Text>
      ) : null}

      {waitingLabel ? <Text style={styles.waitText}>{waitingLabel}</Text> : null}

      {step === 'arrived' ? (
        <Pressable
          onPress={onArrived}
          disabled={primaryDisabled}
          style={[styles.primary, primaryDisabled && styles.disabled]}
        >
          <Text style={styles.primaryText}>Arrived at restaurant</Text>
        </Pressable>
      ) : null}

      {atRestaurant ? (
        <View style={styles.group}>
          <Pressable
            onPress={onNotReady}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Order not ready</Text>
          </Pressable>
          <Pressable
            onPress={onWaiting}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Waiting at store</Text>
          </Pressable>
          <Pressable
            onPress={onReady}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>
              {delivery.kitchenReadyAt ? 'Kitchen ready ✓' : 'Kitchen ready'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setOtp('');
              setChecklistOk(true);
              setSheet('pickup');
            }}
            disabled={primaryDisabled}
            style={[styles.primary, primaryDisabled && styles.disabled]}
          >
            <Text style={styles.primaryText}>
              {delivery.pickupVerified ? 'Pick up order' : 'Verify & pick up'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showOnTheWay ? (
        <Pressable
          onPress={onTheWay}
          disabled={disabled}
          style={[styles.primary, disabled && styles.disabled]}
        >
          <Text style={styles.primaryText}>On the way to customer</Text>
        </Pressable>
      ) : null}

      {showArriveCustomer ? (
        <Pressable
          onPress={onReached}
          disabled={primaryDisabled}
          style={[styles.primary, primaryDisabled && styles.disabled]}
        >
          <Text style={styles.primaryText}>Arrived at customer</Text>
        </Pressable>
      ) : null}

      {atDrop ? (
        <View style={styles.group}>
          <Text style={styles.proofMeta}>
            {[
              delivery.otpVerified ? 'OTP verified' : 'OTP pending',
              delivery.proofPhotoUrl ? 'Photo added' : 'No photo',
              delivery.signatureUrl ? 'Signature added' : 'No signature',
              isCodPayment(delivery.paymentMethod)
                ? settledUpi
                  ? 'COD settled UPI'
                  : 'COD — collect cash or UPI'
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {showCodUpi ? (
            <Pressable
              onPress={() => setShowUpi(true)}
              disabled={disabled}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Collect UPI (platform QR)</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => {
              setOtp('');
              setSheet('otp');
            }}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>
              {delivery.otpVerified ? 'OTP verified ✓' : 'Verify drop OTP'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void capturePod(true)}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>
              {delivery.proofPhotoUrl ? 'Proof photo ✓' : 'Take proof photo'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void capturePod(false)}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Choose proof from gallery</Text>
          </Pressable>
          <Pressable
            onPress={() => void captureSign(true)}
            disabled={primaryDisabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>
              {delivery.signatureUrl
                ? 'Signature captured ✓'
                : 'Capture signature'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void captureSign(false)}
            disabled={primaryDisabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Choose signature photo</Text>
          </Pressable>
          {status === 'at_customer' || step === 'deliver' ? (
            <Pressable
              onPress={() => {
                setOtp('');
                setSheet('deliver');
              }}
              disabled={primaryDisabled}
              style={[styles.primary, primaryDisabled && styles.disabled]}
            >
              <Text style={styles.primaryText}>Mark delivered</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {status === 'picked_up' ||
      status === 'out_for_delivery' ||
      status === 'at_customer' ? (
        <View style={styles.group}>
          {showCodUpi && status !== 'at_customer' ? (
            <Pressable
              onPress={() => setShowUpi(true)}
              disabled={disabled}
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Collect COD via UPI</Text>
            </Pressable>
          ) : null}
          {delivery.contactAttemptCount ? (
            <Text style={styles.waitText}>
              Customer contact {delivery.contactAttemptCount}×
              {rtoLeft != null
                ? rtoLeft > 0
                  ? ` · Return in ${formatClock(rtoLeft)}`
                  : ' · Timer done'
                : ''}
            </Text>
          ) : null}
          <Pressable
            onPress={() => {
              setNote('');
              setRtoChannel('call');
              setSheet('rto');
            }}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Customer not answering</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setNote('');
              setReturnCode('customer_refused');
              setSheet('return');
            }}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>Customer refused</Text>
          </Pressable>
          {delivery.canReturnToRestaurant ? (
            <Pressable
              onPress={() => {
                setNote('');
                setReturnCode('customer_unreachable');
                setSheet('return');
              }}
              disabled={disabled}
              style={[styles.primary, disabled && styles.disabled]}
            >
              <Text style={styles.primaryText}>Return to restaurant</Text>
            </Pressable>
          ) : rtoLeft != null && rtoLeft > 0 ? (
            <Text style={styles.waitText}>
              Wait {formatClock(rtoLeft)} before returning.
            </Text>
          ) : null}
        </View>
      ) : null}

      {status === 'returning_to_restaurant' ? (
        <View style={styles.group}>
          <Text style={styles.waitText}>
            Take the food back to the restaurant. Do not collect cash.
          </Text>
          {delivery.rtoFee && delivery.rtoFee > 0 ? (
            <Text style={styles.waitText}>
              You’ll earn ₹{Math.round(delivery.rtoFee)} for returning this
              order.
            </Text>
          ) : null}
          {step === 'return_store' ? (
            <Pressable
              onPress={onArrived}
              disabled={primaryDisabled}
              style={[styles.primary, primaryDisabled && styles.disabled]}
            >
              <Text style={styles.primaryText}>
                I’ve arrived at the restaurant
              </Text>
            </Pressable>
          ) : null}
          {step === 'complete_return' ? (
            <>
              <Text style={styles.waitText}>
                Ask kitchen for the return OTP, or wait if they tap Receive.
              </Text>
              <TextInput
                value={otp}
                onChangeText={setOtp}
                placeholder="Kitchen return OTP"
                placeholderTextColor="#9CA3AF"
                keyboardType="number-pad"
                style={styles.input}
                maxLength={4}
              />
              <Pressable
                onPress={() => void submitCompleteReturn()}
                disabled={disabled}
                style={[styles.primary, disabled && styles.disabled]}
              >
                <Text style={styles.primaryText}>Confirm return OTP</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={() => {
              setNote('');
              setFailCode('restaurant_closed');
              setSheet('fail');
            }}
            disabled={disabled}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>
              Restaurant closed — won’t take bag
            </Text>
          </Pressable>
        </View>
      ) : null}

      {postAccept && !hideCallActions ? (
        <View style={styles.moreRow}>
          <Pressable
            onPress={onCallCustomer}
            disabled={disabled}
            style={styles.moreBtn}
          >
            <Text style={styles.moreText}>Call customer</Text>
          </Pressable>
          <Pressable
            onPress={onCallRestaurant}
            disabled={disabled}
            style={styles.moreBtn}
          >
            <Text style={styles.moreText}>Call restaurant</Text>
          </Pressable>
        </View>
      ) : null}

      {postAccept ? (
        <View style={styles.moreRow}>
          {canIssue ? (
            <Pressable
              onPress={() => {
                setNote('');
                setSheet('issue');
              }}
              disabled={disabled}
              style={styles.moreBtn}
            >
              <Text style={styles.moreText}>Report issue</Text>
            </Pressable>
          ) : null}
          {canCancel ? (
            <Pressable
              onPress={() => {
                setNote('');
                setSheet('cancel');
              }}
              disabled={disabled}
              style={styles.moreBtn}
            >
              <Text style={styles.moreDanger}>Cancel trip</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <Modal
        visible={sheet === 'pickup'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Verify & pick up</Text>
              <Pressable onPress={() => setSheet(null)} hitSlop={8}>
                <X color="#6B7280" size={20} />
              </Pressable>
            </View>
            <Text style={styles.sub}>
              Kitchen OTP, item checklist, or a pickup photo — same as Swiggy /
              Zomato pickup.
            </Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="Kitchen OTP (if asked)"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={styles.input}
              maxLength={8}
              autoFocus
            />
            <Pressable
              onPress={() => setChecklistOk((v) => !v)}
              style={styles.checkRow}
            >
              <View
                style={[styles.check, checklistOk && styles.checkOn]}
              />
              <Text style={styles.checkLabel}>All items collected</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void pickImage(true).then((uri) => {
                  if (uri) setPickupPhotoUri(uri);
                })
              }
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>
                {pickupPhotoUri ? 'Pickup photo added ✓' : 'Add pickup photo'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void pickImage(false).then((uri) => {
                  if (uri) setPickupPhotoUri(uri);
                })
              }
              style={styles.secondary}
            >
              <Text style={styles.secondaryText}>Choose pickup photo</Text>
            </Pressable>
            <Pressable
              onPress={() => void submitPickup()}
              disabled={disabled}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>Pick up order</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={sheet === 'otp' || sheet === 'deliver'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {sheet === 'otp' ? 'Verify customer OTP' : 'Complete delivery'}
              </Text>
              <Pressable onPress={() => setSheet(null)} hitSlop={8}>
                <X color="#6B7280" size={20} />
              </Pressable>
            </View>
            <Text style={styles.sub}>
              {sheet === 'otp'
                ? 'This checks the OTP without finishing the trip. Then add photo or signature and mark delivered.'
                : 'Need OTP, a proof photo, or a signature. Photo and signature upload first, then this completes the trip.'}
            </Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="Customer OTP"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={styles.input}
              maxLength={8}
              autoFocus={sheet === 'otp'}
            />
            {sheet === 'deliver' ? (
              <>
                <Pressable
                  onPress={() => void capturePod(false)}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>
                    {delivery.proofPhotoUrl
                      ? 'Proof photo added ✓'
                      : 'Choose proof from gallery'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => void captureSign(false)}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>
                    {delivery.signatureUrl
                      ? 'Signature added ✓'
                      : 'Choose signature photo'}
                  </Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={() =>
                void (sheet === 'otp' ? submitOtp() : submitDeliver())
              }
              disabled={disabled}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>
                {sheet === 'otp' ? 'Verify OTP' : 'Mark delivered'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={sheet === 'return_otp'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Show this to kitchen</Text>
              <Pressable onPress={() => setSheet(null)} hitSlop={8}>
                <X color="#6B7280" size={20} />
              </Pressable>
            </View>
            <Text style={styles.sub}>
              Ask kitchen for the return OTP, or wait if they tap Receive. This
              is not the customer drop OTP.
            </Text>
            <TextInput
              value={otp}
              onChangeText={setOtp}
              placeholder="4-digit kitchen return OTP"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={styles.input}
              maxLength={4}
              autoFocus
            />
            <Pressable
              onPress={() => void submitCompleteReturn()}
              disabled={disabled}
              style={[styles.primary, disabled && styles.disabled]}
            >
              <Text style={styles.primaryText}>Confirm return OTP</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={sheet === 'cancel' || sheet === 'issue'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {sheet === 'cancel' ? 'Cancel trip' : 'Report issue'}
              </Text>
              <Pressable onPress={() => setSheet(null)} hitSlop={8}>
                <X color="#6B7280" size={20} />
              </Pressable>
            </View>
            <Text style={styles.sub}>
              {sheet === 'cancel'
                ? 'Pre-pickup rider reasons reassign the order. After pickup this cancels the trip.'
                : 'This does not change trip status. Dispatch sees it on the timeline.'}
            </Text>
            <View style={styles.chips}>
              {(sheet === 'cancel' ? CANCEL_REASON_CODES : TRIP_ISSUE_CODES).map(
                (row) => {
                  const selected =
                    sheet === 'cancel'
                      ? cancelCode === row.code
                      : issueCode === row.code;
                  return (
                    <Pressable
                      key={row.code}
                      onPress={() => {
                        if (sheet === 'cancel') {
                          setCancelCode(row.code as CancelReasonCode);
                        } else {
                          setIssueCode(row.code as TripIssueCode);
                        }
                      }}
                      style={[styles.chip, selected && styles.chipOn]}
                    >
                      <Text
                        style={[styles.chipText, selected && styles.chipTextOn]}
                      >
                        {row.label}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={sheet === 'cancel' ? 'Optional note' : 'Optional note'}
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              multiline
            />
            <Pressable
              onPress={() =>
                void (sheet === 'cancel' ? submitCancel() : submitIssue())
              }
              disabled={disabled}
              style={sheet === 'cancel' ? styles.danger : styles.primary}
            >
              <Text style={styles.primaryText}>
                {sheet === 'cancel' ? 'Confirm cancel' : 'Submit issue'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={sheet === 'rto' || sheet === 'return' || sheet === 'fail'}
        transparent
        animationType="fade"
        onRequestClose={() => setSheet(null)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {sheet === 'rto'
                  ? 'Customer not answering'
                  : sheet === 'return'
                    ? 'Return to restaurant'
                    : 'Mark delivery failed'}
              </Text>
              <Pressable onPress={() => setSheet(null)} hitSlop={8}>
                <X color="#6B7280" size={20} />
              </Pressable>
            </View>
            <Text style={styles.sub}>
              {sheet === 'rto'
                ? 'Attempt 2 starts a 5-minute wait. Then you can return the order.'
                : sheet === 'return'
                  ? 'Customer refused returns immediately. Other reasons need two contact attempts and the timer.'
                  : 'Only if the restaurant will not take the bag. There is no RTO fee on failed.'}
            </Text>
            {sheet === 'rto' ? (
              <View style={styles.chips}>
                {(['call', 'chat'] as const).map((channel) => (
                  <Pressable
                    key={channel}
                    onPress={() => setRtoChannel(channel)}
                    style={[
                      styles.chip,
                      rtoChannel === channel && styles.chipOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        rtoChannel === channel && styles.chipTextOn,
                      ]}
                    >
                      {channel === 'call' ? 'After a call' : 'After chat'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.chips}>
                {(sheet === 'return'
                  ? RETURN_REASON_CODES
                  : FAIL_REASON_CODES.filter((row) =>
                      status === 'returning_to_restaurant'
                        ? row.code === 'restaurant_closed'
                        : true
                    )
                ).map(
                  (row) => {
                    const selected =
                      sheet === 'return'
                        ? returnCode === row.code
                        : failCode === row.code;
                    return (
                      <Pressable
                        key={row.code}
                        onPress={() => {
                          if (sheet === 'return') {
                            setReturnCode(row.code as ReturnReasonCode);
                          } else {
                            setFailCode(row.code as FailReasonCode);
                          }
                        }}
                        style={[styles.chip, selected && styles.chipOn]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            selected && styles.chipTextOn,
                          ]}
                        >
                          {row.label}
                        </Text>
                      </Pressable>
                    );
                  }
                )}
              </View>
            )}
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Optional note"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              multiline
            />
            <Pressable
              onPress={() =>
                void (sheet === 'rto'
                  ? submitUnreachable()
                  : sheet === 'return'
                    ? submitReturn()
                    : submitFail())
              }
              disabled={disabled}
              style={sheet === 'fail' ? styles.danger : styles.primary}
            >
              <Text style={styles.primaryText}>
                {sheet === 'rto'
                  ? 'Log unreachable'
                  : sheet === 'return'
                    ? 'Start return'
                    : 'Mark failed'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <CodUpiSheet
        visible={showUpi}
        deliveryId={delivery.id}
        onClose={() => setShowUpi(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  busyText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  geoHint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#B45309',
  },
  waitText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#C2410C',
  },
  group: {
    gap: 8,
  },
  proofMeta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  primary: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: fonts.extraBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  secondary: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: '#111827',
  },
  disabled: {
    opacity: 0.5,
  },
  moreRow: {
    flexDirection: 'row',
    gap: 8,
  },
  moreBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#374151',
  },
  moreDanger: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#B91C1C',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 18,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fonts.extraBold,
    fontSize: 18,
    color: '#111827',
  },
  sub: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: '#111827',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  check: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
  },
  checkOn: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  checkLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#111827',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipOn: {
    backgroundColor: '#111827',
  },
  chipText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#4B5563',
  },
  chipTextOn: {
    color: '#FFFFFF',
  },
  danger: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
