import Constants from 'expo-constants';

/** Google Maps / Places / Distance Matrix — EXPO_PUBLIC_GOOGLE_MAPS_API_KEY */
function resolveGoogleMapsApiKey(): string {
  const fromEnv = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as
    | { googleMapsApiKey?: string }
    | undefined;
  return extra?.googleMapsApiKey?.trim() ?? '';
}

export const GOOGLE_MAPS_API_KEY = resolveGoogleMapsApiKey();

export function assertGoogleMapsApiKey(): void {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error(
      'Google Maps API key is missing. Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to .env and restart Expo.'
    );
  }
}
