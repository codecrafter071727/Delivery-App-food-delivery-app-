import {
  Bell,
  Globe,
  Mail,
  Phone,
  ShieldCheck,
  Trash2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { getApiErrorCode } from '@/lib/errors';
import { userAccountApi } from '@/lib/user/account-api';
import {
  formatAccountError,
  usePlatformAccountMutations,
  usePlatformPreferences,
} from '@/lib/user/account-hooks';
import {
  languageLabel,
  type NotificationPrefs,
} from '@/lib/user/account-types';
import { useAuthStore } from '@/store/auth-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizePhone(raw: string) {
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (value.startsWith('+')) return value;
  return value;
}

type ContactKind = 'phone' | 'email';

export function ContactChangeModal({
  kind,
  current,
  onClose,
}: {
  kind: ContactKind | null;
  current?: string;
  onClose: () => void;
}) {
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const resendOtp = useAuthStore((s) => s.resendOtp);
  const { updatePhone, updateEmail } = usePlatformAccountMutations();
  const [value, setValue] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'enter' | 'otp'>('enter');
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(current ?? '');
    setOtp('');
    setStep('enter');
    setError(null);
    setCooldown(0);
  }, [kind, current]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!kind) return null;

  const isPhone = kind === 'phone';
  const title = isPhone ? 'Change phone' : 'Change email';

  const applyCooldown = (seconds: number, err?: unknown) => {
    if (seconds > 0) setCooldown(seconds);
    else if (getApiErrorCode(err) === 'OTP_COOLDOWN') setCooldown(30);
  };

  const requestOtp = async (resend: boolean) => {
    const identifier = isPhone
      ? normalizePhone(value)
      : value.trim().toLowerCase();
    const result = resend
      ? await resendOtp({
          emailOrPhone: identifier,
          purpose: isPhone ? 'update_phone' : 'update_email',
        })
      : await sendOtp({
          emailOrPhone: identifier,
          purpose: isPhone ? 'update_phone' : 'update_email',
        });
    applyCooldown(result.cooldownSeconds);
    setStep('otp');
  };

  const onContinue = async () => {
    setError(null);
    if (isPhone) {
      const phone = normalizePhone(value);
      if (phone.replace(/\D/g, '').length < 10) {
        setError('Enter a valid mobile number.');
        return;
      }
    } else if (!EMAIL_RE.test(value.trim())) {
      setError('Enter a valid email address.');
      return;
    }

    setBusy(true);
    try {
      if (isPhone) {
        await requestOtp(false);
        return;
      }
      try {
        await updateEmail.mutateAsync({ email: value.trim().toLowerCase() });
        Alert.alert('Email updated', 'Sign-in will use this email from now on.');
        onClose();
      } catch (err) {
        if (getApiErrorCode(err) === 'OTP_REQUIRED') {
          await requestOtp(false);
          return;
        }
        throw err;
      }
    } catch (err) {
      applyCooldown(0, err);
      setError(formatAccountError(err, 'Could not continue.'));
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    setError(null);
    if (otp.trim().length < 4) {
      setError('Enter the 6-digit OTP.');
      return;
    }
    setBusy(true);
    try {
      if (isPhone) {
        await updatePhone.mutateAsync({
          phone: normalizePhone(value),
          otp: otp.trim(),
        });
        Alert.alert('Phone updated', 'OTP verified. Your number is saved.');
      } else {
        await updateEmail.mutateAsync({
          email: value.trim().toLowerCase(),
          otp: otp.trim(),
        });
        Alert.alert('Email updated', 'OTP verified. Your email is saved.');
      }
      onClose();
    } catch (err) {
      setError(formatAccountError(err, 'Could not verify OTP.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Text style={styles.sheetHint}>
            {isPhone
              ? 'We’ll send an OTP to the new number before saving — same as Swiggy / Zomato.'
              : 'We’ll update your login email. An OTP may be required.'}
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {step === 'enter' ? (
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={isPhone ? '9876543210' : 'you@example.com'}
              placeholderTextColor="#9CA3AF"
              keyboardType={isPhone ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              style={styles.input}
            />
          ) : (
            <TextInput
              value={otp}
              onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit OTP"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={styles.input}
            />
          )}

          <Pressable
            onPress={() => void (step === 'enter' ? onContinue() : onVerify())}
            disabled={busy}
            style={styles.primaryBtn}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.primaryBtnText}>
                {step === 'enter' ? (isPhone ? 'Send OTP' : 'Continue') : 'Verify & save'}
              </Text>
            )}
          </Pressable>

          {step === 'otp' ? (
            <Pressable
              onPress={() => void requestOtp(true).catch((err) => {
                applyCooldown(0, err);
                setError(formatAccountError(err, 'Could not resend OTP.'));
              })}
              disabled={busy || cooldown > 0}
              style={styles.linkBtn}
            >
              <Text style={styles.linkText}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
              </Text>
            </Pressable>
          ) : null}

          <Pressable onPress={onClose} style={styles.linkBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export function PlatformAccountSection() {
  const router = useRouter();
  const prefs = usePlatformPreferences(true);
  const { updateNotifications, updateLanguage, deleteAccount } =
    usePlatformAccountMutations();
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteOtp, setDeleteOtp] = useState<string | null>(null);

  const notifications = prefs.data?.notifications;
  const language = prefs.data?.language ?? 'en';
  const languages = prefs.data?.languages ?? ['en', 'hi'];

  const patchNotifications = async (next: NotificationPrefs) => {
    setPrefsError(null);
    try {
      await updateNotifications.mutateAsync(next);
    } catch (err) {
      setPrefsError(formatAccountError(err, 'Could not save notification prefs.'));
    }
  };

  const onLanguage = async (code: string) => {
    setPrefsError(null);
    try {
      await updateLanguage.mutateAsync(code);
    } catch (err) {
      setPrefsError(formatAccountError(err, 'Could not save language.'));
    }
  };

  const onDelete = () => {
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
    );
  };

  const runDeletePreview = async () => {
    setDeleting(true);
    try {
      const preview = await userAccountApi.getDeletePreview();
      const lines = [
        preview.warn?.trim() || null,
        preview.openOrders
          ? `${preview.openOrders} open order(s)`
          : 'No open customer orders',
        `Wallet ${formatCurrency(preview.walletBalance, 'INR')}`,
        preview.activeSubscription ? 'Active subscription on file' : null,
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

      Alert.alert('This will permanently delete your account', lines, [
        { text: 'Keep account', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => void confirmDelete(),
        },
      ]);
    } catch (err) {
      Alert.alert(
        'Could not load delete preview',
        formatAccountError(err, 'Try again.')
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
      await deleteAccount.mutateAsync(otp ? { otp } : undefined);
      setDeleteOtp(null);
      await clearSession();
      router.replace('/login');
    } catch (err) {
      if (getApiErrorCode(err) === 'OTP_REQUIRED' && !otp) {
        try {
          const me = useAuthStore.getState().user;
          const identifier = me?.phone || me?.email;
          if (!identifier) throw err;
          await sendOtp({
            emailOrPhone: identifier,
            purpose: 'delete_account',
          });
          setDeleteOtp('');
        } catch (otpErr) {
          Alert.alert(
            'Could not delete account',
            formatAccountError(otpErr, formatAccountError(err, 'Try again.'))
          );
        }
        return;
      }
      Alert.alert(
        'Could not delete account',
        formatAccountError(err, 'Try again.')
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Globe color="#EA4B14" size={16} />
        <Text style={styles.sectionTitle}>App preferences</Text>
      </View>

      {prefs.isLoading && !prefs.data ? (
        <ActivityIndicator color="#EA4B14" style={{ marginVertical: 12 }} />
      ) : prefs.isError && !prefs.data ? (
        <Pressable onPress={() => void prefs.refetch()} style={styles.retry}>
          <Text style={styles.retryText}>
            {formatAccountError(prefs.error, 'Could not load preferences. Retry')}
          </Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.label}>Language</Text>
          <View style={styles.langRow}>
            {languages.map((code) => {
              const on = language === code;
              return (
                <Pressable
                  key={code}
                  onPress={() => void onLanguage(code)}
                  disabled={updateLanguage.isPending}
                  style={[styles.langChip, on && styles.langChipOn]}
                >
                  <Text style={[styles.langText, on && styles.langTextOn]}>
                    {languageLabel(code)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Notifications</Text>
          <PrefToggle
            icon={Bell}
            label="Push"
            hint="Order offers and duty alerts"
            value={notifications?.push ?? true}
            disabled={updateNotifications.isPending}
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
            disabled={updateNotifications.isPending}
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
            hint="Receipts and verification mail"
            value={notifications?.email ?? true}
            disabled={updateNotifications.isPending}
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
      {prefsError ? <Text style={styles.error}>{prefsError}</Text> : null}

      <View style={styles.divider} />

      <Pressable
        onPress={onDelete}
        disabled={deleting}
        style={styles.deleteRow}
      >
        {deleting ? (
          <ActivityIndicator color="#B91C1C" />
        ) : (
          <>
            <View style={styles.deleteIcon}>
              <Trash2 color="#B91C1C" size={16} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.deleteLabel}>Delete account</Text>
              <Text style={styles.deleteHint}>
                Preview what you’ll lose, then confirm
              </Text>
            </View>
            <ShieldCheck color="#FECACA" size={16} />
          </>
        )}
      </Pressable>

      <Modal
        visible={deleteOtp != null}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteOtp(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={() => setDeleteOtp(null)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Confirm deletion</Text>
            <Text style={styles.sheetHint}>
              Enter the OTP sent to your phone or email.
            </Text>
            <TextInput
              value={deleteOtp ?? ''}
              onChangeText={(text) =>
                setDeleteOtp(text.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="6-digit OTP"
              placeholderTextColor="#9CA3AF"
              keyboardType="number-pad"
              style={styles.input}
            />
            <Pressable
              onPress={() => void confirmDelete(deleteOtp ?? '')}
              disabled={deleting}
              style={styles.primaryBtn}
            >
              {deleting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryBtnText}>Delete account</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setDeleteOtp(null)} style={styles.linkBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
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
      <Icon color="#64748B" size={16} />
      <View style={{ flex: 1 }}>
        <Text style={styles.prefLabel}>{label}</Text>
        <Text style={styles.prefHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: '#E5E7EB', true: '#FDBA74' }}
        thumbColor={value ? '#EA4B14' : '#F9FAFB'}
      />
    </View>
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
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  langChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F3F4F6',
  },
  langChipOn: { backgroundColor: '#FFF7ED' },
  langText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#475569' },
  langTextOn: { color: '#C2410C' },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  prefLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: '#111827' },
  prefHint: { fontFamily: fonts.medium, fontSize: 11, color: '#6B7280' },
  error: {
    marginTop: 8,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#B91C1C',
  },
  retry: { paddingVertical: 8 },
  retryText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#EA4B14' },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F3F4F6',
    marginVertical: 14,
  },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deleteIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLabel: { fontFamily: fonts.semiBold, fontSize: 14, color: '#B91C1C' },
  deleteHint: { fontFamily: fonts.medium, fontSize: 12, color: '#9CA3AF' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000066' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    gap: 10,
  },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 18, color: '#111827' },
  sheetHint: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: '#111827',
  },
  primaryBtn: {
    backgroundColor: '#EA4B14',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { fontFamily: fonts.bold, fontSize: 15, color: '#FFFFFF' },
  linkBtn: { alignItems: 'center', paddingVertical: 6 },
  linkText: { fontFamily: fonts.semiBold, fontSize: 13, color: '#EA4B14' },
  cancelText: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
});
