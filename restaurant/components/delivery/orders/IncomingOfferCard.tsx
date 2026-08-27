import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OfferPayoutHeader } from '@/components/delivery/orders/OfferPayoutHeader';
import { OfferRouteCard } from '@/components/delivery/orders/OfferRouteCard';
import { incomingOfferStyles as styles } from '@/components/delivery/orders/incoming-offer-styles';
import type { OfferEarnings } from '@/lib/delivery-partner/offer-earnings';
import type { IncomingOffer } from '@/lib/delivery-partner/offer-store';
import type { PartnerBatch } from '@/lib/delivery-partner/types';

type Props = {
  offer: IncomingOffer;
  seconds: number;
  progress: number;
  urgent: boolean;
  stacked: boolean;
  stackCount: number;
  stackEarnings: OfferEarnings | null;
  batch?: PartnerBatch | null;
  batchLoading: boolean;
  restaurantName: string;
  pickupAddress?: string;
  pickupKm?: number | null;
  pickupEtaMin?: number | null;
  dropAddress?: string;
  dropKm?: number | null;
  dropEtaMin?: number | null;
  totalEtaMin?: number | null;
  showYouLeg: boolean;
  locating?: boolean;
  roadLoading?: boolean;
  isRoadKm?: boolean;
  busy: 'accept' | 'reject' | null;
  onAccept: () => void;
  onDecline: () => void;
};

export function IncomingOfferCard({
  offer,
  seconds,
  progress,
  urgent,
  stacked,
  stackCount,
  stackEarnings,
  batch,
  batchLoading,
  restaurantName,
  pickupAddress,
  pickupKm,
  pickupEtaMin,
  dropAddress,
  dropKm,
  dropEtaMin,
  totalEtaMin,
  showYouLeg,
  locating,
  roadLoading,
  isRoadKm,
  busy,
  onAccept,
  onDecline,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.card, { marginBottom: Math.max(insets.bottom, 12) }]}
    >
      <View style={styles.timerRow}>
        <View style={styles.timerTrack}>
          <View
            style={[
              styles.timerFill,
              {
                width: `${Math.round(progress * 100)}%`,
                backgroundColor: urgent ? '#EF4444' : '#22C55E',
              },
            ]}
          />
        </View>
        <Text style={[styles.timerText, urgent && styles.timerUrgent]}>
          {seconds}s
        </Text>
      </View>

      <ScrollView
        style={styles.cardScroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {urgent ? (
          <View style={styles.expiringBanner}>
            <Text style={styles.expiringText}>
              Hurry — offer expires in {seconds}s
            </Text>
          </View>
        ) : null}

        <OfferPayoutHeader
          offer={offer}
          stacked={stacked}
          stackCount={stackCount}
          stackEarnings={stackEarnings}
        />

        {offer.batchId && batchLoading && !batch ? (
          <ActivityIndicator color="#EA4B14" style={{ marginVertical: 12 }} />
        ) : null}

        {!stacked ? (
          <OfferRouteCard
            showYouLeg={showYouLeg}
            youKm={pickupKm}
            locating={locating}
            roadLoading={roadLoading}
            isRoadKm={isRoadKm}
            restaurantName={restaurantName}
            pickupAddress={pickupAddress}
            pickupKm={pickupKm}
            pickupEtaMin={pickupEtaMin}
            dropAddress={dropAddress}
            dropKm={dropKm}
            dropEtaMin={dropEtaMin}
            totalEtaMin={totalEtaMin}
          />
        ) : (
          <OfferRouteCard
            restaurantName={`${stackCount} stacked orders`}
            dropAddress="See trip after accept"
            dropKm={batch?.estimatedDistanceKm ?? dropKm}
            dropEtaMin={dropEtaMin}
            totalEtaMin={totalEtaMin}
            roadLoading={roadLoading}
            isRoadKm={isRoadKm}
          />
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          onPress={onDecline}
          disabled={busy != null}
          style={styles.declineBtn}
        >
          {busy === 'reject' ? (
            <ActivityIndicator color="#111827" />
          ) : (
            <Text style={styles.declineText}>Decline</Text>
          )}
        </Pressable>
        <Pressable
          onPress={onAccept}
          disabled={busy != null}
          style={styles.acceptBtn}
        >
          {busy === 'accept' ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.acceptText}>
              {stacked ? `Accept all (${stackCount})` : 'Accept order'}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export function showOfferError(title: string, message: string) {
  Alert.alert(title, message);
}
