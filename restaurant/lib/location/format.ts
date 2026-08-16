/** Normalize longitude into [-180, 180] (Google Maps can return unwrapped values). */
export function normalizeLng(lng: number): number {
  if (!Number.isFinite(lng)) return lng;
  let x = lng;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

export function normalizeLat(lat: number): number {
  if (!Number.isFinite(lat)) return lat;
  return Math.max(-90, Math.min(90, lat));
}

export function isCoordinateFallbackAddress(value?: string | null): boolean {
  if (!value) return false;
  return /^lat\s*-?\d/i.test(value.trim()) || /\blng\s*-?\d/i.test(value);
}

/** Short label shown in the header (e.g. "Koramangala" or "Home"). */
export function shortAddressLabel(formattedAddress: string, source?: string): string {
  if (!formattedAddress.trim() || isCoordinateFallbackAddress(formattedAddress)) {
    return source === 'gps' ? 'Current location' : 'Selected location';
  }

  const parts = formattedAddress
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) return 'Delivery address';
  if (parts.length === 1) return parts[0];

  const first = parts[0];
  const second = parts[1];

  if (/^\d/.test(first) && second) {
    return `${first}, ${second}`;
  }

  return first.length <= 28 ? first : `${first.slice(0, 25)}…`;
}

/** Extract city name from a full formatted address (e.g. Google reverse geocode). */
export function extractCityFromAddress(formattedAddress: string): string | null {
  if (!formattedAddress.trim() || isCoordinateFallbackAddress(formattedAddress)) {
    return null;
  }

  const parts = formattedAddress
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((part) => !/^lat\b/i.test(part) && !/^lng\b/i.test(part));

  if (parts.length === 0) return null;

  // Common Google format: ..., Area, City, State PIN, Country
  // Prefer the part before state (Madhya Pradesh / etc.)
  const stateHints = [
    'madhya pradesh',
    'uttar pradesh',
    'andhra pradesh',
    'arunachal pradesh',
    'himachal pradesh',
    'tamil nadu',
    'west bengal',
    'maharashtra',
    'karnataka',
    'gujarat',
    'rajasthan',
    'punjab',
    'haryana',
    'bihar',
    'odisha',
    'kerala',
    'telangana',
    'assam',
    'delhi',
    'india',
  ];

  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const lower = parts[i].toLowerCase().replace(/\d+/g, '').trim();
    if (stateHints.some((h) => lower.includes(h))) continue;
    if (/^\d{5,6}$/.test(parts[i])) continue;
    // Skip very short tokens and house numbers
    if (parts[i].length < 3) continue;
    if (/^\d/.test(parts[i]) && parts[i].length < 8) continue;
    return parts[i].replace(/\s+\d{5,6}$/, '').trim();
  }

  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

export function headerLocationLine(label: string, formattedAddress: string): string {
  if (isCoordinateFallbackAddress(formattedAddress) || isCoordinateFallbackAddress(label)) {
    return 'Current location';
  }
  const short = shortAddressLabel(formattedAddress);
  if (label && label !== short && !formattedAddress.startsWith(label)) {
    return `${label} · ${short}`;
  }
  return short;
}

/**
 * Full delivery address for the home header (Swiggy/Zomato style).
 * Keeps street → city → state; drops trailing country noise.
 */
export function formatFullDeliveryAddress(formattedAddress?: string | null): string {
  if (!formattedAddress?.trim() || isCoordinateFallbackAddress(formattedAddress)) {
    return '';
  }

  const parts = formattedAddress
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((part) => {
      const lower = part.toLowerCase();
      if (lower === 'india' || lower === 'in') return false;
      if (/^lat\b/i.test(part) || /^lng\b/i.test(part)) return false;
      return true;
    });

  return parts.join(', ');
}

/** Primary line under "Deliver to" — locality / landmark. */
export function deliveryHeaderTitle(
  label?: string | null,
  formattedAddress?: string | null
): string {
  if (label && !isCoordinateFallbackAddress(label) && label !== 'Selected location') {
    // Prefer a concise label when it's not already the entire address
    if (
      !formattedAddress ||
      label.length <= 36 ||
      !formattedAddress.toLowerCase().startsWith(label.toLowerCase())
    ) {
      const first = label.split(',')[0]?.trim();
      if (first) return first;
    }
  }

  const full = formatFullDeliveryAddress(formattedAddress);
  if (!full) return 'Set delivery address';
  return full.split(',')[0]?.trim() || full;
}

/** Secondary line — remaining full address after the title. */
export function deliveryHeaderSubtitle(
  title: string,
  formattedAddress?: string | null
): string {
  const full = formatFullDeliveryAddress(formattedAddress);
  if (!full) return '';

  // If title is the start of the full address, show the rest
  const lowerFull = full.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (lowerFull.startsWith(lowerTitle)) {
    const rest = full.slice(title.length).replace(/^[\s,]+/, '');
    return rest;
  }

  // Otherwise show full address (user selected this exact place)
  if (full.toLowerCase() === lowerTitle) return '';
  return full;
}

/** Clean city labels like "Tikamgarh Tahsil" → "Tikamgarh". */
export function normalizeCityName(city?: string | null): string | undefined {
  if (!city?.trim()) return undefined;
  if (isCoordinateFallbackAddress(city) || /^lng\b/i.test(city)) return undefined;

  const cleaned = city
    .replace(/\s+\d{5,6}\b/g, '')
    .replace(
      /\s+(tahsil|tehsil|district|nagar parishad|municipal corporation|municipality|corp\.?)\b/gi,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 2) return undefined;
  return cleaned;
}

/** True when a restaurant belongs to the user's selected delivery city. */
export function restaurantMatchesCity(
  restaurant: { city?: string | null; address?: string | null },
  city: string
): boolean {
  const needle = normalizeCityName(city)?.toLowerCase();
  if (!needle) return false;

  const hay = `${restaurant.city ?? ''} ${restaurant.address ?? ''}`.toLowerCase();
  if (hay.includes(needle)) return true;

  // Handle minor spacing / punctuation differences
  const compactHay = hay.replace(/[^a-z0-9]/g, '');
  const compactNeedle = needle.replace(/[^a-z0-9]/g, '');
  return compactHay.includes(compactNeedle);
}

