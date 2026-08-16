import { useRouter } from 'expo-router';
import { ArrowLeft, MessageSquareCode, ShieldCheck, Smartphone } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RoleSelector } from '@/components/auth/RoleSelector';
import { AuthShell } from '@/components/auth/AuthShell';
import { getApiErrorCode } from '@/lib/errors';
import { resolvePostAuthRoute } from '@/lib/navigation/post-auth';
import { useAuthStore } from '@/store/auth-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeIdentifier(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  if (EMAIL_RE.test(value)) return value.toLowerCase();
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (value.startsWith('+')) return value;
  return value;
}

export function VerifyOtpScreen() {
  const router = useRouter();
  const role = useAuthStore((s) => s.role);
  const setRole = useAuthStore((s) => s.setRole);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const resendOtp = useAuthStore((s) => s.resendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const applyCooldown = (seconds: number, err?: unknown) => {
    if (seconds > 0) {
      setCooldown(seconds);
      return;
    }
    if (getApiErrorCode(err) === 'OTP_COOLDOWN') {
      setCooldown(30);
    }
  };

  const handleSend = async () => {
    setError(null);
    setSuccess(null);
    const id = normalizeIdentifier(identifier);
    if (id.length < 4) {
      setError('Enter your phone number or email');
      return;
    }
    try {
      const result = await sendOtp({
        emailOrPhone: id,
        purpose: 'login',
      });
      setSuccess(
        result.message ||
          'OTP sent. It never appears on this screen — check SMS or email.'
      );
      setStep('verify');
      applyCooldown(result.cooldownSeconds);
    } catch (err) {
      applyCooldown(0, err);
      setError(err instanceof Error ? err.message : 'Failed to send OTP');
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setError(null);
    setSuccess(null);
    const id = normalizeIdentifier(identifier);
    try {
      const result = await resendOtp({
        emailOrPhone: id,
        purpose: 'login',
      });
      setSuccess(result.message || 'A new OTP was sent.');
      applyCooldown(result.cooldownSeconds);
    } catch (err) {
      applyCooldown(0, err);
      setError(err instanceof Error ? err.message : 'Failed to resend OTP');
    }
  };

  const handleVerify = async () => {
    setError(null);
    if (otp.trim().length < 4) {
      setError('Enter the 6-digit OTP sent to you');
      return;
    }
    try {
      await verifyOtp({
        emailOrPhone: normalizeIdentifier(identifier),
        otp: otp.trim(),
        role,
        purpose: 'login',
      });
      const userRole = useAuthStore.getState().user?.role ?? role;
      const target = await resolvePostAuthRoute(userRole);
      router.replace(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTP verification failed');
    }
  };

  return (
    <AuthShell
      title="OTP sign in"
      subtitle={
        step === 'request'
          ? role === 'delivery'
            ? 'Enter your registered mobile number. We’ll send a one-time code — same as Swiggy / Zomato partner login.'
            : 'Get a one-time code on your phone or email.'
          : `Enter the code sent to ${normalizeIdentifier(identifier)}`
      }
      showBack
      footer={
        <Pressable
          onPress={() => router.replace('/login')}
          hitSlop={8}
          className="flex-row items-center justify-center gap-1.5"
        >
          <ArrowLeft color="#FF6B35" size={16} />
          <Text className="text-sm font-bold text-primary">
            Back to password sign in
          </Text>
        </Pressable>
      }
    >
      <RoleSelector value={role} onChange={setRole} disabled={isLoading} />

      <AuthBanner type="error" message={error} />
      <AuthBanner type="success" message={success} />

      {step === 'request' ? (
        <>
          <AuthField
            label={role === 'delivery' ? 'Mobile number' : 'Email or phone'}
            icon={Smartphone}
            placeholder={
              role === 'delivery' ? '9876543210' : 'you@business.com or 9876543210'
            }
            keyboardType={role === 'delivery' ? 'phone-pad' : 'default'}
            autoCapitalize="none"
            value={identifier}
            onChangeText={setIdentifier}
          />
          <View className="mt-2">
            <PrimaryButton
              label="Send OTP"
              icon={MessageSquareCode}
              onPress={handleSend}
              loading={isLoading}
            />
          </View>
        </>
      ) : (
        <>
          <AuthField
            label="OTP code"
            icon={ShieldCheck}
            placeholder="6-digit code"
            keyboardType="number-pad"
            value={otp}
            onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 6))}
          />
          <View className="mt-2">
            <PrimaryButton
              label="Verify & continue"
              icon={ShieldCheck}
              onPress={handleVerify}
              loading={isLoading}
            />
          </View>
          <Pressable
            onPress={() => void handleResend()}
            disabled={isLoading || cooldown > 0}
            className="mt-4"
            hitSlop={8}
          >
            <Text
              className="text-center text-sm font-semibold"
              style={{ color: cooldown > 0 ? '#9CA3AF' : '#EA4B14' }}
            >
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setStep('request');
              setOtp('');
              setSuccess(null);
              setError(null);
            }}
            className="mt-3"
            hitSlop={8}
          >
            <Text className="text-center text-sm font-medium text-secondary-light">
              Use a different number
            </Text>
          </Pressable>
        </>
      )}
    </AuthShell>
  );
}
