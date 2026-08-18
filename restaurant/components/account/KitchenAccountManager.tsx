import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import {
  Bell,
  BellOff,
  Globe,
  Mail,
  MonitorSmartphone,
  Phone,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { ContactChangeModal } from '@/components/delivery/profile/PlatformAccountSection';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getAuthDeviceId } from '@/lib/auth/device';
import { getApiErrorCode } from '@/lib/errors';
import { isExpoGoRuntime } from '@/lib/notification/device-alerts';
import { userAccountApi } from '@/lib/user/account-api';
import {
  formatAccountError,
  platformAccountKeys,
  usePlatformAccountMutations,
  usePlatformDevices,
  usePlatformMe,
  usePlatformPreferences,
  usePlatformSessions,
} from '@/lib/user/account-hooks';
import {
  displayPlatformName,
  languageLabel,
  type NotificationPrefs,
  type StoredPushDevice,
  type UserDevice,
  type UserSession,
} from '@/lib/user/account-types';
import {
  isThisPushDevice,
  loadStoredPushDevice,
  platformAppVersion,
  platformPushPlatform,
  resolvePlatformPushToken,
} from '@/lib/user/push-token';
import { useAuthStore } from '@/store/auth-store';
import { useQueryClient } from '@tanstack/react-query';

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

