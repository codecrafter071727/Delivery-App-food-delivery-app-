import { Bell, BellOff } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  useKitchenDeviceMutations,
  useStoredKitchenDevice,
} from '@/lib/restaurant/inbox-hooks';
import { resolveKitchenPushToken } from '@/lib/restaurant/inbox-api';

export function KitchenPushCard({ restaurantId }: { restaurantId: string }) {
  const stored = useStoredKitchenDevice();
  const mutations = useKitchenDeviceMutations(restaurantId);
  const [busy, setBusy] = useState(false);
  const device =
    stored.data?.restaurantId === restaurantId ? stored.data : null;

  const enable = async () => {
    setBusy(true);
    try {
      const token = await resolveKitchenPushToken();
      if (!token) {
        Alert.alert(
          'Alerts unavailable',
          'Allow notifications, or open the Android/iOS app. Expo Go may not issue a device token.'
        );
        return;
      }
      await mutations.register.mutateAsync({
        token,
        deviceId: device?.deviceId,
      });
    } catch (error) {
      Alert.alert(
        'Could not enable alerts',
        error instanceof Error ? error.message : 'Try again'
      );
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!device?.deviceId) return;
    setBusy(true);
    try {
      await mutations.unregister.mutateAsync(device.deviceId);
    } catch (error) {
      Alert.alert(
        'Could not turn off alerts',
        error instanceof Error ? error.message : 'Try again'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>
          {device ? (
            <Bell color={authTheme.brand} size={18} />
          ) : (
            <BellOff color={authTheme.textMuted} size={18} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Order alerts on this phone</Text>
          <Text style={styles.hint}>
            {device
              ? `Registered ${device.platform} · ${device.tokenMasked}`
              : 'Get a ping when a new order arrives'}
          </Text>
        </View>
      </View>
      <Pressable
        style={[styles.btn, device ? styles.btnOff : styles.btnOn]}
        onPress={() => void (device ? disable() : enable())}
        disabled={busy || stored.isLoading}
      >
        {busy ? (
          <ActivityIndicator color={device ? authTheme.text : '#FFFFFF'} />
        ) : (
          <Text style={[styles.btnText, device ? styles.btnTextOff : styles.btnTextOn]}>
            {device ? 'Turn off this device' : 'Enable alerts'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 14,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: authTheme.text, fontSize: 15, fontFamily: fonts.bold },
  hint: { color: authTheme.textMuted, fontSize: 12, fontFamily: fonts.medium, marginTop: 2 },
  btn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnOn: { backgroundColor: authTheme.brand },
  btnOff: { backgroundColor: authTheme.surface },
  btnText: { fontSize: 14, fontFamily: fonts.bold },
  btnTextOn: { color: '#FFFFFF' },
  btnTextOff: { color: authTheme.text },
});
