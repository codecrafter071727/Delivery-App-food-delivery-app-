import * as Location from 'expo-location';

import { addressApi, type AddressSuggestion, type GeocodeResult } from '@/lib/address/api';
import {
  googlePlacesApi,
  type PlacesSearchBias,
} from '@/lib/address/google-places';

export type SearchAddressesOptions = {
  bias?: PlacesSearchBias;
};

async function searchWithExpo(query: string): Promise<AddressSuggestion[]> {
  try {
    const results = await Location.geocodeAsync(query);
    if (!results.length) return [];

    const enriched: AddressSuggestion[] = [];
    for (const item of results.slice(0, 5)) {
      let description = query;
      try {
        const [place] = await Location.reverseGeocodeAsync({
          latitude: item.latitude,
          longitude: item.longitude,
        });
        if (place) {
          const parts = [place.name, place.street, place.city, place.region]
            .filter(Boolean)
            .filter((v, i, arr) => arr.indexOf(v) === i);
          if (parts.length) description = parts.join(', ');
        }
      } catch {
        // keep query text
      }

      enriched.push({
        description,
        placeId: undefined,
        lat: item.latitude,
        lng: item.longitude,
        mainText: description.split(',')[0]?.trim() || query,
        secondaryText: description.split(',').slice(1).join(',').trim(),
        source: 'expo',
      });
    }
    return enriched;
  } catch {
    return [];
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/** Light typo / spelling helpers for India place search. */
function buildQueryVariants(query: string): string[] {
  const trimmed = query.trim().replace(/\s+/g, ' ');
  if (!trimmed) return [];

  const variants = new Set<string>([trimmed]);

  // havelli → haveli, hotell → hotel, etc.
  const collapsed = trimmed.replace(/([a-zA-Z])\1{1,}/g, '$1$1'); // keep doubles max 2
  const deDoubled = trimmed.replace(/([a-zA-Z])\1+/g, '$1');
  variants.add(collapsed);
  variants.add(deDoubled);

  // "road X city" → "X Road, city"
  const roadMatch = trimmed.match(/^(.+?)\s+road\s+(.+)$/i);
  if (roadMatch) {
    variants.add(`${roadMatch[1]} Road, ${roadMatch[2]}`);
    variants.add(`${roadMatch[1]} Road ${roadMatch[2]} Madhya Pradesh`);
  }

  // Ensure state hint for small-town roads
  if (!/madhya\s*pradesh|\bmp\b/i.test(trimmed) && /tikamgarh|bhopal|indore|gwalior|jabalpur/i.test(trimmed)) {
    variants.add(`${trimmed}, Madhya Pradesh`);
  }

  return [...variants].slice(0, 4);
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function tokenDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function scoreSuggestion(query: string, item: AddressSuggestion): number {
  const qTokens = normalizeTokens(query);
  const hay = normalizeTokens(
    `${item.mainText ?? ''} ${item.secondaryText ?? ''} ${item.description}`
  );
  if (!qTokens.length || !hay.length) return 0;

  let score = 0;
  for (const qt of qTokens) {
    if (hay.some((h) => h === qt || h.includes(qt) || qt.includes(h))) {
      score += 3;
      continue;
    }
    if (hay.some((h) => tokenDistance(qt, h) <= 1)) {
      score += 2; // typo tolerance (havelli ↔ haveli)
      continue;
    }
    if (hay.some((h) => tokenDistance(qt, h) <= 2 && qt.length > 4)) {
      score += 1;
    }
  }

  const source = String(item.source ?? '');
  if (source.startsWith('google')) score += 4;
  if (typeof item.lat === 'number' && typeof item.lng === 'number') score += 0.5;

  return score;
}

async function searchWithNominatim(
  query: string,
  bias?: PlacesSearchBias
): Promise<AddressSuggestion[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      countrycodes: 'in',
      limit: '8',
    });
    if (bias) {
      // viewbox = left,top,right,bottom
      const d = 0.35;
      params.set(
        'viewbox',
        `${bias.lng - d},${bias.lat + d},${bias.lng + d},${bias.lat - d}`
      );
      params.set('bounded', '0');
    }

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ViharFoodRestaurantApp/1.0 (restaurant-location-search)',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      name?: string;
      address?: Record<string, string>;
    }>;
    if (!Array.isArray(data) || !data.length) return [];

    return data.map((item) => {
      const addr = item.address ?? {};
      const city =
        addr.city ||
        addr.town ||
        addr.village ||
        addr.state_district ||
        addr.city_district ||
        addr.state ||
        '';
      const area =
        addr.suburb ||
        addr.neighbourhood ||
        addr.residential ||
        addr.railway ||
        addr.road ||
        item.name ||
        '';
      const mainText = area || item.display_name.split(',')[0] || query;
      const secondaryText =
        [city, addr.state].filter(Boolean).join(', ') ||
        item.display_name.split(',').slice(1).join(',').trim();

      return {
        description: item.display_name,
        placeId: `nominatim:${item.place_id}`,
        lat: Number(item.lat),
        lng: Number(item.lon),
        mainText,
        secondaryText,
        source: 'nominatim',
      };
    });
  } catch {
    return [];
  }
}

