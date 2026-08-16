import { extractCityFromAddress } from '@/lib/location/format';

export type ParsedDeliveryAddress = {
  street: string;
  area: string;
  city: string;
  state: string;
  pincode: string;
  formattedAddress: string;
  label?: string;
  lat?: number;
  lng?: number;
};

const STATE_NAMES = [
  'Madhya Pradesh',
  'Uttar Pradesh',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Himachal Pradesh',
  'Tamil Nadu',
  'West Bengal',
  'Maharashtra',
  'Karnataka',
  'Gujarat',
  'Rajasthan',
  'Punjab',
  'Haryana',
  'Bihar',
  'Odisha',
  'Kerala',
  'Telangana',
  'Assam',
  'Delhi',
  'Jharkhand',
  'Chhattisgarh',
  'Goa',
  'Uttarakhand',
  'Jammu and Kashmir',
];

/** Split a Google-style address into fields required by order-service. */
export function parseDeliveryAddress(input: {
  formattedAddress: string;
  label?: string;
  city?: string;
  lat?: number;
  lng?: number;
}): ParsedDeliveryAddress {
  const formatted = input.formattedAddress.trim() || input.label?.trim() || '';
  const parts = formatted
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const pincodeMatch = formatted.match(/\b(\d{6})\b/);
  const pincode = pincodeMatch?.[1] ?? '000000';

  let state = 'Madhya Pradesh';
  for (const name of STATE_NAMES) {
    if (formatted.toLowerCase().includes(name.toLowerCase())) {
      state = name;
      break;
    }
  }

  // Prefer explicit city, then extractor, then middle token
  const city =
    input.city?.trim() ||
    extractCityFromAddress(formatted) ||
    (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) ||
    'City';

  const street =
    input.label?.trim() ||
    parts[0] ||
    formatted ||
    'Delivery location';

  const area =
    parts[1] && parts[1] !== street
      ? parts[1].replace(/\s+\d{6}\b/, '').trim()
      : parts[0] || street;

  return {
    street,
    area: area || street,
    city: city.replace(/\s+\d{6}\b/, '').trim() || 'City',
    state,
    pincode,
    formattedAddress: formatted || street,
    label: input.label,
    lat: input.lat,
    lng: input.lng,
  };
}
