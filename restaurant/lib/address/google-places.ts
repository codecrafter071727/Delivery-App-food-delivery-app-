import axios from 'axios';

import type { AddressSuggestion, GeocodeResult } from '@/lib/address/api';
import { GOOGLE_MAPS_API_KEY } from '@/lib/google-maps';

const GOOGLE_BASE = 'https://maps.googleapis.com/maps/api';
const PLACES_NEW = 'https://places.googleapis.com/v1';

type GoogleAutocompleteResponse = {
  status: string;
  predictions?: Array<{
    description: string;
    place_id: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
  }>;
  error_message?: string;
};

type GoogleGeocodeResponse = {
  status: string;
  results?: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
  error_message?: string;
};

type PlacesNewAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      place?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
    queryPrediction?: {
      text?: { text?: string };
    };
  }>;
  error?: { message?: string; status?: string };
};

export type PlacesSearchBias = {
  lat: number;
  lng: number;
  radiusMeters?: number;
};

function mapGooglePrediction(
  item: NonNullable<GoogleAutocompleteResponse['predictions']>[number]
): AddressSuggestion {
  const main = item.structured_formatting?.main_text ?? '';
  const secondary = item.structured_formatting?.secondary_text ?? '';
  const description =
    item.description ||
    (main && secondary ? `${main}, ${secondary}` : main || secondary);

  return {
    description,
    placeId: item.place_id,
    mainText: main || undefined,
    secondaryText: secondary || undefined,
    source: 'google',
  };
}

async function autocompleteLegacy(
  query: string,
  bias?: PlacesSearchBias
): Promise<AddressSuggestion[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];

  const params: Record<string, string | number> = {
    input: query,
    key: GOOGLE_MAPS_API_KEY,
    components: 'country:in',
    language: 'en',
  };

  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    params.location = `${bias.lat},${bias.lng}`;
    params.radius = bias.radiusMeters ?? 30000;
  }

  const { data } = await axios.get<GoogleAutocompleteResponse>(
    `${GOOGLE_BASE}/place/autocomplete/json`,
    { params, timeout: 5000 }
  );

  if (data.status === 'ZERO_RESULTS') return [];
  if (data.status !== 'OK') return [];
  return (data.predictions ?? []).map(mapGooglePrediction);
}

/**
 * Places API (New) — works when legacy Autocomplete is blocked on the key.
 * This is what production India apps need for road/locality queries.
 */
async function autocompleteNew(
  query: string,
  bias?: PlacesSearchBias
): Promise<AddressSuggestion[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];

  const body: Record<string, unknown> = {
    input: query,
    languageCode: 'en',
    regionCode: 'IN',
    includedRegionCodes: ['in'],
    includeQueryPredictions: true,
  };

  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)) {
    body.locationBias = {
      circle: {
        center: { latitude: bias.lat, longitude: bias.lng },
        radius: bias.radiusMeters ?? 35000.0,
      },
    };
  }

  const { data } = await axios.post<PlacesNewAutocompleteResponse>(
    `${PLACES_NEW}/places:autocomplete`,
    body,
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      },
      timeout: 6000,
    }
  );

  if (!data.suggestions?.length) return [];

  const out: AddressSuggestion[] = [];
  for (const suggestion of data.suggestions) {
    const place = suggestion.placePrediction;
    if (place) {
      const main = place.structuredFormat?.mainText?.text ?? '';
      const secondary = place.structuredFormat?.secondaryText?.text ?? '';
      const description =
        place.text?.text ||
        (main && secondary ? `${main}, ${secondary}` : main || secondary);
      if (!description) continue;
      out.push({
        description,
        placeId: place.placeId,
        mainText: main || description.split(',')[0],
        secondaryText: secondary || description.split(',').slice(1).join(',').trim(),
        source: 'google-new',
      });
      continue;
    }

    const queryPred = suggestion.queryPrediction?.text?.text;
    if (queryPred) {
      out.push({
        description: queryPred,
        mainText: queryPred.split(',')[0],
        secondaryText: queryPred.split(',').slice(1).join(',').trim(),
        source: 'google-query',
      });
    }
  }
  return out;
}