export function KitchenAccountManager() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = usePlatformMe(true);
  const prefs = usePlatformPreferences(true);
  const sessions = usePlatformSessions(true);
  const devices = usePlatformDevices(true);
  const mutations = usePlatformAccountMutations();
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const logoutAll = useAuthStore((s) => s.logoutAll);
  const clearSession = useAuthStore((s) => s.clearSession);
  const resendEmailVerification = useAuthStore((s) => s.resendEmailVerification);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [contactKind, setContactKind] = useState<'phone' | 'email' | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteOtp, setDeleteOtp] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [stored, setStored] = useState<StoredPushDevice | null>(null);
  const [authDeviceId, setAuthDeviceId] = useState('');

  const user = me.data;
  const notifications = prefs.data?.notifications;
  const language = prefs.data?.language ?? 'en';
  const languages = prefs.data?.languages ?? ['en', 'hi'];

  useEffect(() => {
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
  }, [user]);

  useEffect(() => {
    void loadStoredPushDevice().then(setStored);
    void getAuthDeviceId().then(setAuthDeviceId);
  }, [devices.data]);

  const displayName = displayPlatformName(user) || user?.email || 'Owner';
  const initials = useMemo(() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return (parts[0]?.[0] ?? 'O').toUpperCase();
  }, [displayName]);

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

  const refresh = async () => {
    await Promise.all([
      me.refetch(),
      prefs.refetch(),
      sessions.refetch(),
      devices.refetch(),
      queryClient.invalidateQueries({ queryKey: platformAccountKeys.all }),
    ]);
  };

  const saveName = async () => {
    try {
      await mutations.updateName.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      Alert.alert('Saved', 'Your name was updated.');
    } catch (error) {
      Alert.alert(
        'Could not save name',
        formatAccountError(error, 'Try again.')
      );
    }
  };

  const pickAndUploadPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photos needed', 'Allow photo access to upload a profile photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
      exif: false,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    const asset = result.assets[0];
    setPhotoBusy(true);
    try {
      await mutations.uploadPhoto.mutateAsync({
        uri: asset.uri,
        name: asset.fileName || `profile-${Date.now()}.jpg`,
        type: asset.mimeType || 'image/jpeg',
      });
      Alert.alert('Uploaded', 'Profile photo updated.');
    } catch (error) {
      Alert.alert(
        'Upload failed',
        formatAccountError(error, 'Could not upload photo.')
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      await mutations.deletePhoto.mutateAsync();
      Alert.alert('Removed', 'Profile photo removed.');
    } catch (error) {
      Alert.alert(
        'Could not remove photo',
        formatAccountError(error, 'Try again.')
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const onPhotoPress = () => {
    if (!user?.photoUrl) {
      void pickAndUploadPhoto();
      return;
    }
    Alert.alert('Profile photo', 'This photo is on your owner login, not the outlet logo.', [
      { text: 'Change photo', onPress: () => void pickAndUploadPhoto() },
      {
        text: 'Remove photo',
        style: 'destructive',
        onPress: () => void removePhoto(),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const patchNotifications = async (next: NotificationPrefs) => {
    setPrefsError(null);
    try {
      await mutations.updateNotifications.mutateAsync(next);
    } catch (error) {
      setPrefsError(formatAccountError(error, 'Could not save notification prefs.'));
    }
  };

  const onLanguage = async (code: string) => {
    setPrefsError(null);
    try {
      await mutations.updateLanguage.mutateAsync(code);
    } catch (error) {
      setPrefsError(formatAccountError(error, 'Could not save language.'));
    }
  };

  const afterSignOut = async () => {
    await clearSession();
    router.replace('/login');
  };

  const runRevoke = async (session: UserSession) => {
    setRevokingId(session.id);
    try {
      await mutations.revokeSession.mutateAsync(session.id);
      if (session.current) {
        await afterSignOut();
      }
    } catch (error) {
      if (getApiErrorCode(error) === 'SESSION_NOT_FOUND') {
        await sessions.refetch();
        if (session.current) await afterSignOut();
        return;
      }
      Alert.alert(
        'Could not log out device',
        formatAccountError(error, 'Try again.')
      );
    } finally {
      setRevokingId(null);
    }
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
        Alert.alert('Permission needed', 'Allow notifications, then try again.');
        return;
      }
      const deviceId = authDeviceId || (await getAuthDeviceId());
      await mutations.registerDevice.mutateAsync({
        token,
        platform: platformPushPlatform(),
        deviceId,
        appVersion: platformAppVersion(),
        app: 'kitchen',
      });
      Alert.alert('Alerts on', 'This phone is registered for account push.');
    } catch (error) {
      Alert.alert(
        'Could not enable alerts',
        formatAccountError(error, 'Try again.')
      );
    } finally {
      setPushBusy(false);
    }
  };

  const runUnregister = async (device: UserDevice) => {
    setPushBusy(true);
    try {
      await mutations.unregisterDevice.mutateAsync(device.deviceId);
      Alert.alert('Alerts off', 'This token will no longer receive account push.');
    } catch (error) {
      if (getApiErrorCode(error) === 'DEVICE_NOT_FOUND') {
        await devices.refetch();
        return;
      }
      Alert.alert(
        'Could not turn off alerts',
        formatAccountError(error, 'Try again.')
      );
    } finally {
      setPushBusy(false);
    }
  };

  const runDeletePreview = async () => {
    setDeleting(true);
    try {
      const preview = await userAccountApi.getDeletePreview();
      const lines = [
        preview.warn?.trim() || null,
        preview.openOrders
          ? `${preview.openOrders} open order(s) still need to finish`
          : 'No open customer orders',
        'Your owner login, photo, and signed-in phones will be removed.',
        'Outlet listing and KYC stay with ops until they close the restaurant.',
      ]
        .filter(Boolean)
        .join('\n');

      if (!preview.canDelete) {
        Alert.alert(
          'Cannot delete yet',
          lines || 'Finish open work before deleting this account.'
        );
        return;
      }

      Alert.alert('Delete this account permanently?', lines, [
        { text: 'Keep account', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void confirmDelete(),
        },
      ]);
    } catch (error) {
      Alert.alert(
        'Could not load delete preview',
        formatAccountError(error, 'Try again.')
      );
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = async (otp?: string) => {
    if (otp !== undefined && otp.trim().length < 4) {
      Alert.alert('OTP required', 'Enter the 6-digit code we sent.');
      return;
    }
    setDeleting(true);
    try {
      await mutations.deleteAccount.mutateAsync(otp ? { otp } : undefined);
      setDeleteOtp(null);
      await afterSignOut();
    } catch (error) {
      if (getApiErrorCode(error) === 'OTP_REQUIRED' && !otp) {
        try {
          const identifier = user?.phone || user?.email;
          if (!identifier) throw error;
          await sendOtp({
            emailOrPhone: identifier,
            purpose: 'delete_account',
          });
          setDeleteOtp('');
        } catch (otpErr) {
          Alert.alert(
            'Could not delete account',
            formatAccountError(otpErr, formatAccountError(error, 'Try again.'))
          );
        }
        return;
      }
      Alert.alert(
        'Could not delete account',
        formatAccountError(error, 'Try again.')
      );
    } finally {
      setDeleting(false);
    }
  };

  const loading = me.isLoading && !user;

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Your account"
        subtitle="Login, devices, and preferences"
        showBack
        hideProfile
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={me.isRefetching}
            onRefresh={() => void refresh()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : me.isError && !user ? (
          <View style={styles.empty}>
            <Text style={styles.errorText}>
              {formatAccountError(me.error, 'Could not load your account')}
            </Text>
            <PrimaryButton label="Retry" onPress={() => void refresh()} />
          </View>
        ) : user ? (
          <>
            <View style={styles.card}>
              <Pressable onPress={onPhotoPress} disabled={photoBusy} style={styles.photoRow}>
                {user.photoUrl ? (
                  <Image source={{ uri: user.photoUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{displayName}</Text>
                  <Text style={styles.meta}>
                    {photoBusy
                      ? 'Updating photo…'
                      : 'Tap to change or remove photo'}
                  </Text>
                </View>
                {photoBusy ? <ActivityIndicator color={authTheme.brand} /> : null}
              </Pressable>

              <Text style={styles.label}>First name</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="First name"
                placeholderTextColor={authTheme.textDim}
                style={styles.input}
              />
              <Text style={styles.label}>Last name</Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Last name"
                placeholderTextColor={authTheme.textDim}
                style={styles.input}
              />
              <PrimaryButton
                label="Save name"
                loading={mutations.updateName.isPending}
                onPress={() => void saveName()}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Contact</Text>
              <Pressable
                onPress={() => setContactKind('phone')}
                style={styles.row}
              >
                <Phone color={authTheme.brand} size={16} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Phone</Text>
                  <Text style={styles.meta}>{user.phone || 'Add a number'}</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => setContactKind('email')}
                style={styles.row}
              >
                <Mail color={authTheme.brand} size={16} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>Email</Text>
                  <Text style={styles.meta}>{user.email || 'Add an email'}</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (user.emailVerified) {
                    Alert.alert('Already verified', 'Your email is already verified.');
                    return;
                  }
                  void resendEmailVerification()
                    .then(() =>
                      Alert.alert('Email sent', 'Verification link sent to your inbox.')
                    )
                    .catch((error) =>
                      Alert.alert(
                        'Failed',
                        error instanceof Error ? error.message : 'Could not resend email'
                      )
                    );
                }}
                style={styles.linkRow}
              >
                <Text style={styles.linkText}>
                  {user.emailVerified ? 'Email verified' : 'Resend verification email'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.titleRow}>
                <Globe color={authTheme.brand} size={16} />
                <Text style={styles.cardTitle}>Preferences</Text>
              </View>
              {prefs.isLoading && !prefs.data ? (
                <ActivityIndicator color={authTheme.brand} />
              ) : prefs.isError && !prefs.data ? (
                <Pressable onPress={() => void prefs.refetch()}>
                  <Text style={styles.linkText}>
                    {formatAccountError(prefs.error, 'Could not load preferences. Retry')}
                  </Text>
                </Pressable>
              ) : (
                <>
                  <Text style={styles.label}>Language</Text>
                  <View style={styles.chipRow}>
                    {languages.map((code) => {
                      const on = language === code;
                      return (
                        <Pressable
                          key={code}
                          onPress={() => void onLanguage(code)}
                          disabled={mutations.updateLanguage.isPending}
                          style={[styles.chip, on && styles.chipOn]}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>
                            {languageLabel(code)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <PrefToggle
                    icon={Bell}
                    label="Push"
                    hint="Account alerts on this phone"
                    value={notifications?.push ?? true}
                    disabled={mutations.updateNotifications.isPending}
                    onChange={(push) =>
                      void patchNotifications({
                        push,
                        sms: notifications?.sms ?? true,
                        email: notifications?.email ?? true,
                      })
                    }
                  />
                  <PrefToggle
                    icon={Phone}
                    label="SMS"
                    hint="OTP and important account texts"
                    value={notifications?.sms ?? true}
                    disabled={mutations.updateNotifications.isPending}
                    onChange={(sms) =>
                      void patchNotifications({
                        push: notifications?.push ?? true,
                        sms,
                        email: notifications?.email ?? true,
                      })
                    }
                  />
                  <PrefToggle
                    icon={Mail}
                    label="Email"
                    hint="Verification and account mail"
                    value={notifications?.email ?? true}
                    disabled={mutations.updateNotifications.isPending}
                    onChange={(email) =>
                      void patchNotifications({
                        push: notifications?.push ?? true,
                        sms: notifications?.sms ?? true,
                        email,
                      })
                    }
                  />
                </>
              )}
              {prefsError ? <Text style={styles.errorText}>{prefsError}</Text> : null}
            </View>

            <View style={styles.card}>
              <View style={styles.titleRow}>
                <MonitorSmartphone color={authTheme.brand} size={16} />
                <Text style={styles.cardTitle}>Logged-in devices</Text>
              </View>
              <Text style={styles.meta}>
                Phones that can access this owner login. Log out any you don’t recognise.
              </Text>
              {sessions.isLoading && !sessions.data ? (
                <ActivityIndicator color={authTheme.brand} />
              ) : sessions.isError && !sessions.data ? (
                <Pressable onPress={() => void sessions.refetch()}>
                  <Text style={styles.linkText}>
                    {formatAccountError(sessions.error, 'Could not load sessions. Retry')}
                  </Text>
                </Pressable>
              ) : sessionRows.length === 0 ? (
                <Text style={styles.meta}>Only this phone is signed in.</Text>
              ) : (
                sessionRows.map((session) => (
                  <View key={session.id} style={styles.deviceRow}>
                    <Smartphone
                      color={session.current ? authTheme.brand : authTheme.textMuted}
                      size={16}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>
                        {session.deviceName}
                        {session.current ? ' · this phone' : ''}
                      </Text>
                      <Text style={styles.meta}>{sessionHint(session)}</Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        Alert.alert(
                          session.current ? 'Log out this phone?' : `Log out ${session.deviceName}?`,
                          session.current
                            ? 'You’ll need to sign in again on this phone.'
                            : 'That phone will be signed out immediately.',
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Log out',
                              style: 'destructive',
                              onPress: () => void runRevoke(session),
                            },
                          ]
                        )
                      }
                      disabled={revokingId === session.id}
                    >
                      {revokingId === session.id ? (
                        <ActivityIndicator color={authTheme.error} size="small" />
                      ) : (
                        <Text style={styles.dangerLink}>Log out</Text>
                      )}
                    </Pressable>
                  </View>
                ))
              )}
              <Pressable
                onPress={() =>
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
                                  await mutations.unregisterDevice.mutateAsync(
                                    thisPush.deviceId
                                  );
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
                  )
                }
                disabled={loggingOutAll}
                style={styles.linkRow}
              >
                {loggingOutAll ? (
                  <ActivityIndicator color={authTheme.error} />
                ) : (
                  <Text style={styles.dangerLink}>Log out all devices</Text>
                )}
              </Pressable>
            </View>

            <View style={styles.card}>
              <View style={styles.titleRow}>
                {thisPush ? (
                  <Bell color={authTheme.brand} size={16} />
                ) : (
                  <BellOff color={authTheme.textMuted} size={16} />
                )}
                <Text style={styles.cardTitle}>Account push tokens</Text>
              </View>
              <Text style={styles.meta}>
                User-service FCM/APNs for this login. Order pings still use Settings → Operations.
              </Text>
              {devices.isLoading && !devices.data ? (
                <ActivityIndicator color={authTheme.brand} />
              ) : devices.isError && !devices.data ? (
                <Pressable onPress={() => void devices.refetch()}>
                  <Text style={styles.linkText}>
                    {formatAccountError(devices.error, 'Could not load devices. Retry')}
                  </Text>
                </Pressable>
              ) : (
                <>
                  {thisPush ? (
                    <View style={styles.deviceRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>This phone</Text>
                        <Text style={styles.meta}>
                          {thisPush.platform} · {thisPush.tokenMasked}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => void runUnregister(thisPush)}
                        disabled={pushBusy}
                      >
                        <Text style={styles.dangerLink}>Turn off</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <PrimaryButton
                      label="Register this phone"
                      loading={pushBusy}
                      onPress={() => void enablePush()}
                    />
                  )}
                  {otherPush.map((device) => (
                    <View key={device.deviceId} style={styles.deviceRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowLabel}>
                          {device.app || device.platform} token
                        </Text>
                        <Text style={styles.meta}>{device.tokenMasked}</Text>
                      </View>
                      <Pressable
                        onPress={() => void runUnregister(device)}
                        disabled={pushBusy}
                      >
                        <Trash2 color={authTheme.error} size={16} />
                      </Pressable>
                    </View>
                  ))}
                </>
              )}
            </View>

            <Pressable
              onPress={() =>
                Alert.alert(
                  'Delete account?',
                  'We’ll check what you’ll lose, then ask you to confirm. This cannot be undone.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Continue',
                      style: 'destructive',
                      onPress: () => void runDeletePreview(),
                    },
                  ]
                )
              }
              disabled={deleting}
              style={styles.deleteCard}
            >
              {deleting ? (
                <ActivityIndicator color={authTheme.error} />
              ) : (
                <>
                  <View style={styles.deleteIcon}>
                    <Trash2 color={authTheme.error} size={16} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.deleteLabel}>Delete account</Text>
                    <Text style={styles.meta}>
                      Preview what you’ll lose, then confirm
                    </Text>
                  </View>
                  <ShieldCheck color="#FECACA" size={16} />
                </>
              )}
            </Pressable>
          </>
        ) : (
          <View style={styles.empty}>
            <UserRound color={authTheme.textMuted} size={28} />
            <Text style={styles.emptyTitle}>No account loaded</Text>
            <PrimaryButton label="Retry" onPress={() => void refresh()} />
          </View>
        )}
      </ScrollView>

      <ContactChangeModal
        kind={contactKind}
        current={contactKind === 'phone' ? user?.phone : user?.email}
        onClose={() => setContactKind(null)}
      />

      <Modal
        visible={deleteOtp != null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteOtp(null)}
      >
        <View style={styles.otpOverlay}>
          <Pressable style={styles.otpBackdrop} onPress={() => setDeleteOtp(null)} />
          <View style={styles.otpSheet}>
            <Text style={styles.cardTitle}>Confirm deletion</Text>
            <Text style={styles.meta}>Enter the OTP sent to your phone or email.</Text>
            <TextInput
              value={deleteOtp ?? ''}
              onChangeText={(text) =>
                setDeleteOtp(text.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="6-digit OTP"
              placeholderTextColor={authTheme.textDim}
              keyboardType="number-pad"
              style={styles.input}
            />
            <PrimaryButton
              label="Delete account"
              loading={deleting}
              onPress={() => void confirmDelete(deleteOtp ?? '')}
            />
            <Pressable onPress={() => setDeleteOtp(null)} style={styles.linkRow}>
              <Text style={styles.meta}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PrefToggle({
  icon: Icon,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  icon: typeof Bell;
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.prefRow}>
      <Icon color={authTheme.textMuted} size={16} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.meta}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#E2E8F0', true: 'rgba(122,14,34,0.35)' }}
        thumbColor={value ? authTheme.brand : '#F8FAFC'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingBottom: PARTNER_BOTTOM_NAV_INSET,
    gap: 14,
  },
  center: { paddingVertical: 48, alignItems: 'center' },
  empty: { paddingVertical: 32, alignItems: 'center', gap: 10 },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 10,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 64, height: 64, borderRadius: 20 },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: authTheme.brand,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  input: {
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: authTheme.text,
    backgroundColor: '#FFFFFF',
  },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  rowLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: authTheme.text },
  linkRow: { paddingVertical: 6, alignItems: 'flex-start' },
  linkText: { fontFamily: fonts.semiBold, fontSize: 13, color: authTheme.brand },
  dangerLink: { fontFamily: fonts.semiBold, fontSize: 13, color: authTheme.error },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F1F5F9',
  },
  chipOn: { backgroundColor: authTheme.brandSoft },
  chipText: { fontFamily: fonts.semiBold, fontSize: 13, color: authTheme.textMuted },
  chipTextOn: { color: authTheme.brand },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  deleteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
  },
  deleteIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: authTheme.error },
  errorText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.error,
  },
  otpOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  otpBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  otpSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
  },
});
