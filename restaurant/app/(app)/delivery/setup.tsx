import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { AuthShell } from '@/components/auth/AuthShell';
import { DeliveryRegisterWizard } from '@/components/delivery/auth/RegisterWizard';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { deliveryPartnerApi } from '@/lib/delivery-partner/api';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import { markDeliveryPartnerSetupComplete } from '@/lib/navigation/post-auth';
import { useAuthStore } from '@/store/auth-store';

/**
 * Shown when GET /partners/me is 404 for this login.
 * If the rider already exists in admin, that is almost always a different login —
 * do not create a second rider profile.
 */
export default function DeliverySetupRoute() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const [checking, setChecking] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const onRetry = async () => {
    setChecking(true);
    setHint(null);
    try {
      const me = await deliveryPartnerApi.getMe();
      if (me?.id) {
        await markDeliveryPartnerSetupComplete(me.id);
        router.replace(DELIVERY_ROUTES.home);
        return;
      }
      setHint(
        'Still no rider linked to this login. If admin already shows you as active, log out and sign in with that same delivery email/phone — do not create a new rider.'
      );
    } catch {
      setHint('Could not reach the server. Check your connection and try again.');
    } finally {
      setChecking(false);
    }
  };

  const onLogout = async () => {
    await clearSession();
    router.replace({
      pathname: '/login',
      params: { role: 'delivery' },
    } as never);
  };

  if (showForm) {
    return (
      <AuthShell
        title="New delivery profile"
        subtitle="Only for first-time riders. Skip this if you already appear in the admin rider list."
      >
        <DeliveryRegisterWizard profileOnly />
        <Pressable onPress={() => setShowForm(false)} style={{ marginTop: 8, padding: 8 }}>
          <Text
            style={{
              color: authTheme.textMuted,
              fontFamily: fonts.medium,
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            Back
          </Text>
        </Pressable>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Rider already in admin?"
      subtitle="You do not need to sign up again if your rider is active in the admin panel."
    >
      <View style={{ gap: 14 }}>
        <Text
          style={{
            color: authTheme.text,
            fontFamily: fonts.medium,
            fontSize: 14,
            lineHeight: 21,
          }}
        >
          Duty uses the rider profile linked to this exact login
          {user?.email ? ` (${user.email})` : ''}
          {user?.phone ? ` · ${user.phone}` : ''}. Admin can show a rider that was created under a
          different account (or a restaurant login).
        </Text>

        <Text
          style={{
            color: authTheme.textMuted,
            fontFamily: fonts.regular,
            fontSize: 13,
            lineHeight: 19,
          }}
        >
          1. Tap “Check again” after confirming you used the delivery account.{'\n'}
          2. Or log out and sign in with Delivery role + the email/phone on that rider.{'\n'}
          3. Only create a new profile if you have never registered as a rider.
        </Text>

        {hint ? (
          <Text
            style={{
              color: authTheme.brand,
              fontFamily: fonts.medium,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            {hint}
          </Text>
        ) : null}

        {checking ? (
          <ActivityIndicator color={authTheme.brand} />
        ) : (
          <PrimaryButton label="Check again" onPress={() => void onRetry()} />
        )}

        <PrimaryButton label="Log out and switch account" onPress={() => void onLogout()} />

        <Pressable onPress={() => setShowForm(true)} style={{ paddingVertical: 10 }}>
          <Text
            style={{
              color: authTheme.textMuted,
              fontFamily: fonts.medium,
              fontSize: 13,
              textAlign: 'center',
              textDecorationLine: 'underline',
            }}
          >
            I’m a brand-new rider — create profile
          </Text>
        </Pressable>
      </View>
    </AuthShell>
  );
}