async function searchWithPhoton(
  query: string,
  bias?: PlacesSearchBias
): Promise<AddressSuggestion[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      limit: '8',
      lang: 'en',
    });
    if (bias) {
      params.set('lat', String(bias.lat));
      params.set('lon', String(bias.lng));
    }

    const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: {
          osm_id?: number;
          name?: string;
          street?: string;
          district?: string;
          city?: string;
          state?: string;
          country?: string;
          countrycode?: string;
        };
      }>;
    };

    const features = (data.features ?? []).filter((f) => {
      const code = (f.properties?.countrycode || '').toLowerCase();
      const country = (f.properties?.country || '').toLowerCase();
      return !code || code === 'in' || country.includes('india');
    });

    return features
      .map((f) => {
        const p = f.properties ?? {};
        const [lng, lat] = f.geometry?.coordinates ?? [NaN, NaN];
        const mainText = p.name || p.street || query;
        const secondaryText = [
          p.street && p.name ? p.street : null,
          p.district,
          p.city,
          p.state,
        ]
          .filter(Boolean)
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .join(', ');
        const description = [mainText, secondaryText].filter(Boolean).join(', ');
        return {
          description,
          placeId: p.osm_id != null ? `photon:${p.osm_id}` : undefined,
          lat: Number(lat),
          lng: Number(lng),
          mainText,
          secondaryText,
          source: 'photon',
        } satisfies AddressSuggestion;
      })
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  } catch {
    return [];
  }
}

