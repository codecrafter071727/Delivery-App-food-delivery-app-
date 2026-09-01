import { Platform } from 'react-native';

/**
 * Optional offer chime. Custom WAV needs a dev build with expo-av linked;
 * until then vibration (offer-store) is the alert. This stays a no-op so
 * Metro never loads ExponentAV and the app boots on existing dev clients.
 */
export async function playOfferAlertSound() {
  if (Platform.OS === 'web') return;
  // Intentionally silent — see mixkit-happy-bells-notification-937.wav + expo run:android
}

export async function stopOfferAlertSound() {
  // no-op
}
