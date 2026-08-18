import { useEffect, useMemo, useState } from 'react';

import { reverseGeocodeAddress } from '@/lib/address/search';
import { api } from '@/lib/api';
import {
  dropDistanceFromRestaurantKm,
  formatDeliveryAddress,
  formatKmFromRestaurant,
} from '@/lib/delivery-partner/api';
import { getRememberedOffer } from '@/lib/delivery-partner/offer-store';
import type { PartnerDelivery } from '@/lib/delivery-partner/types';
import { shortAddressLabel } from '@/lib/location/format';

type PublicStop = { name?: string; address?: string };

const restaurantCache = new Map<string, PublicStop>();
const geoCache = new Map<string, string>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isGenericName(value?: string | null) {
  const v = value?.trim().toLowerCase();
  return (
    !v ||
    v === 'restaurant' ||
    v === 'customer' ||
    v === 'pickup' ||
    v === 'drop' ||
    v === 'drop-off' ||
    v === 'dropoff'
  );
}

function firstPlaceName(address: string) {
  const label = shortAddressLabel(address);
  return isGenericName(label) ? '' : label;
}

function geoKey(lat: number, lng: number) {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

async function fetchPublicRestaurantStop(
  restaurantId: string
): Promise<PublicStop | null> {
  const cached = restaurantCache.get(restaurantId);
  if (cached) return cached;
  try {
    const { data } = await api.get<unknown>(
      `/api/v1/restaurant-service/restaurants/${encodeURIComponent(restaurantId)}`
    );
    const record = asRecord(data);
    const inner = asRecord(record.data ?? record);
    const name =
      typeof inner.name === 'string' && inner.name.trim()
        ? inner.name.trim()
        : undefined;
    const addr = asRecord(inner.address);
    const parts = [
      addr.street,
      addr.line1,
      addr.area,
      addr.locality,
      addr.city,
      addr.state,
      addr.pincode,
    ]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean);
    const stop: PublicStop = {
      name,
      address: parts.length ? [...new Set(parts)].join(', ') : undefined,
    };
    if (stop.name || stop.address) {
      restaurantCache.set(restaurantId, stop);
      return stop;
    }
  } catch {
    // Rider session may not get the public catalog — fall back to geocode.
  }
  return null;
}

async function geocodeLatLng(lat: number, lng: number): Promise<string | null> {
  const key = geoKey(lat, lng);
  const cached = geoCache.get(key);
  if (cached) return cached;
  const addr = await reverseGeocodeAddress({ lat, lng });
  if (addr) geoCache.set(key, addr);
  return addr;
}

export function useResolvedTripStops(delivery: PartnerDelivery) {
  const offer =
    getRememberedOffer(delivery.id) ?? getRememberedOffer(delivery.orderId);
  const [catalog, setCatalog] = useState<PublicStop | null>(null);
  const [pickupGeo, setPickupGeo] = useState<string | null>(null);
  const [dropGeo, setDropGeo] = useState<string | null>(null);

  const pickupLat = delivery.restaurantAddress?.lat ?? offer?.restaurantLat;
  const pickupLng = delivery.restaurantAddress?.lng ?? offer?.restaurantLng;
  const dropLat = delivery.deliveryAddress?.lat ?? offer?.dropLat;
  const dropLng = delivery.deliveryAddress?.lng ?? offer?.dropLng;
  const restaurantId = delivery.restaurantId ?? offer?.restaurantId;

  const mappedPickup = formatDeliveryAddress(delivery.restaurantAddress);
  const mappedDrop = formatDeliveryAddress(delivery.deliveryAddress);

  useEffect(() => {
    if (!restaurantId) return;
    let alive = true;
    void fetchPublicRestaurantStop(restaurantId).then((stop) => {
      if (alive && stop) setCatalog(stop);
    });
    return () => {
      alive = false;
    };
  }, [restaurantId]);

  useEffect(() => {
    if (mappedPickup || pickupLat == null || pickupLng == null) return;
    let alive = true;
    void geocodeLatLng(pickupLat, pickupLng)
      .then((addr) => {
        if (alive && addr) setPickupGeo(addr);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mappedPickup, pickupLat, pickupLng]);

  useEffect(() => {
    if (mappedDrop || dropLat == null || dropLng == null) return;
    let alive = true;
    void geocodeLatLng(dropLat, dropLng)
      .then((addr) => {
        if (alive && addr) setDropGeo(addr);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mappedDrop, dropLat, dropLng]);

  return useMemo(() => {
    const pickupAddress =
      mappedPickup ||
      catalog?.address?.trim() ||
      offer?.pickupLabel?.trim() ||
      pickupGeo ||
      '';
    const dropAddress =
      mappedDrop ||
      offer?.dropLabel?.trim() ||
      dropGeo ||
      '';
    const restaurantName = !isGenericName(delivery.restaurantName)
      ? delivery.restaurantName!.trim()
      : catalog?.name?.trim() ||
        (!isGenericName(offer?.restaurantName)
          ? offer!.restaurantName!.trim()
          : '') ||
        (!isGenericName(delivery.restaurantAddress?.label)
          ? delivery.restaurantAddress!.label!.trim()
          : '') ||
        firstPlaceName(pickupAddress);
    const customerName = !isGenericName(delivery.customerName)
      ? delivery.customerName!.trim()
      : (!isGenericName(delivery.deliveryAddress?.label)
          ? delivery.deliveryAddress!.label!.trim()
          : '') || firstPlaceName(dropAddress);
    const dropKm = dropDistanceFromRestaurantKm({
      ...delivery,
      restaurantAddress: {
        ...delivery.restaurantAddress,
        lat: pickupLat,
        lng: pickupLng,
        line1: pickupAddress || delivery.restaurantAddress?.line1,
      },
      deliveryAddress: {
        ...delivery.deliveryAddress,
        lat: dropLat,
        lng: dropLng,
        line1: dropAddress || delivery.deliveryAddress?.line1,
      },
      distanceKm: delivery.distanceKm ?? offer?.estimatedKm,
    });

    return {
      restaurantName: restaurantName || 'Pickup',
      pickupAddress,
      customerName: customerName || 'Customer',
      dropAddress,
      dropKm,
      dropKmLabel: dropKm != null ? formatKmFromRestaurant(dropKm) : null,
    };
  }, [
    delivery,
    mappedPickup,
    mappedDrop,
    offer,
    catalog,
    pickupGeo,
    dropGeo,
    pickupLat,
    pickupLng,
    dropLat,
    dropLng,
  ]);
}
