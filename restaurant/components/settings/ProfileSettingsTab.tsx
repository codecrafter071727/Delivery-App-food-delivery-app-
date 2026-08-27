import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import {
  LocationMapPicker,
  type MapPickResult,
} from '@/components/restaurant/LocationMapPicker';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { parseDeliveryAddress } from '@/lib/location';
import { useCuisineCatalog } from '@/lib/restaurant/hooks';
import {
  PRICE_RANGE_OPTIONS,
  type RestaurantDetail,
  type UpdateRestaurantPayload,
} from '@/lib/restaurant/settings-types';

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={authTheme.textDim}
        multiline={multiline}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionHint}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

function sameString(a?: string | null, b?: string | null) {
  return (a ?? '').trim() === (b ?? '').trim();
}

function sameNumber(a?: number | null, b?: number | null) {
  const left = a == null || !Number.isFinite(a) ? null : a;
  const right = b == null || !Number.isFinite(b) ? null : b;
  return left === right;
}

function sameStringList(a?: string[], b?: string[]) {
  const left = [...(a ?? [])].map((item) => item.trim()).filter(Boolean).sort();
  const right = [...(b ?? [])].map((item) => item.trim()).filter(Boolean).sort();
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

type Props = {
  detail: RestaurantDetail;
  busy: boolean;
  onSave: (payload: UpdateRestaurantPayload) => void;
};

/**
 * Settings → Profile: outlet identity + map pin.
 * Map confirm always refreshes coords and address fields, then Save persists both.
 */
export function ProfileSettingsTab({ detail, busy, onSave }: Props) {
  const cuisineCatalog = useCuisineCatalog(true);
  const [name, setName] = useState(detail.name ?? '');
  const [description, setDescription] = useState(detail.description ?? '');
  const [costForTwo, setCostForTwo] = useState(
    detail.costForTwo != null ? String(detail.costForTwo) : ''
  );
  const [priceRange, setPriceRange] = useState(
    String(detail.priceRange ?? 'moderate')
  );
  const [cuisines, setCuisines] = useState<string[]>(detail.cuisines ?? []);
  const [fssai, setFssai] = useState(detail.fssaiLicense ?? '');
  const [gstin, setGstin] = useState(detail.gstin ?? '');
  const [phone, setPhone] = useState(detail.phone ?? '');
  const [street, setStreet] = useState(detail.address?.street ?? '');
  const [area, setArea] = useState(detail.address?.area ?? '');
  const [city, setCity] = useState(detail.address?.city ?? '');
  const [stateName, setStateName] = useState(detail.address?.state ?? '');
  const [pincode, setPincode] = useState(detail.address?.pincode ?? '');
  const [country, setCountry] = useState(detail.address?.country ?? 'India');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    detail.location?.coordinates
      ? {
          lat: detail.location.coordinates[1],
          lng: detail.location.coordinates[0],
        }
      : null
  );
  const [mapDirty, setMapDirty] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapHint, setMapHint] = useState<string | null>(null);

  useEffect(() => {
    setName(detail.name ?? '');
    setDescription(detail.description ?? '');
    setCostForTwo(detail.costForTwo != null ? String(detail.costForTwo) : '');
    setPriceRange(String(detail.priceRange ?? 'moderate'));
    setCuisines(detail.cuisines ?? []);
    setFssai(detail.fssaiLicense ?? '');
    setGstin(detail.gstin ?? '');
    setPhone(detail.phone ?? '');
    setStreet(detail.address?.street ?? '');
    setArea(detail.address?.area ?? '');
    setCity(detail.address?.city ?? '');
    setStateName(detail.address?.state ?? '');
    setPincode(detail.address?.pincode ?? '');
    setCountry(detail.address?.country ?? 'India');
    setCoords(
      detail.location?.coordinates
        ? {
            lat: detail.location.coordinates[1],
            lng: detail.location.coordinates[0],
          }
        : null
    );
    setMapDirty(false);
    setMapHint(null);
  }, [detail]);

  const toggleCuisine = (cuisine: string) => {
    setCuisines((prev) => {
      if (prev.includes(cuisine)) return prev.filter((item) => item !== cuisine);
      if (prev.length >= 10) return prev;
      return [...prev, cuisine];
    });
  };

  const onMapConfirm = (result: MapPickResult) => {
    const parsed = parseDeliveryAddress({
      formattedAddress: result.formattedAddress || result.label,
      label: result.label,
      lat: result.lat,
      lng: result.lng,
    });

    setCoords({ lat: result.lat, lng: result.lng });
    setMapDirty(true);
    // Always refresh address fields from the confirmed pin (user can still edit).
    setStreet(parsed.street);
    setArea(parsed.area);
    setCity(parsed.city);
    setStateName(parsed.state);
    setPincode(parsed.pincode === '000000' ? '' : parsed.pincode);
    if (!country.trim()) setCountry('India');
    setMapHint(
      `Pin updated · ${result.lat.toFixed(5)}, ${result.lng.toFixed(5)}. Address fields filled — tap Save Profile.`
    );
    setMapOpen(false);
  };

  const buildPartialPayload = (): UpdateRestaurantPayload | null => {
    const payload: UpdateRestaurantPayload = {};
    const cost = Number(costForTwo);
    const nextCost =
      costForTwo.trim() && Number.isFinite(cost) && cost > 0 ? cost : undefined;

    if (!sameString(name, detail.name)) payload.name = name.trim();
    if (!sameString(description, detail.description ?? '')) {
      payload.description = description.trim();
    }
    if (!sameNumber(nextCost, detail.costForTwo)) {
      payload.costForTwo = nextCost;
    }
    if (!sameString(priceRange, String(detail.priceRange ?? 'moderate'))) {
      payload.priceRange = priceRange;
    }
    if (!sameStringList(cuisines, detail.cuisines)) {
      payload.cuisines = cuisines;
    }
    if (!sameString(fssai, detail.fssaiLicense ?? '')) {
      payload.fssaiLicense = fssai.trim();
    }
    if (!sameString(gstin, detail.gstin ?? '')) {
      payload.gstin = gstin.trim();
    }
    if (!sameString(phone, detail.phone ?? '')) {
      payload.phone = phone.trim();
    }

    const addressChanged =
      !sameString(street, detail.address?.street ?? '') ||
      !sameString(area, detail.address?.area ?? '') ||
      !sameString(city, detail.address?.city ?? '') ||
      !sameString(stateName, detail.address?.state ?? '') ||
      !sameString(pincode, detail.address?.pincode ?? '') ||
      !sameString(country, detail.address?.country ?? 'India');

    const locationBroken = Boolean(coords) && detail.locationGeoValid === false;

    if (mapDirty || addressChanged) {
      payload.address = {
        street: street.trim(),
        area: area.trim() || undefined,
        city: city.trim(),
        state: stateName.trim(),
        country: country.trim() || 'India',
        pincode: pincode.trim(),
      };
    }

    if ((mapDirty || locationBroken) && coords) {
      payload.location = {
        type: 'Point',
        coordinates: [coords.lng, coords.lat],
      };
    }

    return Object.keys(payload).length ? payload : null;
  };

  return (
    <View style={{ gap: 14 }}>
      <Section title="Basic Information">
        <Field label="Restaurant Name *" value={name} onChangeText={setName} />
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="Outlet contact number"
        />
        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          multiline
          placeholder="Tell customers about your restaurant"
        />
        <Field
          label="Cost for Two (₹)"
          value={costForTwo}
          onChangeText={setCostForTwo}
          keyboardType="numeric"
        />
        <Text style={styles.label}>Price Range</Text>
        <View style={styles.chipRow}>
          {PRICE_RANGE_OPTIONS.map((opt) => {
            const active = priceRange === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => setPriceRange(String(opt.id))}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Section title="Cuisines">
        <View style={styles.chipRow}>
          {Array.from(
            new Set([...cuisineCatalog.names, ...(detail.cuisines ?? [])])
          ).map((cuisine) => {
            const active = cuisines.includes(cuisine);
            return (
              <Pressable
                key={cuisine}
                onPress={() => toggleCuisine(cuisine)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {cuisine}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.meta}>
          Selected: {cuisines.length ? cuisines.join(', ') : 'None'}
          {cuisineCatalog.isError ? ' · catalog unavailable, local list shown' : ''}
        </Text>
      </Section>

      <Section title="Legal Information">
        <Field label="FSSAI License" value={fssai} onChangeText={setFssai} />
        <Field label="GSTIN" value={gstin} onChangeText={setGstin} />
      </Section>

      <Section
        title="Address & Location"
        subtitle="Pin the exact outlet on the map. Street, area, city, state and pincode fill from that pin — then tap Save Profile."
      >
        <Pressable
          onPress={() => setMapOpen(true)}
          style={({ pressed }) => [
            styles.secondaryBtn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryBtnText}>
            {coords ? 'Change on Map' : 'Set location on Map'}
          </Text>
        </Pressable>
        {coords ? (
          <View style={styles.locationOk}>
            <Text style={styles.locationOkText}>
              Location set: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              {mapDirty ? ' · not saved yet' : ''}
              {detail.locationGeoValid === false
                ? ' · will auto-fix map format on save'
                : ''}
            </Text>
          </View>
        ) : (
          <Text style={styles.meta}>No coordinates set yet.</Text>
        )}
        {mapHint ? <Text style={styles.mapHint}>{mapHint}</Text> : null}
        <Field label="Street *" value={street} onChangeText={setStreet} />
        <Field label="Area / Locality" value={area} onChangeText={setArea} />
        <Field label="City *" value={city} onChangeText={setCity} />
        <Field label="State *" value={stateName} onChangeText={setStateName} />
        <Field
          label="Pincode *"
          value={pincode}
          onChangeText={setPincode}
          keyboardType="numeric"
        />
        <Field label="Country" value={country} onChangeText={setCountry} />
      </Section>

      <PrimaryButton
        label="Save Profile"
        loading={busy}
        onPress={() => {
          if (
            !name.trim() ||
            !street.trim() ||
            !city.trim() ||
            !stateName.trim() ||
            !pincode.trim()
          ) {
            Alert.alert(
              'Missing details',
              'Name, street, city, state and pincode are required.'
            );
            return;
          }
          if (!coords) {
            Alert.alert(
              'Map pin required',
              'Open Change on Map, place the pin on your outlet, then save.'
            );
            return;
          }
          const payload = buildPartialPayload();
          if (!payload) {
            Alert.alert('No changes', 'Edit a field or move the map pin before saving.');
            return;
          }
          onSave(payload);
        }}
      />

      <LocationMapPicker
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        onConfirm={onMapConfirm}
        initial={coords ?? undefined}
        autoDetectOnOpen={!coords}
        locationTitle="RESTAURANT LOCATION"
        currentLocationHint="Or search the outlet address, then drag the pin onto the entrance."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
  },
  sectionHint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
    marginBottom: 2,
  },
  field: { gap: 6 },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#FAFAFA',
  },
  inputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    borderColor: authTheme.brand,
    backgroundColor: '#FFF1F2',
  },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#4B5563',
  },
  chipTextActive: {
    color: authTheme.brand,
    fontFamily: fonts.semiBold,
  },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  mapHint: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#15803D',
    lineHeight: 17,
  },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.brand,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#FFF7F8',
  },
  secondaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.brand,
  },
  pressed: { opacity: 0.85 },
  locationOk: {
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  locationOkText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#047857',
  },
});
