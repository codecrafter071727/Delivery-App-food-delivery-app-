import { useRouter } from 'expo-router';
import { ArrowLeft, Mail, Send } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuthStore } from '@/store/auth-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordScreen() {
  const router = useRouter();
  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!EMAIL_RE.test(email.trim())) {
      setFieldError('Enter a valid email address');
      return;
    }
    setFieldError(undefined);
    try {
      const message = await forgotPassword({ email: email.trim().toLowerCase() });
      setSuccess(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link');
    }
  };

  return (
    <AuthShell
      title="Reset password"
      subtitle="We'll email you a secure reset link."
      showBack
      footer={
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="flex-row items-center justify-center gap-1.5"
        >
          <ArrowLeft color="#9E1B32" size={16} />
          <Text className="text-sm font-bold text-primary">Back to sign in</Text>
        </Pressable>
      }
    >
      <AuthBanner type="error" message={error} />
      <AuthBanner type="success" message={success} />

      <AuthField
        label="Email"
        icon={Mail}
        placeholder="you@business.com"
        autofill="email"
        value={email}
        onChangeText={setEmail}
        errorText={fieldError}
      />

      <View className="mt-2">
        <PrimaryButton
          label="Send reset link"
          icon={Send}
          onPress={handleSubmit}
          loading={isLoading}
        />
      </View>

      {success ? (
        <Pressable
          onPress={() => router.push('/reset-password')}
          className="mt-4"
          hitSlop={8}
        >
          <Text className="text-center text-sm font-semibold text-primary">
            Already have a reset token? Enter it here
          </Text>
        </Pressable>
      ) : null}
    </AuthShell>
  );
}
