import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronsRight, Lock, Mail } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthLoadingScreen } from '@/components/auth/AuthLoadingScreen';
import {
  AuthDivider,
  CheckboxRow,
  LegalFooter,
  SocialButtons,
} from '@/components/auth/AuthExtras';
import { AuthField } from '@/components/auth/AuthField';
import { RoleSelector } from '@/components/auth/RoleSelector';
import { useSocialSignIn } from '@/lib/auth/use-social-sign-in';
import { resolvePostAuthRoute } from '@/lib/navigation/post-auth';
import { useGatewayProbe } from '@/lib/gateway/hooks';
import { useAuthStore } from '@/store/auth-store';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginScreen() {
  const router = useRouter();
  const { registered, email: registeredEmail, role: registeredRole } =
    useLocalSearchParams<{
      registered?: string;
      email?: string;
      role?: string;
    }>();
  const role = useAuthStore((s) => s.role);
  const setRole = useAuthStore((s) => s.setRole);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const gateway = useGatewayProbe(true);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  const busy = isLoading || isRedirecting;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const sliderWidthRef = useRef(0);
  const pan = useRef(new Animated.ValueXY()).current;

  // We need to store the latest handleLogin in a ref so the PanResponder
  // doesn't close over the initial empty email and password strings.
  const handleLoginRef = useRef<() => void>(() => { });

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !busyRef.current,
      onMoveShouldSetPanResponder: () => !busyRef.current,
      onPanResponderMove: (e, gesture) => {
        if (busyRef.current) return;
        let newX = gesture.dx;
        const maxScroll = Math.max(0, sliderWidthRef.current - 56);
        if (newX < 0) newX = 0;
        if (newX > maxScroll) newX = maxScroll;
        pan.setValue({ x: newX, y: 0 });
      },
      onPanResponderRelease: (e, gesture) => {
        if (busyRef.current) return;
        const threshold = sliderWidthRef.current * 0.65;
        if (gesture.dx > threshold) {
          const maxScroll = Math.max(0, sliderWidthRef.current - 56);
          Animated.timing(pan, {
            toValue: { x: maxScroll, y: 0 },
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            handleLoginRef.current();
            setTimeout(() => {
              Animated.timing(pan, {
                toValue: { x: 0, y: 0 },
                duration: 300,
                useNativeDriver: true,
              }).start();
            }, 1000);
          });
        } else {
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    if (registered === '1') {
      const isDelivery = registeredRole === 'delivery' || role === 'delivery';
      setSuccess(
        isDelivery
          ? 'Account created successfully. Sign in to open your delivery dashboard.'
          : 'Account created successfully. Sign in to complete your restaurant profile.'
      );
      if (registeredRole === 'delivery' || registeredRole === 'restaurant') {
        setRole(registeredRole);
      }
      if (typeof registeredEmail === 'string' && registeredEmail) {
        setEmail(registeredEmail);
      }
    }
  }, [registered, registeredEmail, registeredRole, role, setRole]);

  const validate = () => {
    const next: typeof fieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address';
    if (password.length < 6) next.password = 'Password must be at least 6 characters';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleLogin = async () => {
    setError(null);
    setSuccess(null);
    if (!validate()) return;
    try {
      await login({ email: email.trim().toLowerCase(), password, role });
      setIsRedirecting(true);
      const userRole = useAuthStore.getState().user?.role ?? role;
      const target = await resolvePostAuthRoute(userRole);
      router.replace(target);
    } catch (err) {
      setIsRedirecting(false);
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  handleLoginRef.current = handleLogin;

  const finishSocial = useCallback(async () => {
    setIsRedirecting(true);
    try {
      const userRole = useAuthStore.getState().user?.role ?? role;
      const target = await resolvePostAuthRoute(userRole);
      router.replace(target);
    } catch {
      setIsRedirecting(false);
      setError('Signed in, but could not open your dashboard. Try again.');
    }
  }, [role, router]);

  const onSocialError = useCallback((message: string) => {
    setIsRedirecting(false);
    setError(message);
  }, []);

  const social = useSocialSignIn({
    role,
    onSuccess: finishSocial,
    onError: onSocialError,
  });
  const formBusy = busy || Boolean(social.busy);
  busyRef.current = formBusy;

  if (isRedirecting) {
    return <AuthLoadingScreen message="Signing you in…" />;
  }

  return (
    <View className="flex-1 bg-[#EA4B14]">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SafeAreaView edges={['top']} className="flex-1 justify-end">
            <View className="flex-1 px-6 pt-6 items-center justify-center">
              <Image 
                source={require('../../assets/tokajo-logo.png')} 
                style={{ width: 72, height: 72, borderRadius: 20, marginBottom: 16 }}
              />
              <Text className="text-white text-3xl font-extrabold mb-1 text-center">
                Welcome Back
              </Text>
              <Text className="text-white/90 text-sm text-center px-4 mb-5">
                {role === 'delivery'
                  ? 'Sign in to continue accepting jobs and deliveries.'
                  : 'Sign in to continue managing your outlet.'}
              </Text>
            </View>

            <View className="bg-white rounded-t-[40px] px-6 pt-6 pb-12">
              <RoleSelector value={role} onChange={setRole} disabled={formBusy} />

              <AuthBanner type="success" message={success} />
              <AuthBanner
                type="error"
                message={
                  error ||
                  (gateway.reachable === false
                    ? `Can't reach TOKAJO servers. Check your internet and try again.`
                    : null)
                }
              />
              {gateway.reachable === false ? (
                <Pressable
                  onPress={gateway.retry}
                  disabled={gateway.checking}
                  className="mb-4 self-start"
                >
                  <Text className="text-sm font-bold text-[#EA4B14]">
                    {gateway.checking ? 'Retrying…' : 'Retry connection'}
                  </Text>
                </Pressable>
              ) : null}

              <AuthField
                label="Email"
                icon={Mail}
                placeholder="Enter your email"
                autofill="email"
                value={email}
                onChangeText={setEmail}
                errorText={fieldErrors.email}
              />

              <AuthField
                label="Password"
                icon={Lock}
                placeholder="Enter your Password"
                secure
                autofill="password"
                value={password}
                onChangeText={setPassword}
                errorText={fieldErrors.password}
                labelAccessory={null}
              />

              <View className="flex-row items-center justify-between mb-4 mt-0">
                <CheckboxRow
                  checked={keepLoggedIn}
                  onToggle={() => setKeepLoggedIn((v) => !v)}
                  label="Remember me"
                />
                <Pressable onPress={() => router.push('/forgot-password')} hitSlop={8}>
                  <Text className="text-sm font-semibold text-[#EA4B14]">
                    Forgot Password?
                  </Text>
                </Pressable>
              </View>

              <View
                onLayout={(e) => {
                  sliderWidthRef.current = e.nativeEvent.layout.width;
                }}
                className="bg-[#EA4B14] h-[56px] rounded-full justify-center px-[6px] mb-4 overflow-hidden relative"
              >
                <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
                  <Text className="text-white text-[16px] font-bold text-center">
                    {formBusy ? 'Signing in...' : 'Swipe to Login'}
                  </Text>
                </View>

                <Animated.View
                  {...panResponder.panHandlers}
                  style={[
                    { transform: [{ translateX: pan.x }] },
                    {
                      width: 44,
                      height: 44,
                      backgroundColor: 'white',
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 10,
                    }
                  ]}
                >
                  {formBusy ? (
                    <ActivityIndicator color="#EA4B14" />
                  ) : (
                    <ChevronsRight color="#EA4B14" size={24} />
                  )}
                </Animated.View>
              </View>

              <AuthDivider label="Or continue with" />

              <View className="mt-4 mb-4">
                <SocialButtons
                  onGoogle={() => void social.signInWithGoogle()}
                  onApple={() => void social.signInWithApple()}
                  googleBusy={social.busy === 'google'}
                  appleBusy={social.busy === 'apple'}
                  showApple={social.appleAvailable}
                  disabled={formBusy}
                />
              </View>

              <View className="flex-row items-center justify-center mb-3">
                <Text className="text-[15px] text-secondary">
                  Don't have an account?{' '}
                </Text>
                <Pressable onPress={() => router.push('/register')} hitSlop={8}>
                  <Text className="text-[15px] font-bold text-[#EA4B14]">
                    Create an account
                  </Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => router.push('/verify-otp')}
                hitSlop={8}
                className="mb-2 mt-2 h-12 items-center justify-center rounded-full border border-[#FED7AA] bg-[#FFF7ED]"
              >
                <Text className="text-center text-[15px] font-bold text-[#EA4B14]">
                  {role === 'delivery'
                    ? 'Continue with phone OTP'
                    : 'Sign in with OTP instead'}
                </Text>
              </Pressable>

              <LegalFooter />
            </View>
          </SafeAreaView>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
