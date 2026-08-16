import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fonts } from '@/constants/typography';
import { useRiderGatewayStatus } from '@/lib/delivery-partner/use-rider-gateway';
import { startRiderGateway } from '@/lib/delivery-partner/rider-gateway';

/**
 * Thin live-connection chip — Swiggy/Zomato style. Hidden when connected.
 */
export function GatewayStatusBanner() {
  const status = useRiderGatewayStatus();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (status === 'connected' || status === 'idle') {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), 700);
    return () => clearTimeout(timer);
  }, [status]);

  if (!visible || status === 'connected' || status === 'idle') return null;

  const offline = status === 'offline';

  return (
    <View style={[styles.bar, offline ? styles.barOffline : styles.barConnecting]}>
      <View style={[styles.dot, offline ? styles.dotOffline : styles.dotConnecting]} />
      <Text style={styles.text}>
        {offline
          ? 'No live connection. We’ll keep trying.'
          : 'Connecting to live updates…'}
      </Text>
      {offline ? (
        <Pressable
          onPress={() => startRiderGateway(true)}
          hitSlop={8}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    gap: 8,
  },
  barConnecting: {
    backgroundColor: '#FFF7ED',
  },
  barOffline: {
    backgroundColor: '#FEF2F2',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dotConnecting: {
    backgroundColor: '#F59E0B',
  },
  dotOffline: {
    backgroundColor: '#EF4444',
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: fonts.semiBold,
    color: '#1F2937',
  },
  retry: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  retryText: {
    fontSize: 12,
    fontFamily: fonts.bold,
    color: '#EA4B14',
  },
});
