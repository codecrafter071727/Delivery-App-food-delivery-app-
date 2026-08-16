import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { restaurantSettingsApi } from '@/lib/restaurant/settings-api';
import {
  consumePendingStaffInvite,
  savePendingStaffInvite,
} from '@/lib/restaurant/staff-invite-storage';
import { useAuthStore } from '@/store/auth-store';

export default function StaffInviteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; restaurantId?: string }>();
  const token = useAuthStore((s) => s.token);
  const [status, setStatus] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('Joining the kitchen team…');

  useEffect(() => {
    let active = true;

    const run = async () => {
      const fromParams = {
        token: String(params.token ?? '').trim(),
        restaurantId: String(params.restaurantId ?? '').trim(),
      };
      if (fromParams.token && fromParams.restaurantId) {
        await savePendingStaffInvite(fromParams);
      }

      if (!token) {
        router.replace('/login');
        return;
      }

      const pending =
        fromParams.token && fromParams.restaurantId
          ? fromParams
          : await consumePendingStaffInvite();

      if (!pending?.token || !pending.restaurantId) {
        if (!active) return;
        setStatus('error');
        setMessage('This invite link is missing a token. Ask the owner to resend it.');
        return;
      }

      try {
        await restaurantSettingsApi.acceptStaffInvite(
          pending.restaurantId,
          pending.token
        );
        await consumePendingStaffInvite();
        if (!active) return;
        setStatus('ok');
        setMessage('You’re on the team. Open Home to start taking orders.');
      } catch (error) {
        await consumePendingStaffInvite();
        if (!active) return;
        setStatus('error');
        setMessage(getApiErrorMessage(error));
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [params.token, params.restaurantId, token, router]);

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader title="Join team" showBack hideActions />
      <View style={styles.body}>
        {status === 'working' ? (
          <ActivityIndicator color={authTheme.brand} size="large" />
        ) : null}
        <Text style={styles.title}>
          {status === 'ok'
            ? 'Joined'
            : status === 'error'
              ? 'Couldn’t join'
              : 'Joining'}
        </Text>
        <Text style={styles.copy}>{message}</Text>
        {status !== 'working' ? (
          <Pressable
            style={styles.btn}
            onPress={() => router.replace('/dashboard')}
          >
            <Text style={styles.btnText}>Go to home</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  title: {
    fontFamily: fonts.extraBold,
    fontSize: 22,
    color: authTheme.text,
  },
  copy: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  btn: {
    marginTop: 12,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  btnText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
});
