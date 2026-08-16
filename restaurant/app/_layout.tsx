import 'react-native-gesture-handler';

import '../global.css';

import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { authTheme } from '@/constants/auth-theme';
import { setUnauthorizedHandler } from '@/lib/auth/unauthorized';
import { setupLiveQueryFocus } from '@/lib/live-query';
import { asyncStoragePersister, queryClient } from '@/lib/query-client';
import { useAuthStore } from '@/store/auth-store';

void SplashScreen.preventAutoHideAsync();
setupLiveQueryFocus();

export default function RootLayout() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const clearSession = useAuthStore((s) => s.clearSession);
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [fontWaitDone, setFontWaitDone] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const timer = setTimeout(() => setFontWaitDone(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const uiReady = fontsLoaded || fontWaitDone;

  useEffect(() => {
    if (uiReady) {
      void SplashScreen.hideAsync();
    }
  }, [uiReady]);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      await clearSession();
      router.replace('/login');
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession, router]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: asyncStoragePersister }}
        >
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              contentStyle: { backgroundColor: '#FFF7F2' },
            }}
          />
          {!uiReady ? (
            <View
              pointerEvents="auto"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#FFF7F2',
              }}
            >
              <ActivityIndicator color={authTheme.brand} size="large" />
            </View>
          ) : null}
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
