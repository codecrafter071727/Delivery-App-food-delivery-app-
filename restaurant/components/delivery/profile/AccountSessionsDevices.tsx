import {
  Bell,
  BellOff,
  MonitorSmartphone,
  Smartphone,
  Trash2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { fonts } from '@/constants/typography';
import { getAuthDeviceId } from '@/lib/auth/device';
import { deliveryPartnerApi } from '@/lib/delivery-partner/api';
import { getApiErrorCode } from '@/lib/errors';
import { isExpoGoRuntime } from '@/lib/notification/device-alerts';
import {
  formatAccountError,
  usePlatformAccountMutations,
  usePlatformDevices,
  usePlatformSessions,
} from '@/lib/user/account-hooks';
import type { StoredPushDevice, UserDevice, UserSession } from '@/lib/user/account-types';
import {
  isThisPushDevice,
  loadStoredPushDevice,
  loadStoredRiderOfferDevice,
  platformAppVersion,
  platformPushPlatform,
  resolvePlatformPushToken,
  saveStoredRiderOfferDevice,
  clearStoredRiderOfferDevice,
} from '@/lib/user/push-token';
import { useAuthStore } from '@/store/auth-store';

function formatLastSeen(iso?: string) {
  if (!iso) return 'Last seen unknown';
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return iso;
  const diff = Date.now() - at;
  if (diff < 45_000) return 'Active now';
  if (diff < 3_600_000) {
    const mins = Math.max(1, Math.round(diff / 60_000));
    return `${mins} min ago`;
  }
  if (diff < 86_400_000) {
    const hours = Math.max(1, Math.round(diff / 3_600_000));
    return `${hours}h ago`;
  }
  const days = Math.max(1, Math.round(diff / 86_400_000));
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}

function sessionHint(session: UserSession) {
  return [session.location, session.ip, formatLastSeen(session.lastSeenAt)]
    .filter(Boolean)
    .join(' · ');
}

export function AccountSessionsDevices() {
  const router = useRouter();
  const sessions = usePlatformSessions(true);
  const devices = usePlatformDevices(true);
  const { revokeSession, registerDevice, unregisterDevice } =
    usePlatformAccountMutations();
  const logoutAll = useAuthStore((s) => s.logoutAll);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [stored, setStored] = useState<StoredPushDevice | null>(null);
  const [authDeviceId, setAuthDeviceId] = useState<string>('');

  useEffect(() => {
    void loadStoredPushDevice().then(setStored);
    void getAuthDeviceId().then(setAuthDeviceId);
  }, [devices.data]);

  const sessionRows = [...(sessions.data ?? [])].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return (Date.parse(b.lastSeenAt ?? '') || 0) - (Date.parse(a.lastSeenAt ?? '') || 0);
  });

  const thisPush = (devices.data ?? []).find((row) =>
    isThisPushDevice(row, stored, authDeviceId)
  );
  const otherPush = (devices.data ?? []).filter(
    (row) => !isThisPushDevice(row, stored, authDeviceId)
  );

  const afterSignOut = async () => {
    await clearSession();
    router.replace('/login');
  };

  const onRevoke = (session: UserSession) => {
    const title = session.current
      ? 'Log out this phone?'
      : `Log out ${session.deviceName}?`;
    const message = session.current
      ? 'You’ll need to sign in again on this phone.'
      : 'That phone will be signed out immediately, like Swiggy / Zomato.';
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => void runRevoke(session),
      },
    ]);
  };

  const runRevoke = async (session: UserSession) => {
    setRevokingId(session.id);
    try {
      await revokeSession.mutateAsync(session.id);
      if (session.current) {
        await afterSignOut();
        return;
      }
    } catch (err) {
      if (getApiErrorCode(err) === 'SESSION_NOT_FOUND') {
        await sessions.refetch();
        if (session.current) await afterSignOut();
        return;
      }
      Alert.alert(
        'Could not log out device',
        formatAccountError(err, 'Try again.')
      );
    } finally {
      setRevokingId(null);
    }
  };

  const onLogoutAll = () => {
    Alert.alert(
      'Log out everywhere?',
      'This will end your session on all phones, including this one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out all',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLoggingOutAll(true);
              try {
                if (thisPush?.deviceId) {
                  try {
                    await unregisterDevice.mutateAsync(thisPush.deviceId);
                  } catch {
                    // Session end still proceeds.
                  }
                }
                await logoutAll();
              } finally {
                setLoggingOutAll(false);
                router.replace('/login');
              }
            })();
          },
        },
      ]
    );
  };

  const enablePush = async () => {
    if (isExpoGoRuntime()) {
      Alert.alert(
        'Alerts unavailable',
        'Expo Go cannot issue an FCM/APNs token. Open the Android or iOS app build.'
      );
      return;
    }
    setPushBusy(true);
    try {
      const token = await resolvePlatformPushToken();
      if (!token) {
        Alert.alert(
          'Permission needed',
          'Allow notifications, then try again.'
        );
        return;
      }
      const deviceId = authDeviceId || (await getAuthDeviceId());
      const platform = platformPushPlatform();
      const appVersion = platformAppVersion();
      await registerDevice.mutateAsync({
        token,
        platform,
        deviceId,
        appVersion,
        app: 'rider',
      });
      try {
        const offer = await deliveryPartnerApi.registerOfferDevice({
          token,
          platform,
          deviceId,
          appVersion,
        });
        if (offer.deviceId) await saveStoredRiderOfferDevice(offer.deviceId);
      } catch {
        // Setup may not be finished; user-service token still saved.
      }
      Alert.alert('Alerts on', 'This phone will get trip and account alerts.');
    } catch (err) {
      Alert.alert(
        'Could not enable alerts',
        formatAccountError(err, 'Try again.')
      );
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = (device: UserDevice, label: string) => {
    Alert.alert(
      'Turn off alerts?',
      `Stop push notifications on ${label}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => void runUnregister(device),
        },
      ]
    );
  };

  const runUnregister = async (device: UserDevice) => {
    setPushBusy(true);
    try {
      await unregisterDevice.mutateAsync(device.deviceId);
      const offerId = await loadStoredRiderOfferDevice();
      if (offerId) {
        try {
          await deliveryPartnerApi.unregisterOfferDevice(offerId);
        } catch {
          // Already gone.
        }
        await clearStoredRiderOfferDevice();
      }
      Alert.alert('Alerts off', 'This token will no longer receive push.');
    } catch (err) {
      if (getApiErrorCode(err) === 'DEVICE_NOT_FOUND') {
        await devices.refetch();
        return;
      }
      Alert.alert(
        'Could not turn off alerts',
        formatAccountError(err, 'Try again.')
      );
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <>
      <View style={styles.section}>
        <View style={styles.titleRow}>
          <MonitorSmartphone color="#EA4B14" size={16} />
          <Text style={styles.title}>Logged in devices</Text>
        </View>
        <Text style={styles.lede}>
          Phones that can access your account. Log out any you don’t recognise.
        </Text>

        {sessions.isLoading && !sessions.data ? (
          <ActivityIndicator color="#EA4B14" style={{ marginVertical: 12 }} />
        ) : sessions.isError && !sessions.data ? (
          <Pressable onPress={() => void sessions.refetch()} style={styles.retry}>
            <Text style={styles.retryText}>
              {formatAccountError(sessions.error, 'Could not load devices. Retry')}
            </Text>
          </Pressable>
        ) : sessionRows.length === 0 ? (
          <Text style={styles.empty}>Only this phone is signed in.</Text>
        ) : (
          sessionRows.map((session) => {
            const busy = revokingId === session.id;
            return (
              <View key={session.id} style={styles.row}>
                <View style={styles.icon}>
                  <Smartphone color={session.current ? '#EA4B14' : '#64748B'} size={16} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{session.deviceName}</Text>
                    {session.current ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>This device</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.hint} numberOfLines={2}>
                    {sessionHint(session)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => onRevoke(session)}
                  disabled={busy || loggingOutAll}
                  hitSlop={8}
                >
                  {busy ? (
                    <ActivityIndicator color="#B91C1C" size="small" />
                  ) : (
                    <Text style={styles.logoutLink}>Log out</Text>
                  )}
                </Pressable>
              </View>
            );
          })
        )}

        <Pressable
          onPress={onLogoutAll}
          disabled={loggingOutAll}
          style={styles.logoutAll}
        >
          {loggingOutAll ? (
            <ActivityIndicator color="#B91C1C" />
          ) : (
            <Text style={styles.logoutAllText}>Log out all devices</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.section}>
        <View style={styles.titleRow}>
          {thisPush ? (
            <Bell color="#EA4B14" size={16} />
          ) : (
            <BellOff color="#64748B" size={16} />
          )}
          <Text style={styles.title}>Push on this phone</Text>
        </View>
        <Text style={styles.lede}>
          FCM / APNs token for account and trip alerts. Same idea as Swiggy Delivery.
        </Text>

        {devices.isLoading && !devices.data ? (
          <ActivityIndicator color="#EA4B14" style={{ marginVertical: 12 }} />
        ) : devices.isError && !devices.data ? (
          <Pressable onPress={() => void devices.refetch()} style={styles.retry}>
            <Text style={styles.retryText}>
              {formatAccountError(devices.error, 'Could not load push devices. Retry')}
            </Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {thisPush ? 'Alerts enabled' : 'Alerts off'}
                </Text>
                <Text style={styles.hint} numberOfLines={2}>
                  {thisPush
                    ? `${thisPush.platform} · ${thisPush.tokenMasked}${
                        thisPush.appVersion ? ` · v${thisPush.appVersion}` : ''
                      }`
                    : isExpoGoRuntime()
                      ? 'Use the Android / iOS app build to register a token'
                      : 'Get a ping when a trip is offered'}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  thisPush
                    ? disablePush(thisPush, 'this phone')
                    : void enablePush()
                }
                disabled={pushBusy}
                style={[styles.chip, thisPush ? styles.chipOff : styles.chipOn]}
              >
                {pushBusy ? (
                  <ActivityIndicator
                    color={thisPush ? '#111827' : '#FFFFFF'}
                    size="small"
                  />
                ) : (
                  <Text style={[styles.chipText, thisPush ? styles.chipTextOff : styles.chipTextOn]}>
                    {thisPush ? 'Turn off' : 'Enable'}
                  </Text>
                )}
              </Pressable>
            </View>

            {otherPush.length ? (
              <Text style={[styles.lede, { marginTop: 8 }]}>Other tokens</Text>
            ) : null}
            {otherPush.map((device) => (
              <View key={device.deviceId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {device.platform} · {device.tokenMasked}
                  </Text>
                  <Text style={styles.hint}>
                    {formatLastSeen(device.lastSeenAt ?? device.registeredAt)}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    disablePush(device, `${device.platform} token`)
                  }
                  disabled={pushBusy}
                  hitSlop={8}
                >
                  <Trash2 color="#B91C1C" size={16} />
                </Pressable>
              </View>
            ))}
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F3F4F6',
    padding: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  title: { fontFamily: fonts.bold, fontSize: 15, color: '#111827' },
  lede: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
    marginBottom: 10,
  },
  empty: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
  },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontFamily: fonts.semiBold, fontSize: 14, color: '#111827' },
  hint: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280', marginTop: 2 },
  badge: {
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 10, color: '#15803D' },
  logoutLink: { fontFamily: fonts.semiBold, fontSize: 12, color: '#B91C1C' },
  logoutAll: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutAllText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#B91C1C' },
  retry: { paddingVertical: 8 },
  retryText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#EA4B14' },
  chip: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 84,
    alignItems: 'center',
  },
  chipOn: { backgroundColor: '#EA4B14' },
  chipOff: { backgroundColor: '#F1F5F9' },
  chipText: { fontFamily: fonts.semiBold, fontSize: 12 },
  chipTextOn: { color: '#FFFFFF' },
  chipTextOff: { color: '#111827' },
});
