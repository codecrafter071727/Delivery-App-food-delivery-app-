import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts } from '@/constants/typography';
import {
  dismissLiveToast,
  subscribeLiveToasts,
  type LiveToast,
} from '@/lib/delivery-partner/live-toast-store';

export function RiderLiveToasts() {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<LiveToast[]>([]);

  useEffect(() => subscribeLiveToasts(setToasts), []);

  if (!toasts.length) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      {toasts.map((toast) => (
        <Pressable
          key={toast.id}
          onPress={() => dismissLiveToast(toast.id)}
          style={[
            styles.card,
            toast.tone === 'success' && styles.success,
            toast.tone === 'warn' && styles.warn,
          ]}
        >
          <Text style={styles.title}>{toast.title}</Text>
          <Text style={styles.body}>{toast.body}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 80,
    gap: 8,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  success: { backgroundColor: '#14532D' },
  warn: { backgroundColor: '#7C2D12' },
  title: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  body: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.88)',
  },
});
