/** Decode a Google encoded polyline into lat/lng points. */
export function decodeGooglePolyline(
  encoded?: string | null,
  precision = 5
): { latitude: number; longitude: number }[] {
  const str = encoded?.trim();
  if (!str) return [];

  const points: { latitude: number; longitude: number }[] = [];
  const factor = 10 ** precision;
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < str.length);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    const latitude = lat / factor;
    const longitude = lng / factor;
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      points.push({ latitude, longitude });
    }
  }

  return points;
}
