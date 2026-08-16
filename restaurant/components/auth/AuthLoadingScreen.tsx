import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { fonts } from '@/constants/typography';
import { BRAND_NAME, BRAND_YELLOW, theme } from '@/constants/theme';

const logo = require('../../assets/tokajo-logo.png');

type AuthLoadingScreenProps = {
  message?: string;
  error?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
};

/**
 * Stable full-screen loader for auth hydrate / post-login routing.
 * No entrance animations — avoids logo jitter when layouts remount.
 */
export function AuthLoadingScreen({
  message = 'Opening your portal…',
  error = false,
  retrying = false,
  onRetry,
}: AuthLoadingScreenProps) {
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <View style={styles.content}>
        <View style={styles.logoWrap}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
        </View>
        <Text style={styles.brand}>{BRAND_NAME}</Text>
        {!error || retrying ? (
          <ActivityIndicator
            color={theme.primary}
            size="large"
            style={styles.spinner}
          />
        ) : null}
        <Text style={styles.loadingText}>{message}</Text>
        {error && onRetry ? (
          <Pressable
            onPress={onRetry}
            disabled={retrying}
            style={styles.retryBtn}
          >
            <Text style={styles.retryLabel}>
              {retrying ? 'Retrying…' : 'Try again'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BRAND_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  content: {
    alignItems: 'center',
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 72,
    height: 72,
  },
  brand: {
    marginTop: 16,
    color: theme.primary,
    fontSize: 22,
    fontFamily: fonts.extraBold,
    letterSpacing: 0.6,
  },
  spinner: {
    marginTop: 28,
  },
  loadingText: {
    marginTop: 14,
    color: theme.primaryDark,
    fontSize: 13,
    fontFamily: fonts.semiBold,
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 22,
    backgroundColor: theme.primary,
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  retryLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: fonts.bold,
  },
});
