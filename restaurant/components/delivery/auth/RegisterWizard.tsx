import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Lock, Mail, Phone, User } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthField } from '@/components/auth/AuthField';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RoleSelector } from '@/components/auth/RoleSelector';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { deliveryPartnerApi } from '@/lib/delivery-partner/api';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import {
  VEHICLE_TYPE_OPTIONS,
  type PartnerInviteValidation,
  type VehicleType,
} from '@/lib/delivery-partner/types';
import { getApiErrorMessage } from '@/lib/errors';
import { markDeliveryPartnerSetupComplete } from '@/lib/navigation/post-auth';
import { useAuthStore } from '@/store/auth-store';

const STEPS = ['Personal', 'Address', 'Vehicle', 'Verification'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormState = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  password: string;
  confirmPassword: string;
  address: string;
  city: string;
  state: string;
  vehicleType: VehicleType | '';
  vehicleNumber: string;
  aadharNumber: string;
  acceptedTerms: boolean;
};

const INITIAL: FormState = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  password: '',
  confirmPassword: '',
  address: '',
  city: '',
  state: '',
  vehicleType: '',
  vehicleNumber: '',
  aadharNumber: '',
  acceptedTerms: false,
};

function isE164(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

type Props = {
  /** When true, account already exists — skip email/password and only finish partner profile. */
  profileOnly?: boolean;
};

export function DeliveryRegisterWizard({ profileOnly = false }: Props) {
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
  const authUser = useAuthStore((s) => s.user);

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL,
    firstName: authUser?.firstName ?? '',
    lastName: authUser?.lastName ?? '',
    phone: authUser?.phone ?? '',
    email: authUser?.email ?? '',
  }));
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));
  const [invite, setInvite] = useState<PartnerInviteValidation | null>(null);

  const inviteBlocked =
    Boolean(inviteToken) && (inviteLoading || invite?.valid === false);

  useEffect(() => {
    if (!inviteToken) {
      setInvite(null);
      setInviteLoading(false);
      return;
    }

    let cancelled = false;
    setInviteLoading(true);
    setRole('delivery');

    void (async () => {
      try {
        const result = await deliveryPartnerApi.validateInvite(inviteToken);
        if (cancelled) return;
        setInvite(result);

        if (result.valid) {
          setForm((prev) => ({
            ...prev,
            email: prev.email || result.inviteEmail || '',
            phone: prev.phone || result.invitePhone || '',
          }));
        }
      } catch (err) {
        if (cancelled) return;
        setInvite({
          valid: false,
          token: inviteToken,
          message: getApiErrorMessage(
            err,
            'Could not validate this invitation link.'
          ),
        });
      } finally {
        if (!cancelled) setInviteLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteToken, setRole]);

  const patch = (partial: Partial<FormState>) =>
    setForm((prev) => ({ ...prev, ...partial }));

  const validateStep = (index: number): string | null => {
    if (index === 0) {
      if (form.firstName.trim().length < 2) return 'Enter your first name.';
      if (!form.phone.trim()) return 'Phone number is required.';
      if (!isE164(form.phone)) {
        return 'Use E.164 phone format, e.g. +919876543210';
      }
      if (!profileOnly) {
        if (!EMAIL_RE.test(form.email.trim())) {
          return 'Enter a valid email address.';
        }
        if (form.password.length < 6) {
          return 'Password must be at least 6 characters.';
        }
        if (form.password !== form.confirmPassword) {
          return 'Passwords do not match.';
        }
      }
      return null;
    }
    if (index === 2 && !form.vehicleType) {
      return 'Select a vehicle type.';
    }
    if (index === 3 && !form.acceptedTerms) {
      return 'Please agree to the Terms & Conditions.';
    }
    return null;
  };

  const goNext = () => {
    setError(null);
    const message = validateStep(step);
    if (message) {
      setError(message);
      return;
    }
    setVehicleOpen(false);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goPrev = () => {
    setError(null);
    setVehicleOpen(false);
    setStep((s) => Math.max(s - 1, 0));
  };

  const complete = async () => {
    setError(null);
    if (inviteToken && invite?.valid === false) {
      setError(
        invite.message ||
          'This invitation is invalid. Ask the restaurant for a new invite link.'
      );
      return;
    }
    if (inviteToken && inviteLoading) {
      setError('Still validating your invitation. Please wait.');
      return;
    }

    const message = validateStep(3);
    if (message) {
      setError(message);
      return;
    }
    if (!form.vehicleType) {
      setError('Select a vehicle type.');
      setStep(2);
      return;
    }

    setSubmitting(true);
    try {
      if (!profileOnly) {
        await register({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          password: form.password,
          confirmPassword: form.confirmPassword,
          role: 'delivery',
        });
      }

      const profile = await deliveryPartnerApi.register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
        phone: form.phone.trim(),
        email:
          (form.email || authUser?.email || '').trim().toLowerCase() ||
          undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        vehicleType: form.vehicleType,
        vehicleNumber: form.vehicleNumber.trim() || undefined,
        aadharNumber: form.aadharNumber.trim() || undefined,
        acceptedTerms: form.acceptedTerms,
        inviteToken: inviteToken || undefined,
      });

      await markDeliveryPartnerSetupComplete(profile.id);

      if (profileOnly) {
        router.replace(DELIVERY_ROUTES.home);
        return;
      }

      const email = form.email.trim().toLowerCase();
      await useAuthStore.getState().clearSession();
      router.replace({
        pathname: '/login',
        params: { registered: '1', email, role: 'delivery' },
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not complete registration'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || isLoading || inviteLoading;

  return (
    <View style={{ gap: 12 }}>
      {!profileOnly && !inviteToken ? (
        <RoleSelector
          value={role}
          onChange={setRole}
          disabled={busy}
        />
      ) : null}

      <Text
        style={{
          color: authTheme.textMuted,
          fontFamily: fonts.medium,
          fontSize: 13,
        }}
      >
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {STEPS.map((_, index) => (
          <View
            key={STEPS[index]}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              backgroundColor:
                index <= step ? authTheme.brand : '#E5E7EB',
            }}
          />
        ))}
      </View>

      {inviteToken ? (
        inviteLoading ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 8,
            }}
          >
            <ActivityIndicator color={authTheme.brand} />
            <Text
              style={{
                color: authTheme.textMuted,
                fontFamily: fonts.medium,
                fontSize: 13,
              }}
            >
              Validating restaurant invitation…
            </Text>
          </View>
        ) : invite?.valid ? (
          <AuthBanner
            type="success"
            message={
              invite.restaurantName
                ? `Invite verified for ${invite.restaurantName}. Finish registration to join.`
                : 'Restaurant invite verified — finish registration to accept.'
            }
          />
        ) : (
          <AuthBanner
            type="error"
            message={
              invite?.message ||
              'This invitation link is invalid or expired. Ask the restaurant for a new invite.'
            }
          />
        )
      ) : null}

      <AuthBanner type="error" message={error} />

      {inviteBlocked ? (
        <View style={{ gap: 12, paddingVertical: 8 }}>
          {!inviteLoading ? (
            <>
              <Text
                style={{
                  color: authTheme.textMuted,
                  fontFamily: fonts.medium,
                  fontSize: 13,
                  lineHeight: 18,
                }}
              >
                You can still register without an invite, or ask the restaurant
                to send a fresh invitation email.
              </Text>
              <PrimaryButton
                label="Register without invite"
                onPress={() =>
                  router.replace({
                    pathname: '/register',
                  })
                }
              />
            </>
          ) : null}
        </View>
      ) : null}

      {!inviteBlocked ? (
        <>
          {step === 0 ? (
        <View>
          <View className="flex-row gap-3">
            <View className="flex-1">
              <AuthField
                label="First name *"
                icon={User}
                placeholder="Rajesh"
                autofill="givenName"
                value={form.firstName}
                onChangeText={(firstName) => patch({ firstName })}
              />
            </View>
            <View className="flex-1">
              <AuthField
                label="Last name"
                placeholder="Kumar"
                autofill="familyName"
                value={form.lastName}
                onChangeText={(lastName) => patch({ lastName })}
              />
            </View>
          </View>
          <AuthField
            label="Phone number *"
            icon={Phone}
            placeholder="+919876543210"
            autofill="telephone"
            value={form.phone}
            onChangeText={(phone) => patch({ phone })}
          />
          <Text className="mb-3 -mt-2 text-xs text-secondary-light">
            Use E.164 format, e.g. +919876543210
          </Text>
          {!profileOnly ? (
            <>
              <AuthField
                label="Email *"
                icon={Mail}
                placeholder="you@email.com"
                autofill="email"
                value={form.email}
                onChangeText={(email) => patch({ email })}
              />
              <AuthField
                label="Password *"
                icon={Lock}
                placeholder="At least 6 characters"
                secure
                autofill="newPassword"
                value={form.password}
                onChangeText={(password) => patch({ password })}
              />
              <AuthField
                label="Confirm password *"
                icon={Lock}
                placeholder="Re-enter password"
                secure
                autofill="newPassword"
                value={form.confirmPassword}
                onChangeText={(confirmPassword) => patch({ confirmPassword })}
              />
            </>
          ) : null}
        </View>
      ) : null}

      {step === 1 ? (
        <View>
          <AuthField
            label="Address"
            placeholder="123, Main Street"
            value={form.address}
            onChangeText={(address) => patch({ address })}
          />
          <AuthField
            label="City"
            placeholder="Delhi"
            autoCapitalize="words"
            value={form.city}
            onChangeText={(city) => patch({ city })}
          />
          <AuthField
            label="State"
            placeholder="Delhi"
            autoCapitalize="words"
            value={form.state}
            onChangeText={(state) => patch({ state })}
          />
        </View>
      ) : null}

      {step === 2 ? (
        <View>
          <Text className="mb-1.5 text-sm font-semibold text-secondary">
            Vehicle type *
          </Text>
          <Pressable
            onPress={() => setVehicleOpen((v) => !v)}
            className="mb-3 h-12 justify-center rounded-xl border border-gray-200 bg-white px-3.5"
          >
            <Text
              className={`text-[15px] ${
                form.vehicleType ? 'text-secondary' : 'text-secondary-light'
              }`}
            >
              {VEHICLE_TYPE_OPTIONS.find((o) => o.value === form.vehicleType)
                ?.label ?? 'Select vehicle type'}
            </Text>
          </Pressable>
          {vehicleOpen ? (
            <View className="mb-4 overflow-hidden rounded-xl border border-gray-200">
              {VEHICLE_TYPE_OPTIONS.map((option) => {
                const active = option.value === form.vehicleType;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      patch({ vehicleType: option.value });
                      setVehicleOpen(false);
                    }}
                    className={`px-3.5 py-3 ${
                      active ? 'bg-primary/10' : 'bg-white'
                    }`}
                  >
                    <Text
                      className={`text-sm ${
                        active
                          ? 'font-bold text-primary'
                          : 'font-medium text-secondary'
                      }`}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <AuthField
            label="Vehicle number"
            placeholder="DL-01-AB-1234"
            autoCapitalize="characters"
            value={form.vehicleNumber}
            onChangeText={(vehicleNumber) => patch({ vehicleNumber })}
          />
        </View>
      ) : null}

      {step === 3 ? (
        <View>
          <View className="mb-4 flex-row items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-3">
            <Check color="#16A34A" size={16} />
            <Text className="flex-1 text-sm font-semibold text-green-700">
              Almost there — agree to terms to complete registration.
            </Text>
          </View>
          <AuthField
            label="Aadhar number"
            placeholder="1234-5678-9999"
            keyboardType="number-pad"
            value={form.aadharNumber}
            onChangeText={(aadharNumber) => patch({ aadharNumber })}
          />
          <Pressable
            onPress={() => patch({ acceptedTerms: !form.acceptedTerms })}
            className="mt-1 flex-row items-start gap-3"
          >
            <View
              className={`mt-0.5 h-5 w-5 items-center justify-center rounded border ${
                form.acceptedTerms
                  ? 'border-primary bg-primary'
                  : 'border-gray-300 bg-white'
              }`}
            >
              {form.acceptedTerms ? (
                <Check color="#FFFFFF" size={12} />
              ) : null}
            </View>
            <Text className="flex-1 text-sm leading-5 text-secondary-light">
              I agree to the Terms & Conditions and Privacy Policy
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-2 flex-row gap-3">
        {step > 0 ? (
          <View className="flex-1">
            <PrimaryButton
              label="Previous"
              variant="outline"
              onPress={goPrev}
              disabled={busy}
            />
          </View>
        ) : null}
        <View className="flex-1">
          {step < STEPS.length - 1 ? (
            <PrimaryButton label="Next" onPress={goNext} disabled={busy} />
          ) : (
            <PrimaryButton
              label="Complete Registration"
              onPress={() => void complete()}
              loading={busy}
            />
          )}
        </View>
      </View>
        </>
      ) : null}
    </View>
  );
}
