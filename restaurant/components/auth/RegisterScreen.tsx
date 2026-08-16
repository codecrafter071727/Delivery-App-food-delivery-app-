import { useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, Mail, Phone, User, UserPlus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { DeliveryRegisterWizard } from '@/components/delivery/auth/RegisterWizard';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RoleSelector } from '@/components/auth/RoleSelector';
import { AuthShell } from '@/components/auth/AuthShell';
import { useAuthStore } from '@/store/auth-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const inviteToken = useMemo(() => {
    const raw = params.token;
    return typeof raw === 'string' ? raw.trim() : '';
  }, [params.token]);

  const role = useAuthStore((s) => s.role);
  const setRole = useAuthStore((s) => s.setRole);
  const register = useAuthStore((s) => s.register);
  const isLoading = useAuthStore((s) => s.isLoading);

  useEffect(() => {
    if (inviteToken) setRole('delivery');
  }, [inviteToken, setRole]);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (firstName.trim().length < 2) next.firstName = 'Enter your first name';
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address';
    if (phone && phone.replace(/\D/g, '').length < 10)
      next.phone = 'Enter a valid phone number';
    if (password.length < 6)
      next.password = 'Password must be at least 6 characters';
    if (password !== confirmPassword)
      next.confirmPassword = 'Passwords do not match';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleRegister = async () => {
    setError(null);
    if (!validate()) return;

    const normalizedEmail = email.trim().toLowerCase();

    try {
      await register({
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        email: normalizedEmail,
        phone: phone.trim() || undefined,
        password,
        confirmPassword,
        role,
      });
      await useAuthStore.getState().clearSession();
      router.replace({
        pathname: '/login',
        params: { registered: '1', email: normalizedEmail, role: 'restaurant' },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  const isDelivery = role === 'delivery' || Boolean(inviteToken);

  return (
    <AuthShell
      title={isDelivery ? 'Join as Delivery Partner' : 'Create account'}
      subtitle={
        isDelivery
          ? inviteToken
            ? 'Validating your restaurant invitation and completing partner signup.'
            : 'Complete the steps below to register and start delivering.'
          : 'Join as a partner and start earning with us.'
      }
      showBack
      footer={
        <View className="flex-row items-center justify-center">
          <Text className="text-sm text-secondary-light">
            Already a partner?{' '}
          </Text>
          <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
            <Text className="text-sm font-bold text-primary">Sign in</Text>
          </Pressable>
        </View>
      }
    >
      {isDelivery ? (
        <DeliveryRegisterWizard />
      ) : (
        <>
          <RoleSelector value={role} onChange={setRole} disabled={isLoading} />

          <AuthBanner type="error" message={error} />

          <View className="flex-row gap-3">
            <View className="flex-1">
              <AuthField
                label="First name"
                icon={User}
                placeholder="John"
                autofill="givenName"
                value={firstName}
                onChangeText={setFirstName}
                errorText={fieldErrors.firstName}
              />
            </View>
            <View className="flex-1">
              <AuthField
                label="Last name"
                placeholder="Doe"
                autofill="familyName"
                value={lastName}
                onChangeText={setLastName}
              />
            </View>
          </View>

          <AuthField
            label="Email"
            icon={Mail}
            placeholder="you@email.com"
            autofill="email"
            value={email}
            onChangeText={setEmail}
            errorText={fieldErrors.email}
          />
          <AuthField
            label="Phone"
            icon={Phone}
            placeholder="+919876543210"
            autofill="telephone"
            value={phone}
            onChangeText={setPhone}
            errorText={fieldErrors.phone}
          />
          <AuthField
            label="Password"
            icon={Lock}
            placeholder="At least 6 characters"
            secure
            autofill="newPassword"
            value={password}
            onChangeText={setPassword}
            errorText={fieldErrors.password}
          />
          <AuthField
            label="Confirm password"
            icon={Lock}
            placeholder="Re-enter password"
            secure
            autofill="newPassword"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            errorText={fieldErrors.confirmPassword}
          />

          <PrimaryButton
            label="Create account"
            icon={UserPlus}
            onPress={() => void handleRegister()}
            loading={isLoading}
          />
        </>
      )}
    </AuthShell>
  );
}
