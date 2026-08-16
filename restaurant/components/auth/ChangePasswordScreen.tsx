import { Lock, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuthStore } from '@/store/auth-store';

export function ChangePasswordScreen() {
  const changePassword = useAuthStore((s) => s.changePassword);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (oldPassword.length < 6) next.oldPassword = 'Enter your current password';
    if (newPassword.length < 6)
      next.newPassword = 'Password must be at least 6 characters';
    if (newPassword !== confirmPassword)
      next.confirmPassword = 'Passwords do not match';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!validate()) return;
    try {
      const message = await changePassword({
        oldPassword,
        newPassword,
        confirmPassword,
      });
      setSuccess(message);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    }
  };

  return (
    <AuthShell
      title="Change password"
      subtitle="Update the password for your partner account."
      showBack
    >
      <AuthBanner type="error" message={error} />
      <AuthBanner type="success" message={success} />

      <AuthField
        label="Current password"
        icon={Lock}
        placeholder="Enter current password"
        secure
        autofill="currentPassword"
        value={oldPassword}
        onChangeText={setOldPassword}
        errorText={fieldErrors.oldPassword}
      />

      <AuthField
        label="New password"
        icon={Lock}
        placeholder="At least 6 characters"
        secure
        autofill="newPassword"
        value={newPassword}
        onChangeText={setNewPassword}
        errorText={fieldErrors.newPassword}
      />

      <AuthField
        label="Confirm new password"
        icon={Lock}
        placeholder="Re-enter new password"
        secure
        autofill="newPassword"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        errorText={fieldErrors.confirmPassword}
      />

      <View className="mt-2">
        <PrimaryButton
          label="Update password"
          icon={ShieldCheck}
          onPress={handleSubmit}
          loading={isLoading}
        />
      </View>
    </AuthShell>
  );
}
