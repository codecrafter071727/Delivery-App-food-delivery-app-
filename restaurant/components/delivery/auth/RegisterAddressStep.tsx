import { MapPin, Navigation } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthField } from '@/components/auth/AuthField';
import {
  LocationMapPicker,
  type MapPickResult,
} from '@/components/restaurant/LocationMapPicker';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { parseDeliveryAddress } from '@/lib/location';

export type RegisterAddressValues = {
  address: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
};

type Props = {
  values: RegisterAddressValues;
  onChange: (patch: Partial<RegisterAddressValues>) => void;
  disabled?: boolean;
};

/**
 * Delivery partner signup — address step with map pin.
 * Exact lat/lng is required; city/state autofill from reverse geocode.
 */
export function RegisterAddressStep({ values, onChange, disabled }: Props) {
  const [mapOpen, setMapOpen] = useState(false);
  const hasPin =
    values.latitude != null &&
    values.longitude != null &&
    Number.isFinite(values.latitude) &&
    Number.isFinite(values.longitude);

  const applyMapPick = (result: MapPickResult) => {
    const parsed = parseDeliveryAddress({
      formattedAddress: result.formattedAddress || result.label,
      label: result.label,
      lat: result.lat,
      lng: result.lng,
    });
    onChange({
      latitude: result.lat,
      longitude: result.lng,
      address:
        result.formattedAddress?.trim() ||
        result.label?.trim() ||
        values.address,
      city: parsed.city?.trim() || values.city,
      state: parsed.state?.trim() || values.state,
    });
    setMapOpen(false);
  };

  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{
          color: authTheme.textMuted,
          fontFamily: fonts.medium,
          fontSize: 13,
          marginBottom: 4,
          lineHeight: 18,
        }}
      >
        Pin your exact home / base location on the map. City and state fill in
        automatically — you can edit them if needed.
      </Text>

      <Pressable
        disabled={disabled}
        onPress={() => setMapOpen(true)}
        style={{
          borderWidth: 1,
          borderColor: hasPin ? authTheme.brand : '#E5E7EB',
          backgroundColor: '#fff',
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 14,
          marginBottom: 10,
          gap: 8,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MapPin size={18} color={hasPin ? authTheme.brand : authTheme.textMuted} />
          <Text
            style={{
              flex: 1,
              fontFamily: fonts.semiBold,
              fontSize: 14,
              color: hasPin ? authTheme.brand : authTheme.text,
            }}
          >
            {hasPin ? 'Location pinned — tap to adjust' : 'Open map & pin location *'}
          </Text>
          <Navigation size={16} color={authTheme.textMuted} />
        </View>
        {hasPin ? (
          <Text
            style={{
              color: authTheme.textMuted,
              fontFamily: fonts.medium,
              fontSize: 12,
              lineHeight: 16,
            }}
          >
            {values.latitude!.toFixed(5)}, {values.longitude!.toFixed(5)}
            {values.address?.trim() ? `\n${values.address.trim()}` : ''}
          </Text>
        ) : (
          <Text
            style={{
              color: authTheme.textMuted,
              fontFamily: fonts.medium,
              fontSize: 12,
            }}
          >
            Use GPS or search, then confirm the pin.
          </Text>
        )}
      </Pressable>

      <AuthField
        label="Address *"
        placeholder="House / street / landmark"
        value={values.address}
        editable={!disabled}
        onChangeText={(address) => onChange({ address })}
      />
      <AuthField
        label="City *"
        placeholder="Auto from map"
        autoCapitalize="words"
        value={values.city}
        editable={!disabled}
        onChangeText={(city) => onChange({ city })}
      />
      <AuthField
        label="State *"
        placeholder="Auto from map"
        autoCapitalize="words"
        value={values.state}
        editable={!disabled}
        onChangeText={(state) => onChange({ state })}
      />

      <LocationMapPicker
        visible={mapOpen}
        initial={
          hasPin
            ? { lat: values.latitude!, lng: values.longitude! }
            : null
        }
        autoDetectOnOpen={!hasPin}
        locationTitle="YOUR HOME / BASE"
        currentLocationHint="Use this as your delivery partner home pin"
        onClose={() => setMapOpen(false)}
        onConfirm={applyMapPick}
      />
    </View>
  );
}
