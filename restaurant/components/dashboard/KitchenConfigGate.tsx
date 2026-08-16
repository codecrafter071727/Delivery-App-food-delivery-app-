import { Modal, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useKitchenConfig, kitchenAppVersion } from '@/lib/restaurant/hooks';
import { useMyRestaurantId } from '@/lib/order/hooks';

/**
 * Splash-gate from GET /restaurants/:id/config — blocks kitchen if
 * the installed app is below minSupportedAppVersion.
 */
export function KitchenConfigGate() {
  const restaurant = useMyRestaurantId({ enabled: true });
  const config = useKitchenConfig(restaurant.data?.id);

  if (!config.data?.forceUpdate) return null;

  return (
    <Modal visible animationType="fade" statusBarTranslucent>
      <View style={styles.wrap}>
        <Text style={styles.title}>Update required</Text>
        <Text style={styles.body}>
          This kitchen app is {kitchenAppVersion()}. Outlets now need at least{' '}
          {config.data.minSupportedAppVersion}. Update TOKAJO FOODS to keep
          taking orders.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: authTheme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    fontFamily: fonts.extraBold,
    fontSize: 22,
    color: authTheme.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 22,
    color: authTheme.textMuted,
    textAlign: 'center',
  },
});