function dedupeSuggestions(list: AddressSuggestion[]): AddressSuggestion[] {
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const item of list) {
    const key = `${item.description}|${item.lat ?? ''}|${item.lng ?? ''}`
      .toLowerCase()
      .trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Production-style place search:
 * Prefer Google Places (New), merge OSM/Photon, rank by query match (typo-tolerant).
 */
export async function searchAddresses(
  query: string,
  options?: SearchAddressesOptions
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const bias = options?.bias;
  const variants = buildQueryVariants(trimmed);
  const primary = variants[0];
  const secondaryVariant = variants.find((v) => v !== primary);

  const googleTask = googlePlacesApi.isConfigured()
    ? withTimeout(
        (async () => {
          const first = await googlePlacesApi.autocomplete(primary, bias);
          if (first.length) return first;
          if (secondaryVariant) {
            return googlePlacesApi.autocomplete(secondaryVariant, bias);
          }
          return [] as AddressSuggestion[];
        })().catch(() => [] as AddressSuggestion[]),
        6500,
        [] as AddressSuggestion[]
      )
    : Promise.resolve([] as AddressSuggestion[]);

  const backendTask = withTimeout(
    addressApi.autocomplete(primary).catch(() => [] as AddressSuggestion[]),
    2500,
    [] as AddressSuggestion[]
  );

  const nominatimTask = withTimeout(
    searchWithNominatim(primary, bias),
    7000,
    [] as AddressSuggestion[]
  );
  const photonTask = withTimeout(
    searchWithPhoton(primary, bias),
    7000,
    [] as AddressSuggestion[]
  );

  // Wait for Google first (best quality for Indian roads), then merge fallbacks
  const google = await googleTask;
  const [backend, nominatim, photon] = await Promise.all([
    backendTask,
    nominatimTask,
    photonTask,
  ]);

  let merged = dedupeSuggestions([...google, ...backend, ...nominatim, ...photon]);

  if (merged.length === 0) {
    const expoResults = await searchWithExpo(primary);
    merged = dedupeSuggestions(expoResults);
  }

  return merged
    .map((item) => ({ item, score: scoreSuggestion(trimmed, item) }))
    .sort((a, b) => b.score - a.score)
    .filter((row) => row.score > 0 || merged.length <= 3)
    .slice(0, 10)
    .map((row) => row.item);
}

export async function geocodeAddress(input: {
  placeId?: string;
  address?: string;
  lat?: number;
  lng?: number;
}): Promise<GeocodeResult> {
  if (
    typeof input.lat === 'number' &&
    typeof input.lng === 'number' &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng)
  ) {
    return {
      lat: input.lat,
      lng: input.lng,
      formattedAddress: input.address,
    };
  }

  if (
    input.placeId &&
    (input.placeId.startsWith('nominatim:') || input.placeId.startsWith('photon:')) &&
    input.address
  ) {
    const results = await searchAddresses(input.address);
    const hit = results.find((n) => n.placeId === input.placeId) ?? results[0];
    if (hit && typeof hit.lat === 'number' && typeof hit.lng === 'number') {
      return {
        lat: hit.lat,
        lng: hit.lng,
        formattedAddress: hit.description,
      };
    }
  }

  if (
    googlePlacesApi.isConfigured() &&
    input.placeId &&
    !input.placeId.startsWith('nominatim:') &&
    !input.placeId.startsWith('photon:')
  ) {
    try {
      return await googlePlacesApi.geocode(input);
    } catch {
      // try other sources
    }
  }

  try {
    return await addressApi.geocode(input);
  } catch (backendError) {
    if (input.address) {
      if (googlePlacesApi.isConfigured()) {
        try {
          return await googlePlacesApi.geocode({ address: input.address });
        } catch {
          // continue
        }
      }

      const results = await searchAddresses(input.address);
      if (
        results[0] &&
        typeof results[0].lat === 'number' &&
        typeof results[0].lng === 'number'
      ) {
        return {
          lat: results[0].lat,
          lng: results[0].lng,
          formattedAddress: results[0].description,
        };
      }

      const [hit] = await Location.geocodeAsync(input.address);
      if (hit) {
        return {
          lat: hit.latitude,
          lng: hit.longitude,
          formattedAddress: input.address,
        };
      }
    }

    throw backendError instanceof Error
      ? backendError
      : new Error('Could not find this location');
  }
}

export async function reverseGeocodeAddress(input: {
  lat: number;
  lng: number;
}): Promise<string | null> {
  const backend = await addressApi.reverseGeocode(input);
  if (backend) return backend;

  if (googlePlacesApi.isConfigured()) {
    const google = await googlePlacesApi.reverseGeocode(input);
    if (google) return google;
  }

  try {
    const url =
      'https://nominatim.openstreetmap.org/reverse?' +
      new URLSearchParams({
        lat: String(input.lat),
        lon: String(input.lng),
        format: 'jsonv2',
      }).toString();
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ViharFoodRestaurantApp/1.0 (restaurant-location-search)',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as { display_name?: string };
      if (data?.display_name) return data.display_name;
    }
  } catch {
    // ignore
  }

  try {
    const [place] = await Location.reverseGeocodeAsync({
      latitude: input.lat,
      longitude: input.lng,
    });
    if (!place) return null;
    const parts = [place.name, place.street, place.city, place.region]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i);
    return parts.join(', ') || null;
  } catch {
    return null;
  }
}
