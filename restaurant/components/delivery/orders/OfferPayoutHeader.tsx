import { Text, View } from 'react-native';

import { incomingOfferStyles as styles } from '@/components/delivery/orders/incoming-offer-styles';
import {
  formatInr,
  resolveOfferEarnings,
  type OfferEarnings,
} from '@/lib/delivery-partner/offer-earnings';
import type { IncomingOffer } from '@/lib/delivery-partner/offer-store';

type Props = {
  offer: IncomingOffer;
  stacked?: boolean;
  stackCount?: number;
  stackEarnings?: OfferEarnings | null;
};

export function OfferPayoutHeader({
  offer,
  stacked,
  stackCount,
  stackEarnings,
}: Props) {
  const earnings = stackEarnings ?? resolveOfferEarnings(offer);
  const hasIncentive = Boolean(earnings?.showIncentive && (earnings?.incentive ?? 0) > 0);
  const deliveryFee =
    offer.deliveryFee != null && Number.isFinite(offer.deliveryFee)
      ? offer.deliveryFee
      : null;

  return (
    <View style={styles.payoutBlock}>
      <Text style={styles.kicker}>
        {stacked ? 'Stacked delivery request' : 'New delivery request'}
      </Text>

      <Text style={styles.payout}>
        {earnings ? formatInr(earnings.netTotal) : 'New order'}
      </Text>
      <Text style={styles.payoutSub}>
        {earnings ? 'You earn (after platform fee)' : 'Accept to view trip earnings'}
      </Text>

      {earnings ? (
        <View style={styles.fareCard}>
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Delivery pay</Text>
            <Text style={styles.fareValue}>{formatInr(earnings.basePay)}</Text>
          </View>

          {hasIncentive ? (
            <View style={styles.fareRow}>
              <Text style={[styles.fareLabel, styles.fareIncentiveLabel]}>
                + Incentive
              </Text>
              <Text style={[styles.fareValue, styles.fareIncentiveValue]}>
                {formatInr(earnings.incentive)}
              </Text>
            </View>
          ) : null}

          <View style={styles.fareDivider} />

          <View style={styles.fareRow}>
            <Text style={styles.fareTotalLabel}>
              {hasIncentive ? 'Delivery + incentive' : 'Total payout'}
            </Text>
            <Text style={styles.fareTotalValue}>
              {formatInr(earnings.netTotal)}
            </Text>
          </View>

          {hasIncentive ? (
            <Text style={styles.fareEquation}>
              {formatInr(earnings.basePay)} + {formatInr(earnings.incentive)} ={' '}
              {formatInr(earnings.netTotal)}
            </Text>
          ) : null}

          {deliveryFee != null ? (
            <Text style={styles.fareHint}>
              Customer delivery fee {formatInr(deliveryFee)} · after{' '}
              {earnings.commissionPercent}% platform fee
              {hasIncentive ? ' · incentive paid in full' : ''}
            </Text>
          ) : (
            <Text style={styles.fareHint}>
              After {earnings.commissionPercent}% platform fee
              {hasIncentive ? ' · incentive paid in full' : ''}
            </Text>
          )}
        </View>
      ) : null}

      <Text style={styles.meta}>
        {[
          stacked ? `${stackCount ?? 2} orders` : null,
          offer.broadcast ? 'Broadcast offer' : 'Offered to you',
          offer.searchRadiusKm != null
            ? `Search ${offer.searchRadiusKm} km`
            : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </View>
  );
}
