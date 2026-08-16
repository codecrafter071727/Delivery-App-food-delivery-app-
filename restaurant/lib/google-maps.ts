/** Google Maps / Places API key — set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in .env */
export const GOOGLE_MAPS_API_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '';

export function assertGoogleMapsApiKey(): void {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error(
      'Google Maps API key is missing. Add EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to .env and restart Expo.'
    );
  }
}
