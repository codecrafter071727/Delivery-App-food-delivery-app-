import { CheckCircle2, Mail, Phone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authApi, formatAuthError } from '@/lib/auth/api';
import { theme } from '@/constants/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_RE = /^\+[1-9]\d{1,14}$/;

export function isValidSignupEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidSignupPhone(value: string): boolean {
  return E164_RE.test(value.trim());
}

export function isStrongSignupPassword(value: string): boolean {
  return (
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

type SignupContactVerifyProps = {
  email: string;
  phone: string;
  onEmailChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  emailVerified: boolean;
  phoneVerified: boolean;
  onEmailVerifiedChange: (verified: boolean) => void;
  onPhoneVerifiedChange: (verified: boolean) => void;
  disabled?: boolean;
  emailError?: string;
  phoneError?: string;
};

/**
 * Email + phone fields with send/confirm OTP for partner signup.
 * Uses existing user-service email SMTP + SMS OTP (purpose=register).
 */
export function SignupContactVerify({
  email,
  phone,
  onEmailChange,
  onPhoneChange,
  emailVerified,
  phoneVerified,
  onEmailVerifiedChange,
  onPhoneVerifiedChange,
  disabled,
  emailError,
  phoneError,
}: SignupContactVerifyProps) {
  const [emailOtp, setEmailOtp] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [phoneSent, setPhoneSent] = useState(false);
  const [busy, setBusy] = useState<'email-send' | 'email-ok' | 'phone-send' | 'phone-ok' | null>(
    null
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setEmailSent(false);
    setEmailOtp('');
  }, [email]);

  useEffect(() => {
    setPhoneSent(false);
    setPhoneOtp('');
  }, [phone]);

  const send = async (channel: 'email' | 'phone') => {
    setLocalError(null);
    const identifier =
      channel === 'email' ? email.trim().toLowerCase() : phone.trim();
    if (channel === 'email' && !isValidSignupEmail(identifier)) {
      setLocalError('Enter a valid email before sending OTP.');
      return;
    }
    if (channel === 'phone' && !isValidSignupPhone(identifier)) {
      setLocalError('Use E.164 phone format, e.g. +919876543210');
      return;
    }
    setBusy(channel === 'email' ? 'email-send' : 'phone-send');
    try {
      await authApi.sendOtp({ emailOrPhone: identifier, purpose: 'register' });
      if (channel === 'email') setEmailSent(true);
      else setPhoneSent(true);
    } catch (err) {
      setLocalError(formatAuthError(err, 'Could not send OTP'));
    } finally {
      setBusy(null);
    }
  };

  const confirm = async (channel: 'email' | 'phone') => {
    setLocalError(null);
    const identifier =
      channel === 'email' ? email.trim().toLowerCase() : phone.trim();
    const otp = channel === 'email' ? emailOtp.trim() : phoneOtp.trim();
    if (!/^\d{6}$/.test(otp)) {
      setLocalError('Enter the 6-digit OTP.');
      return;
    }
    setBusy(channel === 'email' ? 'email-ok' : 'phone-ok');
    try {
      await authApi.confirmRegisterOtp({ emailOrPhone: identifier, otp });
      if (channel === 'email') {
        onEmailVerifiedChange(true);
        setEmailOtp('');
      } else {
        onPhoneVerifiedChange(true);
        setPhoneOtp('');
      }
    } catch (err) {
      setLocalError(formatAuthError(err, 'OTP verification failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: 4 }}>
      <AuthBanner type="error" message={localError} />

      <AuthField
        label="Email *"
        icon={Mail}
        placeholder="you@email.com"
        autofill="email"
        value={email}
        editable={!disabled}
        onChangeText={(v) => {
          onEmailChange(v);
          if (emailVerified) onEmailVerifiedChange(false);
        }}
        errorText={emailError}
        labelAccessory={
          emailVerified ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={14} color={theme.success} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.success }}>
                Verified
              </Text>
            </View>
          ) : undefined
        }
      />
      {!emailVerified ? (
        <View style={{ gap: 8, marginBottom: 8 }}>
          <PrimaryButton
            label={emailSent ? 'Resend email OTP' : 'Send email OTP'}
            variant="outline"
            loading={busy === 'email-send'}
            disabled={disabled || Boolean(busy)}
            onPress={() => void send('email')}
          />
          {emailSent ? (
            <>
              <AuthField
                label="Email OTP"
                placeholder="6-digit code"
                autofill="oneTimeCode"
                keyboardType="number-pad"
                maxLength={6}
                value={emailOtp}
                onChangeText={setEmailOtp}
              />
              <PrimaryButton
                label="Verify email"
                loading={busy === 'email-ok'}
                disabled={disabled || Boolean(busy)}
                onPress={() => void confirm('email')}
              />
            </>
          ) : null}
        </View>
      ) : null}

      <AuthField
        label="Phone *"
        icon={Phone}
        placeholder="+919876543210"
        autofill="telephone"
        value={phone}
        editable={!disabled}
        onChangeText={(v) => {
          onPhoneChange(v);
          if (phoneVerified) onPhoneVerifiedChange(false);
        }}
        errorText={phoneError}
        labelAccessory={
          phoneVerified ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <CheckCircle2 size={14} color={theme.success} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: theme.success }}>
                Verified
              </Text>
            </View>
          ) : undefined
        }
      />
      <Text className="mb-2 -mt-1 text-xs text-secondary-light">
        Use E.164 format, e.g. +919876543210. Both contacts must be verified
        before create.
      </Text>
      {!phoneVerified ? (
        <View style={{ gap: 8, marginBottom: 8 }}>
          <PrimaryButton
            label={phoneSent ? 'Resend SMS OTP' : 'Send SMS OTP'}
            variant="outline"
            loading={busy === 'phone-send'}
            disabled={disabled || Boolean(busy)}
            onPress={() => void send('phone')}
          />
          {phoneSent ? (
            <>
              <AuthField
                label="SMS OTP"
                placeholder="6-digit code"
                autofill="oneTimeCode"
                keyboardType="number-pad"
                maxLength={6}
                value={phoneOtp}
                onChangeText={setPhoneOtp}
              />
              <PrimaryButton
                label="Verify phone"
                loading={busy === 'phone-ok'}
                disabled={disabled || Boolean(busy)}
                onPress={() => void confirm('phone')}
              />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
