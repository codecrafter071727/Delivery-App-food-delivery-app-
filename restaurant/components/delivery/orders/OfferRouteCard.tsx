import { Text, View } from 'react-native';

import { incomingOfferStyles as styles } from '@/components/delivery/orders/incoming-offer-styles';
import {
  formatEtaMinutes,
  formatKmWithEta,
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
};

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
}: Props) {
  const youLabel = formatKmWithEta(youKm ?? pickupKm, pickupEtaMin);
  const dropLabel = formatKmWithEta(dropKm, dropEtaMin);
  const totalLabel = formatEtaMinutes(totalEtaMin);

  return (
    <View style={styles.routeBlock}>
      {totalLabel ? (
        <View style={styles.etaBanner}>
          <Text style={styles.etaBannerLabel}>Trip ETA</Text>
          <Text style={styles.etaBannerValue}>{totalLabel}</Text>
        </View>
      ) : locating ? (
        <View style={styles.etaBanner}>
          <Text style={styles.etaBannerLabel}>Trip ETA</Text>
          <Text style={styles.etaBannerMuted}>Getting your location…</Text>
        </View>
      ) : null}

      {showYouLeg ? (
        <View style={styles.pinBlock}>
          <View style={styles.pinDotYou} />
          <View style={styles.pinCopy}>
            <Text style={styles.pinLabel}>You → Restaurant</Text>
            {youLabel ? (
              <Text style={styles.pinKm}>{youLabel}</Text>
            ) : locating ? (
              <Text style={styles.pinKmMuted}>Measuring…</Text>
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
          ) : null}
          <Text style={styles.pinValue} numberOfLines={2}>
            {dropAddress || 'Customer address'}
          </Text>
        </View>
      </View>
    </View>
  );
}
