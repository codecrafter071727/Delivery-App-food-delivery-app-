import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import {
  IncomingOfferCard,
  showOfferError,
} from '@/components/delivery/orders/IncomingOfferCard';
import { incomingOfferStyles as styles } from '@/components/delivery/orders/incoming-offer-styles';
import {
  remainingSeconds,
  resolveOfferTripMetrics,
  shouldClearOffer,
} from '@/components/delivery/orders/offer-overlay-helpers';
import {
  useDeliveryBatch,
  useDeliveryOrderMutations,
} from '@/lib/delivery-partner/hooks';
import { partnerLocationTracker } from '@/lib/delivery-partner/location-tracker';
import {
  clearIncomingOffer,
  getIncomingOffer,
  markOfferDeclined,
  subscribeIncomingOffer,
  type IncomingOffer,
} from '@/lib/delivery-partner/offer-store';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';
import { toRejectReasonCode } from '@/lib/delivery-partner/rider-gateway-types';
import { useLastLocation } from '@/lib/delivery-partner/tracking-hooks';
import { useResolvedTripStops } from '@/lib/delivery-partner/trip-stops';
import type { PartnerDelivery } from '@/lib/delivery-partner/types';

export function IncomingOfferOverlay() {
  const mutations = useDeliveryOrderMutations();
  const lastLocation = useLastLocation(true);
  const [offer, setOffer] = useState<IncomingOffer | null>(getIncomingOffer);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [liveCoords, setLiveCoords] = useState(
    () => partnerLocationTracker.getSnapshot().coords
  );
  const [locating, setLocating] = useState(false);

  useEffect(() => subscribeIncomingOffer(setOffer), []);
  useEffect(() => {
    return partnerLocationTracker.subscribeSnapshot((snap) => {
      if (snap.coords) setLiveCoords(snap.coords);
    });
  }, []);

  /** On each new offer: capture fresh device GPS for You → Restaurant km. */
  useEffect(() => {
    if (!offer?.deliveryId) return;
    let cancelled = false;
    setLocating(true);
    void partnerLocationTracker
      .captureLiveLocation()
      .then((coords) => {
        if (cancelled) return;
        if (coords) setLiveCoords(coords);
      })
      .finally(() => {
        if (!cancelled) setLocating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [offer?.deliveryId]);

  useEffect(() => {
    if (!offer) {
      setBusy(null);
      return;
    }
    const tick = () => {
      const left = remainingSeconds(offer);
      setSeconds(left);
      if (left <= 0) clearIncomingOffer(offer.deliveryId);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [offer]);

  const batchQuery = useDeliveryBatch(offer?.batchId, {
    enabled: Boolean(offer?.batchId),
    live: true,
  });
  const batch = batchQuery.data;
  const stacked =
    Boolean(offer?.batchId) &&
    ((batch?.deliveries.length ?? 0) > 1 ||
      offer?.nextAction === 'accept_batch');
  const stackCount = Math.max(
    batch?.deliveries.length ?? 0,
    batch?.deliveryIds.length ?? 0,
    stacked ? 2 : 1
  );
  const stackEarnings = useMemo(() => {
    if (!stacked || !batch?.deliveries.length) return null;
    const base = batch.deliveries.reduce(
      (sum, row) => sum + (row.partnerEarnings ?? row.deliveryFee ?? 0),
      0
    );
    const incentive = batch.deliveries.reduce(
      (sum, row) => sum + (row.incentiveBonus ?? 0),
      0
    );
    return {
      basePay: base,
      incentive,
      netTotal: base + incentive,
      showIncentive: incentive > 0,
    };
  }, [stacked, batch?.deliveries]);

  const offerAsDelivery = useMemo<PartnerDelivery>(
    () =>
      offer
        ? {
            id: offer.deliveryId,
            orderId: offer.orderId,
            restaurantId: offer.restaurantId,
            status: 'assigned',
            restaurantName: offer.restaurantName,
            partnerEarnings: offer.partnerEarnings,
            incentiveBonus: offer.incentiveBonus,
            restaurantAddress: {
              lat: offer.restaurantLat,
              lng: offer.restaurantLng,
              line1: offer.pickupLabel,
            },
            deliveryAddress: {
              lat: offer.dropLat,
              lng: offer.dropLng,
              line1: offer.dropLabel,
            },
            distanceKm: offer.dropDistanceKm ?? offer.estimatedKm,
            earning: offer.partnerEarnings ?? offer.deliveryFee,
          }
        : { id: '', status: 'assigned' },
    [offer]
  );
  const stops = useResolvedTripStops(offerAsDelivery);

  const riderLat = liveCoords?.latitude ?? lastLocation.data?.latitude;
  const riderLng = liveCoords?.longitude ?? lastLocation.data?.longitude;
  const trip = useMemo(
    () => (offer ? resolveOfferTripMetrics(offer, riderLat, riderLng) : null),
    [offer, riderLat, riderLng]
  );
  const progress = useMemo(() => {
    if (!offer) return 0;
    return Math.min(1, seconds / Math.max(1, offer.timeoutSeconds));
  }, [offer, seconds]);

  if (!offer) return null;

  const urgent = seconds <= 10 || offer.expiring;
  const pickup =
    offer.restaurantLat != null &&
    offer.restaurantLng != null &&
    Number.isFinite(offer.restaurantLat) &&
    Number.isFinite(offer.restaurantLng)
      ? { latitude: offer.restaurantLat, longitude: offer.restaurantLng }
      : null;
  const drop =
    offer.dropLat != null &&
    offer.dropLng != null &&
    Number.isFinite(offer.dropLat) &&
    Number.isFinite(offer.dropLng)
      ? { latitude: offer.dropLat, longitude: offer.dropLng }
      : null;
  const youPin =
    riderLat != null && riderLng != null
      ? { latitude: riderLat, longitude: riderLng }
      : null;
  const mapCenter = pickup ?? drop ?? youPin;
  const showMap = Platform.OS !== 'web' && Boolean(mapCenter);

  const accept = async () => {
    setBusy('accept');
    try {
      if (offer.batchId && (batch?.canAccept || stacked)) {
        await mutations.acceptBatch.mutateAsync(offer.batchId);
      } else {
        await mutations.accept.mutateAsync(offer.deliveryId);
      }
      clearIncomingOffer(offer.deliveryId);
    } catch (error) {
      showOfferError(
        'Could not accept',
        formatTripError(error, 'This order is no longer available.')
      );
      if (shouldClearOffer(error)) clearIncomingOffer(offer.deliveryId);
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy('reject');
    try {
      await mutations.reject.mutateAsync({
        deliveryId: offer.deliveryId,
        reason: 'Declined offer',
        reasonCode: toRejectReasonCode('too_far'),
      });
      markOfferDeclined(offer.deliveryId, offer.orderId);
      clearIncomingOffer(offer.deliveryId);
    } catch (error) {
      showOfferError(
        'Could not decline',
        formatTripError(error, 'Please try again.')
      );
      if (shouldClearOffer(error)) clearIncomingOffer(offer.deliveryId);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible animationType="fade" transparent statusBarTranslucent>
      <View style={styles.screen}>
        {showMap && mapCenter ? (
          <MapView
            style={StyleSheet.absoluteFill}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={{
              ...mapCenter,
              latitudeDelta: 0.06,
              longitudeDelta: 0.06,
            }}
            pointerEvents="none"
            toolbarEnabled={false}
          >
            {youPin ? (
              <Marker coordinate={youPin} title="You" pinColor="#6366F1" />
            ) : null}
            {pickup ? (
              <Marker
                coordinate={pickup}
                title="Pickup"
                description={stops.restaurantName}
                pinColor="#EA4B14"
              />
            ) : null}
            {drop ? (
              <Marker
                coordinate={drop}
                title="Drop"
                description={stops.dropAddress || offer.dropLabel}
                pinColor="#2563EB"
              />
            ) : null}
          </MapView>
        ) : (
          <View style={styles.fallbackBg} />
        )}
        <View style={styles.scrim} />
        <IncomingOfferCard
          offer={offer}
          seconds={seconds}
          progress={progress}
          urgent={urgent}
          stacked={stacked}
          stackCount={stackCount}
          stackEarnings={stackEarnings}
          batch={batch}
          batchLoading={batchQuery.isLoading}
          restaurantName={stops.restaurantName}
          pickupAddress={stops.pickupAddress}
          pickupKm={trip?.pickupKm ?? null}
          pickupEtaMin={trip?.pickupEtaMin ?? null}
          dropAddress={stops.dropAddress || offer.dropLabel}
          dropKm={trip?.dropKm ?? stops.dropKm ?? null}
          dropEtaMin={trip?.dropEtaMin ?? null}
          totalEtaMin={trip?.totalEtaMin ?? null}
          showYouLeg={Boolean(youPin || locating)}
          locating={locating && !youPin}
          busy={busy}
          onAccept={() => void accept()}
          onDecline={() => void decline()}
        />
      </View>
    </Modal>
  );
}
