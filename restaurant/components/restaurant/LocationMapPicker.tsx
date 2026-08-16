import * as Location from 'expo-location';
import { Check, Crosshair, MapPin, Navigation, Search, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { theme } from '@/constants/theme';
import type { AddressSuggestion } from '@/lib/address/api';
import {
  geocodeAddress,
  reverseGeocodeAddress,
  searchAddresses,
} from '../../lib/address/search';
import { getApiErrorMessage } from '@/lib/errors';
import { GOOGLE_MAPS_API_KEY } from '../../lib/google-maps';
import {
  normalizeLat,
  normalizeLng,
  shortAddressLabel,
} from '../../lib/location/format';

const DEFAULT = { lat: 23.2599, lng: 77.4126 }; // Bhopal fallback

export type MapPickResult = {
  lat: number;
  lng: number;
  formattedAddress: string;
  label: string;
  source: 'gps' | 'search';
};

type LocationMapPickerProps = {
  visible: boolean;
  /** Previously saved pin (map still jumps to GPS on open). */
  initial?: { lat: number; lng: number } | null;
  /** When true (default), open → request GPS and center pin on you. */
  autoDetectOnOpen?: boolean;
  /** Footer label above the address (e.g. "YOUR LOCATION"). */
  locationTitle?: string;
  /** Hint under “Use my current location”. */
  currentLocationHint?: string;
  onClose: () => void;
  onConfirm: (result: MapPickResult) => void;
};

function buildGoogleMapHtml(lat: number, lng: number, apiKey: string): string {
  const key = apiKey.replace(/'/g, "\\'");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #e8eaed; }
  .center-pin {
    position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, -100%);
    z-index: 1000; pointer-events: none;
  }
  .center-pin svg { filter: drop-shadow(0 3px 6px rgba(0,0,0,0.35)); }
</style>
</head>
<body>
<div id="map"></div>
<div class="center-pin">
  <svg width="44" height="44" viewBox="0 0 24 24" fill="#9E1B32" stroke="#9E1B32" stroke-width="1.5">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path>
    <circle cx="12" cy="10" r="3" fill="#fff" stroke="#fff"></circle>
  </svg>
</div>
<script>
  var map;
  var autocompleteService;
  var placesService;
  var geocoder;
  var suppressIdleUntil = 0;
  function post(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }
  function emitCenter() {
    if (!map) return;
    if (Date.now() < suppressIdleUntil) return;
    var c = map.getCenter();
    var lng = c.lng();
    while (lng > 180) lng -= 360;
    while (lng < -180) lng += 360;
    post({ type: 'move', lat: c.lat(), lng: lng });
  }
  function setMapView(lat, lng, zoom) {
    if (!map) return;
    suppressIdleUntil = Date.now() + 800;
    map.setCenter({ lat: lat, lng: lng });
    if (zoom) map.setZoom(zoom);
    else map.setZoom(17);
  }
  function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
      center: { lat: ${lat}, lng: ${lng} },
      zoom: 16,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'greedy',
    });
    autocompleteService = new google.maps.places.AutocompleteService();
    placesService = new google.maps.places.PlacesService(map);
    geocoder = new google.maps.Geocoder();
    map.addListener('idle', emitCenter);
    document.addEventListener('message', handleRN);
    window.addEventListener('message', handleRN);
    post({ type: 'ready' });
    emitCenter();
  }
  function handleRN(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'setView' && map) {
        setMapView(msg.lat, msg.lng, msg.zoom);
      }
      if (msg.type === 'autocomplete' && autocompleteService) {
        var req = { input: msg.query || '', componentRestrictions: { country: 'in' } };
        if (typeof msg.lat === 'number' && typeof msg.lng === 'number') {
          req.location = new google.maps.LatLng(msg.lat, msg.lng);
          req.radius = msg.radius || 40000;
        }
        autocompleteService.getPlacePredictions(req, function(predictions, status) {
          post({
            type: 'autocompleteResults',
            requestId: msg.requestId,
            status: status,
            predictions: (predictions || []).map(function(p) {
              return {
                description: p.description,
                placeId: p.place_id,
                mainText: (p.structured_formatting && p.structured_formatting.main_text) || '',
                secondaryText: (p.structured_formatting && p.structured_formatting.secondary_text) || ''
              };
            })
          });
        });
      }
      if (msg.type === 'placeDetails' && placesService) {
        placesService.getDetails({
          placeId: msg.placeId,
          fields: ['geometry', 'formatted_address', 'name']
        }, function(place, status) {
          if (status !== google.maps.places.PlacesServiceStatus.OK || !place || !place.geometry || !place.geometry.location) {
            post({ type: 'placeDetailsResult', requestId: msg.requestId, ok: false });
            return;
          }
          var plat = place.geometry.location.lat();
          var plng = place.geometry.location.lng();
          setMapView(plat, plng, 17);
          post({
            type: 'placeDetailsResult',
            requestId: msg.requestId,
            ok: true,
            lat: plat,
            lng: plng,
            formattedAddress: place.formatted_address || place.name || ''
          });
        });
      }
      if (msg.type === 'geocodeText' && geocoder) {
        geocoder.geocode({ address: msg.query, componentRestrictions: { country: 'IN' } }, function(results, status) {
          if (status !== 'OK' || !results || !results[0]) {
            post({ type: 'geocodeTextResult', requestId: msg.requestId, ok: false });
            return;
          }
          var r = results[0];
          var glat = r.geometry.location.lat();
          var glng = r.geometry.location.lng();
          setMapView(glat, glng, 17);
          post({
            type: 'geocodeTextResult',
            requestId: msg.requestId,
            ok: true,
            lat: glat,
            lng: glng,
            formattedAddress: r.formatted_address || msg.query
          });
        });
      }
    } catch (err) {}
  }
