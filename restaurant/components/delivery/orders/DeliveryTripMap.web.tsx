import { View, Text, StyleSheet } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type { OrderTracking } from '@/lib/delivery-partner/tracking-types';
import type { PartnerDelivery } from '@/lib/delivery-partner/types';

export function DeliveryTripMap({
  delivery,
}: {
  delivery: PartnerDelivery;
  tracking?: OrderTracking | null;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Live map is only available on the mobile app.</Text>
      <Text style={styles.subText}>
        Customer: {delivery.customerName || 'Unknown'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 120,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  text: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
    textAlign: 'center',
  },
  subText: {
    marginTop: 8,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.textMuted,
    textAlign: 'center',
  },
});
