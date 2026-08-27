import { Text, View } from 'react-native';

import { incomingOfferStyles as styles } from '@/components/delivery/orders/incoming-offer-styles';
import {
  formatEtaMinutes,
  formatTripKm,
} from '@/lib/delivery-partner/offer-geo';

type Props = {
  restaurantName: string;
  pickupAddress?: string;
  pickupKm?: number | null;
  pickupEtaMin?: number | null;
  dropAddress?: string;
  dropKm?: number | null;
  dropEtaMin?: number | null;
  totalEtaMin?: number | null;
  showYouLeg?: boolean;
  youKm?: number | null;
  locating?: boolean;
  /** Measuring Google driving distance. */
  roadLoading?: boolean;
  /** Values are Google road km (not straight-line). */
  isRoadKm?: boolean;
};

function formatRoadKmLabel(
  km: number | null | undefined,
  etaMin: number | null | undefined,
  isRoadKm?: boolean
) {
  const kmLabel = formatTripKm(km);
  if (!kmLabel) return null;
  const prefix = isRoadKm ? `${kmLabel} road` : `~${kmLabel} approx`;
  const eta = formatEtaMinutes(etaMin);
  return eta ? `${prefix} · ${eta}` : prefix;
}

export function OfferRouteCard({
  restaurantName,
  pickupAddress,
  pickupKm,
  pickupEtaMin,
  dropAddress,
  dropKm,
  dropEtaMin,
  totalEtaMin,
  showYouLeg,
  youKm,
  locating,
  roadLoading,
  isRoadKm,
}: Props) {
  const youLabel = formatRoadKmLabel(youKm ?? pickupKm, pickupEtaMin, isRoadKm);
  const dropLabel = formatRoadKmLabel(dropKm, dropEtaMin, isRoadKm);
  const totalLabel = formatEtaMinutes(totalEtaMin);
  const measuring = Boolean(roadLoading || locating);

  return (
    <View style={styles.routeBlock}>
      {totalLabel ? (
        <View style={styles.etaBanner}>
          <Text style={styles.etaBannerLabel}>Trip ETA</Text>
          <Text style={styles.etaBannerValue}>{totalLabel}</Text>
        </View>
      ) : measuring ? (
        <View style={styles.etaBanner}>
          <Text style={styles.etaBannerLabel}>Trip ETA</Text>
          <Text style={styles.etaBannerMuted}>
            {locating && !youKm
              ? 'Getting your location…'
              : 'Measuring road distance…'}
          </Text>
        </View>
      ) : null}

      {showYouLeg ? (
        <View style={styles.pinBlock}>
          <View style={styles.pinDotYou} />
          <View style={styles.pinCopy}>
            <Text style={styles.pinLabel}>You → Restaurant</Text>
            {youLabel ? (
              <Text style={styles.pinKm}>{youLabel}</Text>
            ) : measuring ? (
              <Text style={styles.pinKmMuted}>Measuring road km…</Text>
            ) : null}
            <Text style={styles.pinValue}>Your live location</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.pinBlock}>
        <View style={styles.pinDotPickup} />
        <View style={styles.pinCopy}>
          <Text style={styles.pinLabel}>Pickup · Restaurant</Text>
          {!showYouLeg && youLabel ? (
            <Text style={styles.pinKm}>{youLabel} away</Text>
          ) : null}
          <Text style={styles.pinValue} numberOfLines={2}>
            {restaurantName}
          </Text>
          {pickupAddress ? (
            <Text style={styles.pinAddr} numberOfLines={2}>
              {pickupAddress}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.pinBlock}>
        <View style={styles.pinDotDrop} />
        <View style={styles.pinCopy}>
          <Text style={styles.pinLabel}>Drop · Customer</Text>
          {dropLabel ? (
            <Text style={styles.pinKm}>{dropLabel} from restaurant</Text>
          ) : measuring ? (
            <Text style={styles.pinKmMuted}>Measuring road km…</Text>
          ) : null}
          <Text style={styles.pinValue} numberOfLines={2}>
            {dropAddress || 'Customer address'}
          </Text>
        </View>
      </View>
    </View>
  );
}