</script>
<script async defer
  src="https://maps.googleapis.com/maps/api/js?key=${key}&callback=initMap&libraries=places&v=weekly">
</script>
</body>
</html>`;
}

export function LocationMapPicker({
  visible,
  initial,
  autoDetectOnOpen = true,
  locationTitle = 'RESTAURANT LOCATION',
  currentLocationHint = 'Use your current GPS position for the restaurant',
  onClose,
  onConfirm,
}: LocationMapPickerProps) {
  const insets = useSafeAreaInsets();
  const webRef = useRef<WebView>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reverseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmPending = useRef(false);
  const detectedRef = useRef<string | undefined>(undefined);
  const sourceRef = useRef<'gps' | 'search'>('search');
  const requestIdRef = useRef(0);
  const pendingRequest = useRef<{
    id: number;
    kind: 'autocomplete' | 'details' | 'geocode';
  } | null>(null);

  const startPoint = useMemo(() => initial ?? DEFAULT, [initial]);

  const [pin, setPin] = useState(startPoint);
  const [search, setSearch] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [detectedAddress, setDetectedAddress] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [gpsReady, setGpsReady] = useState(false);

  detectedRef.current = detectedAddress;

  const sendToMap = useCallback((lat: number, lng: number, zoom = 17) => {
    if (!webRef.current) return;
    // Android WebView often drops RN postMessage — call setMapView via injectJS
    webRef.current.injectJavaScript(`
      (function() {
        try {
          if (typeof setMapView === 'function') {
            setMapView(${lat}, ${lng}, ${zoom});
          } else if (map) {
            map.setCenter({ lat: ${lat}, lng: ${lng} });
            map.setZoom(${zoom});
          }
        } catch (e) {}
      })();
      true;
    `);
  }, []);

  const reverseLookup = useCallback((lat: number, lng: number) => {
    if (reverseTimer.current) clearTimeout(reverseTimer.current);
    reverseTimer.current = setTimeout(async () => {
      const addr = await reverseGeocodeAddress({ lat, lng });
      if (addr) setDetectedAddress(addr);
    }, 450);
  }, []);

  const applyCoords = useCallback(
    async (
      lat: number,
      lng: number,
      source: 'gps' | 'search',
      formatted?: string
    ) => {
      const safeLat = normalizeLat(lat);
      const safeLng = normalizeLng(lng);
      sourceRef.current = source;
      setPin({ lat: safeLat, lng: safeLng });
      // Jump map immediately (and once more shortly after in case WebView was busy)
      sendToMap(safeLat, safeLng, 17);
      setTimeout(() => sendToMap(safeLat, safeLng, 17), 350);
      if (formatted && !/^lat\s*-?\d/i.test(formatted)) {
        setDetectedAddress(formatted);
        return;
      }
      const addr = await reverseGeocodeAddress({ lat: safeLat, lng: safeLng });
      if (addr) {
        setDetectedAddress(addr);
        return;
      }
      try {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: safeLat,
          longitude: safeLng,
        });
        if (place) {
          const parts = [place.name, place.street, place.city, place.region]
            .filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i);
          setDetectedAddress(parts.join(', ') || 'Selected location');
          return;
        }
      } catch {
        // ignore
      }
      setDetectedAddress('Selected location');
    },
    [sendToMap]
  );

  const detectCurrentLocation = useCallback(async () => {
    setLocating(true);
    setGpsReady(false);
    setError(null);
    setSearchError(null);
    setSuggestions([]);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Allow location access to use your current position.');
        return;
      }
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) {
        setError('Turn on GPS / device location, then try again.');
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const { latitude, longitude } = pos.coords;
      await applyCoords(latitude, longitude, 'gps');
      setGpsReady(true);
      setSearch('');
    } catch {
      setError('Could not detect your location. Search for an address instead.');
    } finally {
      setLocating(false);
    }
  }, [applyCoords]);

  useEffect(() => {
    if (!visible) {
      setMapReady(false);
      setGpsReady(false);
      return;
    }
    setError(null);
    setSearchError(null);
    setSuggestions([]);
    setSearch('');
    setPin(startPoint);
    setDetectedAddress(undefined);
    setGpsReady(false);
    sourceRef.current = 'search';
  }, [visible, startPoint]);

  useEffect(() => {
    if (!visible || !mapReady) return;
    if (autoDetectOnOpen) {
      void detectCurrentLocation();
      return;
    }
    if (initial) {
      sendToMap(initial.lat, initial.lng);
      reverseLookup(initial.lat, initial.lng);
    }
  }, [
    visible,
    mapReady,
    autoDetectOnOpen,
    initial,
    detectCurrentLocation,
    sendToMap,
    reverseLookup,
  ]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      if (reverseTimer.current) clearTimeout(reverseTimer.current);
    };
  }, []);

  const runRestAutocomplete = useCallback(async (query: string, requestId: number) => {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await searchAddresses(query, {
        bias: {
          lat: pin.lat,
          lng: pin.lng,
          radiusMeters: 40000,
        },
      });
      // Ignore stale responses when user kept typing
      if (requestId !== requestIdRef.current) return;
      setSuggestions(res);
      if (res.length === 0) {
        setSearchError('No places found. Try a landmark, area, or full address.');
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setSuggestions([]);
      setSearchError(
        getApiErrorMessage(err, 'Could not load address suggestions')
      );
    } finally {
      if (requestId === requestIdRef.current) {
        setSearching(false);
      }
    }
  }, [pin.lat, pin.lng]);

  const askWebViewAutocomplete = useCallback((query: string, requestId: number) => {
    if (!GOOGLE_MAPS_API_KEY || !mapReady || !webRef.current) return;
    pendingRequest.current = { id: requestId, kind: 'autocomplete' };
    const payload = JSON.stringify({
      type: 'autocomplete',
      query,
      requestId,
      lat: pin.lat,
      lng: pin.lng,
      radius: 40000,
    });
    webRef.current.injectJavaScript(`
      (function() {
        try {
          if (typeof handleRN === 'function') {
            handleRN({ data: ${JSON.stringify(payload)} });
          }
        } catch (e) {}
      })();
      true;
    `);
  }, [mapReady, pin.lat, pin.lng]);

  const onSearchChange = (text: string) => {
    setSearch(text);
    setSearchError(null);
    setGpsReady(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      pendingRequest.current = null;
      return;
    }

    searchTimer.current = setTimeout(() => {
      const query = text.trim();
      const id = ++requestIdRef.current;
      setSearching(true);
      setSuggestions([]);
      // Always search from RN (Photon + OSM + Google + backend)
      void runRestAutocomplete(query, id);
      // Also try in-map Places when available
      askWebViewAutocomplete(query, id);
    }, 280);
  };

  const onMapMessage = (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'ready') {
        setMapReady(true);
        return;
      }

      if (msg.type === 'move' && typeof msg.lat === 'number') {
        const lat = normalizeLat(msg.lat);
        const lng = normalizeLng(msg.lng);
        setPin({ lat, lng });
        setDetectedAddress(undefined);
        setGpsReady(false);
        sourceRef.current = 'search';
        reverseLookup(lat, lng);
        return;
      }

      if (msg.type === 'autocompleteResults') {
        // WebView Places is optional — merge with REST results if available
        if (
          msg.status === 'OK' &&
          Array.isArray(msg.predictions) &&
          msg.predictions.length
        ) {
          if (
            pendingRequest.current?.id === msg.requestId ||
            msg.requestId === requestIdRef.current
          ) {
            pendingRequest.current = null;
            const mapped: AddressSuggestion[] = msg.predictions.map(
              (p: {
                description: string;
                placeId: string;
                mainText?: string;
                secondaryText?: string;
              }) => ({
                description: p.description,
                placeId: p.placeId,
                mainText: p.mainText,
                secondaryText: p.secondaryText,
                source: 'google-webview',
              })
            );
            setSuggestions((prev) => {
              const seen = new Set(
                mapped.map((s) => s.description.toLowerCase())
              );
              const rest = prev.filter(
                (s) => !seen.has(s.description.toLowerCase())
              );
              return [...mapped, ...rest].slice(0, 10);
            });
            setSearching(false);
            setSearchError(null);
          }
        }
        return;
      }

      if (msg.type === 'placeDetailsResult') {
        if (pendingRequest.current?.id !== msg.requestId) return;
        pendingRequest.current = null;
        setSearching(false);
        if (msg.ok) {
          void applyCoords(msg.lat, msg.lng, 'search', msg.formattedAddress);
          setSuggestions([]);
          Keyboard.dismiss();
          return;
        }
        setError('Could not open that place. Try another suggestion.');
        return;
      }

      if (msg.type === 'geocodeTextResult') {
        if (pendingRequest.current?.id !== msg.requestId) return;
        pendingRequest.current = null;
        setSearching(false);
        if (msg.ok) {
          void applyCoords(msg.lat, msg.lng, 'search', msg.formattedAddress);
          setSuggestions([]);
          setSearch(msg.formattedAddress || search);
          Keyboard.dismiss();
          return;
        }
        void (async () => {
          try {
            const geo = await geocodeAddress({ address: search.trim() });
            await applyCoords(
              geo.lat,
              geo.lng,
              'search',
              geo.formattedAddress ?? search.trim()
            );
            setSuggestions([]);
          } catch (err) {
            setSearchError(
              getApiErrorMessage(err, 'No results for that address')
            );
          }
        })();
        return;
      }

      if (
        msg.type === 'confirm' &&
        confirmPending.current &&
        typeof msg.lat === 'number' &&
        typeof msg.lng === 'number'
      ) {
        confirmPending.current = false;
        const formatted =
          detectedRef.current ??
          `Lat ${msg.lat.toFixed(5)}, Lng ${msg.lng.toFixed(5)}`;
        onConfirm({
          lat: msg.lat,
          lng: msg.lng,
          formattedAddress: formatted,
          label: shortAddressLabel(formatted, sourceRef.current),
          source: sourceRef.current,
        });
      }
    } catch {
      // ignore malformed messages
    }
  };

  const pickSuggestion = async (item: AddressSuggestion) => {
    Keyboard.dismiss();
    setSuggestions([]);
    setSearch(item.description);
    setSearching(true);
    setSearchError(null);
    setError(null);
    setGpsReady(false);

    try {
      const lat = typeof item.lat === 'number' ? item.lat : undefined;
      const lng = typeof item.lng === 'number' ? item.lng : undefined;

      // Prefer coords already on the suggestion (OSM/Photon)
      if (
        lat != null &&
        lng != null &&
        Number.isFinite(lat) &&
        Number.isFinite(lng)
      ) {
        await applyCoords(lat, lng, 'search', item.description);
        return;
      }

      // Resolve Google placeId / address via Places API (New) — do not wait on WebView
      const geo = await geocodeAddress({
        placeId: item.placeId,
        address: item.description,
      });
      await applyCoords(
        geo.lat,
        geo.lng,
        'search',
        geo.formattedAddress ?? item.description
      );
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to open this place on the map'));
    } finally {
      setSearching(false);
    }
  };

  const submitSearch = () => {
    const query = search.trim();
    if (query.length < 2) return;
    Keyboard.dismiss();
    setSuggestions([]);
    setSearching(true);
    setSearchError(null);
    setError(null);

    void (async () => {
      try {
        // If a suggestion is already selected text, geocode it via Places New / fallbacks
        const geo = await geocodeAddress({ address: query });
        await applyCoords(
          geo.lat,
          geo.lng,
          'search',
          geo.formattedAddress ?? query
        );
        if (geo.formattedAddress) setSearch(geo.formattedAddress);
      } catch (err) {
        setSearchError(getApiErrorMessage(err, 'No results for that address'));
      } finally {
        setSearching(false);
      }
    })();
  };

  const handleConfirm = () => {
    const formatted =
      detectedAddress ?? `Lat ${pin.lat.toFixed(5)}, Lng ${pin.lng.toFixed(5)}`;

    // Always confirm from React Native pin state so the button never silently fails
    // if the WebView does not reply.
    onConfirm({
      lat: pin.lat,
      lng: pin.lng,
      formattedAddress: formatted,
      label: shortAddressLabel(formatted, sourceRef.current),
      source: sourceRef.current,
    });
  };

  const mapHtml = useMemo(
    () =>
      GOOGLE_MAPS_API_KEY
        ? buildGoogleMapHtml(startPoint.lat, startPoint.lng, GOOGLE_MAPS_API_KEY)
        : '',
    [startPoint.lat, startPoint.lng]
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Map fills remaining space ABOVE the footer — never covers Confirm */}
        <View style={styles.mapPane}>
          {visible && GOOGLE_MAPS_API_KEY ? (
            <WebView
              ref={webRef}
              style={styles.map}
              originWhitelist={['*']}
              source={{ html: mapHtml }}
              onMessage={onMapMessage}
              javaScriptEnabled
              domStorageEnabled
              geolocationEnabled
              startInLoadingState
              renderLoading={() => (
                <View style={styles.mapLoading}>
                  <ActivityIndicator color={theme.primary} size="large" />
                  <Text style={styles.mapLoadingText}>Loading map…</Text>
                </View>
              )}
            />
          ) : (
            <View style={styles.mapFallback}>
              <MapPin color={theme.primary} size={40} />
              <Text style={styles.mapFallbackTitle}>
                {GOOGLE_MAPS_API_KEY
                  ? 'Preparing map…'
                  : 'Map key missing — search still works'}
              </Text>
              <Text style={styles.mapFallbackText}>
                Use current location or search for an address below.
              </Text>
            </View>
          )}

          <View
            style={[styles.topSection, { paddingTop: insets.top + 8 }]}
            pointerEvents="box-none"
          >
            <View style={styles.topBar}>
              <View style={styles.searchWrap}>
                <Search color={theme.secondaryLight} size={18} />
                <TextInput
                  value={search}
                  onChangeText={onSearchChange}
                  onSubmitEditing={submitSearch}
                  placeholder="Search area, street, landmark…"
                  placeholderTextColor={theme.secondaryLight}
                  style={styles.searchInput}
                  returnKeyType="search"
                  autoCorrect={false}
                  autoCapitalize="words"
                  clearButtonMode="while-editing"
                />
                {searching ? (
                  <ActivityIndicator color={theme.primary} size="small" />
                ) : search.length > 0 ? (
                  <Pressable
                    onPress={() => {
                      setSearch('');
                      setSuggestions([]);
                      setSearchError(null);
                    }}
                    hitSlop={8}
                  >
                    <X color={theme.secondaryLight} size={16} />
                  </Pressable>
                ) : null}
              </View>
              <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
                <X color={theme.secondary} size={20} />
              </Pressable>
            </View>

            {search.trim().length < 2 ? (
              <Pressable
                style={styles.currentLocationCard}
                onPress={detectCurrentLocation}
                disabled={locating}
              >
                <View style={styles.currentLocationIcon}>
                  {locating ? (
                    <ActivityIndicator color={theme.primary} size="small" />
                  ) : (
                    <Navigation color={theme.primary} size={18} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.currentLocationTitle}>
                    {locating
                      ? 'Detecting your location…'
                      : gpsReady
                        ? 'Using your current location'
                        : 'Use my current location'}
                  </Text>
                  <Text style={styles.currentLocationSub}>
                    {gpsReady
                      ? 'Pin is on you — confirm below or fine-tune on the map'
                      : currentLocationHint}
                  </Text>
                </View>
                <Crosshair color={theme.primary} size={18} />
              </Pressable>
            ) : (
              <View style={styles.suggestions}>
                {searching && suggestions.length === 0 ? (
                  <View style={styles.searchingCard}>
                    <ActivityIndicator color={theme.primary} size="small" />
                    <Text style={styles.searchingText}>Finding places…</Text>
                  </View>
                ) : null}

                {searchError && suggestions.length === 0 && !searching ? (
                  <Text style={styles.searchErrorInline}>{searchError}</Text>
                ) : null}

                <ScrollView
                  keyboardShouldPersistTaps="always"
                  nestedScrollEnabled
                  style={styles.suggestionsScroll}
                >
                  {suggestions.slice(0, 8).map((item, index) => (
                    <Pressable
                      key={`${item.placeId ?? item.description}-${index}`}
                      onPress={() => void pickSuggestion(item)}
                      style={[
                        styles.suggestionRow,
                        index === Math.min(suggestions.length, 8) - 1 &&
                          styles.suggestionRowLast,
                      ]}
                    >
                      <View style={styles.suggestionIcon}>
                        <MapPin color={theme.primary} size={16} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionMain} numberOfLines={1}>
                          {String(item.mainText || item.description.split(',')[0])}
                        </Text>
                        <Text style={styles.suggestionSecondary} numberOfLines={2}>
                          {String(
                            item.secondaryText ||
                              item.description
                                .split(',')
                                .slice(1)
                                .join(',')
                                .trim() ||
                              item.description
                          )}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </View>

        {/* Footer is a normal layout sibling — always visible above system nav */}
        <View
          style={[
            styles.bottomPanel,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <View style={styles.detectedRow}>
            <MapPin color={theme.primary} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={styles.detectedLabel}>{locationTitle}</Text>
              <Text style={styles.detectedValue} numberOfLines={2}>
                {locating && !detectedAddress
                  ? 'Getting your address…'
                  : detectedAddress ??
                    `Lat ${pin.lat.toFixed(5)}, Lng ${pin.lng.toFixed(5)}`}
              </Text>
              <Text style={styles.detectedHint}>
                Drag the map to fine-tune · or search above
              </Text>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleConfirm}
            disabled={locating && !detectedAddress}
            style={{
              marginTop: 14,
              height: 54,
              borderRadius: 14,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              opacity: locating && !detectedAddress ? 0.6 : 1,
            }}
            accessibilityRole="button"
            accessibilityLabel="Confirm location"
          >
            {locating && !detectedAddress ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Check color="#FFFFFF" size={20} strokeWidth={2.5} />
                <Text
                  style={{
                    marginLeft: 8,
                    fontSize: 16,
                    fontWeight: '800',
    color: '#FFFFFF',
                  }}
                >
                  Confirm location
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  mapPane: {
    flex: 1,
    backgroundColor: '#E8EAED',
    position: 'relative',
  },
  map: {
    flex: 1,
    width: '100%',
    backgroundColor: '#E8EAED',
  },
  mapLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#E8EAED',
  },
  mapLoadingText: { fontSize: 14, color: theme.secondaryLight, fontWeight: '600',
    },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 10,
    backgroundColor: theme.surface,
  },
  mapFallbackTitle: {
    color: theme.secondary,
    fontWeight: '800',
    fontSize: 16,
    textAlign: 'center',
  },
  mapFallbackText: {
    color: theme.secondaryLight,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  topSection: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  searchInput: { flex: 1, fontSize: 15, color: theme.secondary },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  currentLocationCard: {
    marginTop: 10,
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  currentLocationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationTitle: {
    color: theme.secondary,
    fontWeight: '800',
    fontSize: 14,
  },
  currentLocationSub: {
    color: theme.secondaryLight,
    fontSize: 12,
    marginTop: 2,
  },
  searchingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  searchingText: {
    color: theme.secondaryLight,
    fontWeight: '600',
    fontSize: 13,
  },
  searchErrorInline: {
    fontSize: 13,
    color: theme.danger,
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestions: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 16,
    maxHeight: 340,
    zIndex: 50,
  },
  suggestionsScroll: {
    maxHeight: 340,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  suggestionRowLast: { borderBottomWidth: 0 },
  suggestionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  suggestionMain: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 14,
  },
  suggestionSecondary: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  bottomPanel: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  detectedRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detectedLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: theme.secondaryLight,
  },
  detectedValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '600',
    color: theme.secondary,
  },
  detectedHint: { marginTop: 2, fontSize: 12, color: theme.muted },
  errorText: {
    fontSize: 13,
    color: theme.danger,
    fontWeight: '500',
    marginBottom: 8,
  },
});
