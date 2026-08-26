import { useLocalSearchParams, useRouter } from 'expo-router';
import { Lock, User, UserPlus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { DeliveryRegisterWizard } from '@/components/delivery/auth/RegisterWizard';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RoleSelector } from '@/components/auth/RoleSelector';
import {
  SignupContactVerify,
  isStrongSignupPassword,
  isValidSignupEmail,
  isValidSignupPhone,
} from '@/components/auth/SignupContactVerify';
import { AuthShell } from '@/components/auth/AuthShell';
import { formatAuthError } from '@/lib/auth/api';
import { useAuthStore } from '@/store/auth-store';

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
  const [emailVerified, setEmailVerified] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (firstName.trim().length < 2) next.firstName = 'Enter your first name';
    if (!isValidSignupEmail(email)) next.email = 'Enter a valid email address';
    if (!isValidSignupPhone(phone))
      next.phone = 'Use E.164 format, e.g. +919876543210';
    if (!emailVerified) next.email = 'Verify your email with OTP';
    if (!phoneVerified) next.phone = 'Verify your phone with OTP';
    if (!isStrongSignupPassword(password)) {
      next.password =
        'Min 8 chars with upper, lower, digit, and special character';
    }
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
        phone: phone.trim(),
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
      setError(formatAuthError(err, 'Registration failed'));
    }
  };

  const isDelivery = role === 'delivery' || Boolean(inviteToken);
  const canCreate = emailVerified && phoneVerified && !isLoading;

  return (
    <AuthShell
      title={isDelivery ? 'Join as Delivery Partner' : 'Create account'}
      subtitle={
        isDelivery
          ? inviteToken
            ? 'Validating your restaurant invitation and completing partner signup.'
            : 'Complete the steps below to register and start delivering.'
          : 'Verify email and phone with OTP, then create your partner account.'
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

          <SignupContactVerify
            email={email}
            phone={phone}
            onEmailChange={setEmail}
            onPhoneChange={setPhone}
            emailVerified={emailVerified}
            phoneVerified={phoneVerified}
            onEmailVerifiedChange={setEmailVerified}
            onPhoneVerifiedChange={setPhoneVerified}
            disabled={isLoading}
            emailError={fieldErrors.email}
            phoneError={fieldErrors.phone}
          />

          <AuthField
            label="Password"
            icon={Lock}
            placeholder="8+ chars, mixed case, digit, symbol"
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
            disabled={!canCreate}
          />
          {!canCreate ? (
            <Text className="text-center text-xs text-secondary-light">
              Verify both email and phone OTP to enable Create account.
            </Text>
          ) : null}
        </>
      )}
    </AuthShell>
  );
}
