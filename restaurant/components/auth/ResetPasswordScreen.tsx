import { useLocalSearchParams, useRouter } from 'expo-router';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuthStore } from '@/store/auth-store';

export function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [token, setToken] = useState(params.token ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (!token.trim()) next.token = 'Enter the reset token from your email';
    if (password.length < 6)
      next.password = 'Password must be at least 6 characters';
    if (password !== confirmPassword)
      next.confirmPassword = 'Passwords do not match';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!validate()) return;
    try {
      const message = await resetPassword({
        token: token.trim(),
        password,
        confirmPassword,
      });
      setSuccess(`${message}. Redirecting to sign in…`);
      setTimeout(() => router.replace('/login'), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    }
  };

  return (
    <AuthShell
      title="Set new password"
      subtitle="Enter the token from your email and a new password."
      showBack
      footer={
        <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
          <Text className="text-center text-sm font-bold text-primary">
            Back to sign in
          </Text>
        </Pressable>
      }
    >
      <AuthBanner type="error" message={error} />
      <AuthBanner type="success" message={success} />

      <AuthField
        label="Reset token"
        icon={KeyRound}
        placeholder="Paste token from email"
        autofill="off"
        autoCapitalize="none"
        value={token}
        onChangeText={setToken}
        errorText={fieldErrors.token}
      />

      <AuthField
        label="New password"
        icon={Lock}
        placeholder="At least 6 characters"
        secure
        autofill="newPassword"
        value={password}
        onChangeText={setPassword}
        errorText={fieldErrors.password}
      />

      <AuthField
        label="Confirm new password"
        icon={Lock}
        placeholder="Re-enter password"
        secure
        autofill="newPassword"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        errorText={fieldErrors.confirmPassword}
      />

      <View className="mt-2">
        <PrimaryButton
          label="Reset password"
          icon={ShieldCheck}
          onPress={handleSubmit}
          loading={isLoading}
        />
      </View>
    </AuthShell>
  );
}
