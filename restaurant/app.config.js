/** Merges env into Expo config (API URL + Google Maps SDK keys). */
module.exports = ({ config }) => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || '';
  const apiUrl =
    process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://10.12.14.3:4000';

  return {
    ...config,
    ios: {
      ...config.ios,
      config: {
        ...(config.ios?.config || {}),
        googleMapsApiKey: mapsKey,
      },
      infoPlist: {
        ...(config.ios?.infoPlist || {}),
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
        },
      },
    },
    android: {
      ...config.android,
      usesCleartextTraffic: true,
      config: {
        ...(config.android?.config || {}),
        googleMaps: {
          apiKey: mapsKey,
        },
      },
    },
    extra: {
      ...(config.extra || {}),
      apiUrl,
      googleMapsApiKey: mapsKey,
    },
  };
};