async function placeDetailsNew(placeId: string): Promise<GeocodeResult> {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('Google Maps API key is not configured');
  }

  const id = placeId.startsWith('places/') ? placeId.slice('places/'.length) : placeId;
  const { data } = await axios.get<{
    formattedAddress?: string;
    displayName?: { text?: string };
    location?: { latitude?: number; longitude?: number };
  }>(`${PLACES_NEW}/places/${encodeURIComponent(id)}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'formattedAddress,displayName,location',
    },
    timeout: 8000,
  });

  const lat = data.location?.latitude;
  const lng = data.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('Could not open this place');
  }

  return {
    lat,
    lng,
    formattedAddress: data.formattedAddress || data.displayName?.text,
  };
}

export const googlePlacesApi = {
  isConfigured: () => Boolean(GOOGLE_MAPS_API_KEY),

  autocomplete: async (
    query: string,
    bias?: PlacesSearchBias
  ): Promise<AddressSuggestion[]> => {
    if (!GOOGLE_MAPS_API_KEY) return [];

    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    // Prefer Places API (New) — confirmed working for India road queries
    try {
      const neu = await autocompleteNew(trimmed, bias);
      if (neu.length) return neu;
    } catch {
      // fall through to legacy
    }

    try {
      return await autocompleteLegacy(trimmed, bias);
    } catch {
      return [];
    }
  },

  placeDetails: async (placeId: string): Promise<GeocodeResult> => {
    if (!GOOGLE_MAPS_API_KEY) {
      throw new Error('Google Maps API key is not configured');
    }

    try {
      return await placeDetailsNew(placeId);
    } catch {
      // legacy details
    }

    type DetailsResponse = {
      status: string;
      result?: {
        formatted_address?: string;
        name?: string;
        geometry?: { location: { lat: number; lng: number } };
      };
      error_message?: string;
    };

    const { data } = await axios.get<DetailsResponse>(
      `${GOOGLE_BASE}/place/details/json`,
      {
        params: {
          place_id: placeId,
          key: GOOGLE_MAPS_API_KEY,
          fields: 'geometry,formatted_address,name',
          language: 'en',
        },
        timeout: 12000,
      }
    );

    if (data.status !== 'OK' || !data.result?.geometry?.location) {
      throw new Error(data.error_message || 'Could not open this place');
    }

    return {
      lat: data.result.geometry.location.lat,
      lng: data.result.geometry.location.lng,
      formattedAddress:
        data.result.formatted_address || data.result.name || undefined,
    };
  },

  geocode: async (input: { placeId?: string; address?: string }): Promise<GeocodeResult> => {
    if (!GOOGLE_MAPS_API_KEY) {
      throw new Error('Google Maps API key is not configured');
    }

    if (input.placeId) {
      try {
        return await googlePlacesApi.placeDetails(input.placeId);
      } catch {
        // fall through
      }
    }

    if (input.address) {
      // Text Search (New) often works when Geocoding API billing/legacy is blocked
      try {
        const { data } = await axios.post<{
          places?: Array<{
            formattedAddress?: string;
            displayName?: { text?: string };
            location?: { latitude?: number; longitude?: number };
          }>;
        }>(
          `${PLACES_NEW}/places:searchText`,
          {
            textQuery: input.address,
            languageCode: 'en',
            regionCode: 'IN',
            maxResultCount: 1,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
              'X-Goog-FieldMask':
                'places.formattedAddress,places.displayName,places.location',
            },
            timeout: 8000,
          }
        );
        const hit = data.places?.[0];
        if (
          hit?.location &&
          typeof hit.location.latitude === 'number' &&
          typeof hit.location.longitude === 'number'
        ) {
          return {
            lat: hit.location.latitude,
            lng: hit.location.longitude,
            formattedAddress:
              hit.formattedAddress || hit.displayName?.text || input.address,
          };
        }
      } catch {
        // fall through to legacy geocode
      }
    }

    const params: Record<string, string> = { key: GOOGLE_MAPS_API_KEY };
    if (input.placeId) {
      params.place_id = input.placeId;
    } else if (input.address) {
      params.address = input.address;
      params.components = 'country:IN';
    } else {
      throw new Error('placeId or address is required');
    }

    const { data } = await axios.get<GoogleGeocodeResponse>(
      `${GOOGLE_BASE}/geocode/json`,
      { params, timeout: 12000 }
    );

    if (data.status !== 'OK' || !data.results?.[0]) {
      throw new Error(data.error_message || 'Could not find this location');
    }

    const result = data.results[0];
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
    };
  },

  reverseGeocode: async (input: { lat: number; lng: number }): Promise<string | null> => {
    if (!GOOGLE_MAPS_API_KEY) return null;

    try {
      const { data } = await axios.get<GoogleGeocodeResponse>(
        `${GOOGLE_BASE}/geocode/json`,
        {
          params: {
            latlng: `${input.lat},${input.lng}`,
            key: GOOGLE_MAPS_API_KEY,
            language: 'en',
          },
          timeout: 12000,
        }
      );

      if (data.status !== 'OK' || !data.results?.[0]) return null;
      return data.results[0].formatted_address;
    } catch {
      return null;
    }
  },
};
