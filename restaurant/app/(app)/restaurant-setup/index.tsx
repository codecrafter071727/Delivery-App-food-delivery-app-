import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Store,
  UploadCloud,
  UtensilsCrossed,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AuthBanner } from '@/components/auth/AuthBanner';
import { AuthShell } from '@/components/auth/AuthShell';
import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { LocationMapPicker } from '@/components/restaurant/LocationMapPicker';
import {
  RequiredLabel,
  SectionTitle,
  SetupProgress,
} from '@/components/restaurant/SetupProgress';
import { cardShadow, theme } from '@/constants/theme';
import { getApiErrorMessage } from '@/lib/errors';
import { parseDeliveryAddress } from '@/lib/location';
import { markRestaurantSetupComplete } from '@/lib/navigation/post-auth';
import { restaurantOwnerApi, buildCreateRestaurantPayload } from '@/lib/restaurant/api';
import { useCuisineCatalog, useRestaurantServiceHealth } from '@/lib/restaurant/hooks';
import { useAuthStore } from '@/store/auth-store';

type Step = 0 | 1 | 2;

export default function RestaurantSetupScreen() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const cuisinesQuery = useCuisineCatalog(true);
  const serviceHealth = useRestaurantServiceHealth(true);

  const [step, setStep] = useState<Step>(0);
  const [maxStep, setMaxStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [banner, setBanner] = useState<{
    type: 'error' | 'success';
    message: string;
  } | null>(null);

  const [logo, setLogo] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [cover, setCover] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fssai, setFssai] = useState('');
  const [gstin, setGstin] = useState('');
  const [priceRange, setPriceRange] = useState<
    'budget' | 'moderate' | 'expensive' | 'fine_dining'
  >('moderate');
  const [costForTwo, setCostForTwo] = useState('500');

  const [street, setStreet] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');
  const [country, setCountry] = useState('India');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);

  const [cuisines, setCuisines] = useState<string[]>([]);

  const costForTwoNumber = useMemo(() => {
    const n = Number(costForTwo);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [costForTwo]);

  const pickImage = async (kind: 'logo' | 'cover') => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Photo library permission is required.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: kind === 'logo' ? [1, 1] : [16, 9],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    if (kind === 'logo') setLogo(result.assets[0]);
    else setCover(result.assets[0]);
  };

  const stepError = (s: Step): string | null => {
    if (s === 0) {
      if (!logo?.uri) return 'Restaurant logo is required.';
      if (name.trim().length < 2) return 'Enter your restaurant name.';
      return null;
    }
    if (s === 1) {
      if (street.trim().length < 3) return 'Street address is required.';
      if (city.trim().length < 2) return 'City is required.';
      if (stateName.trim().length < 2) return 'State is required.';
      if (pincode.trim().length !== 6 || !/^\d{6}$/.test(pincode.trim())) {
        return 'Pincode must be 6 digits.';
      }
      if (!coords) return 'Pick your location on the map.';
      return null;
    }
    return null;
  };

  const goNext = () => {
    const err = stepError(step);
    if (err) {
      setBanner({ type: 'error', message: err });
      return;
    }
    setBanner(null);
    const next = (step + 1) as Step;
    setStep(next);
    setMaxStep((m) => (next > m ? next : m));
  };

  const goBack = () => {
    setBanner(null);
    if (step > 0) {
      setStep((s) => ((s - 1) as Step));
      return;
    }

    Alert.alert(
      'Finish registration first',
      'Your restaurant profile (logo, address, and map pin) must be completed before you can use the dashboard.',
      [
        { text: 'Continue setup', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            await logout();
            router.replace('/login');
          },
        },
      ]
    );
  };

  const submit = async () => {
    const err0 = stepError(0);
    const err1 = stepError(1);
    if (err0) {
      setStep(0);
      setBanner({ type: 'error', message: err0 });
      return;
    }
    if (err1) {
      setStep(1);
      setBanner({ type: 'error', message: err1 });
      return;
    }
    if (serviceHealth.data && !serviceHealth.data.ok) {
      setBanner({
        type: 'error',
        message:
          serviceHealth.data.message ??
          'Restaurant service is unreachable. Try again shortly.',
      });
      return;
    }
    if (!logo?.uri || !coords) return;

    setBusy(true);
    setBanner(null);
    try {
      const payload = buildCreateRestaurantPayload({
        name: name.trim(),
        description: description.trim() || undefined,
        fssaiLicense: fssai.trim() || undefined,
        gstin: gstin.trim() || undefined,
        priceRange,
        costForTwo: costForTwoNumber,
        cuisines,
        address: {
          street: street.trim(),
          area: area.trim() || undefined,
          city: city.trim(),
          state: stateName.trim(),
          country: country.trim() || 'India',
          pincode: pincode.trim(),
        },
        location: { type: 'Point', coordinates: [coords.lng, coords.lat] },
      });

      let restaurantId: string;

      try {
        const created = await restaurantOwnerApi.createRestaurant(payload);
        restaurantId = created.id;
        await restaurantOwnerApi.getRestaurant(restaurantId).catch(() => created);
      } catch (createErr) {
        const createMsg = getApiErrorMessage(createErr, '').toLowerCase();
        const alreadyExists =
          createMsg.includes('already') ||
          createMsg.includes('exists') ||
          createMsg.includes('one restaurant');

        if (!alreadyExists) throw createErr;

        const existing = await restaurantOwnerApi.getMyRestaurant();
        if (!existing?.id) throw createErr;
        restaurantId = existing.id;
      }

      try {
        await restaurantOwnerApi.uploadLogo(restaurantId, {
          uri: logo.uri,
          fileName: logo.fileName ?? 'logo.jpg',
          mimeType: logo.mimeType ?? 'image/jpeg',
        });
      } catch (uploadErr) {
        throw new Error(
          `Logo upload failed: ${getApiErrorMessage(uploadErr, 'upload error')}`
        );
      }

      if (cover?.uri) {
        try {
          await restaurantOwnerApi.uploadCover(restaurantId, {
            uri: cover.uri,
            fileName: cover.fileName ?? 'cover.jpg',
            mimeType: cover.mimeType ?? 'image/jpeg',
          });
        } catch (uploadErr) {
          throw new Error(
            getApiErrorMessage(uploadErr, 'Restaurant created but cover upload failed')
          );
        }
      }

      setBanner({
        type: 'success',
        message: 'Restaurant registered and pending verification.',
      });
      await markRestaurantSetupComplete(restaurantId);
      setTimeout(() => router.replace('/dashboard'), 900);
    } catch (error) {
      setBanner({ type: 'error', message: getApiErrorMessage(error, 'Setup failed') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AuthShell
        title="Complete restaurant profile"
        subtitle="Add your restaurant details to start receiving orders."
        showBack
        onBackPress={goBack}
        footer={
          <View className="gap-3">
            <View className="flex-row gap-3">
              {step > 0 ? (
                <Pressable
                  onPress={goBack}
                  disabled={busy}
                  className="h-[52px] flex-1 flex-row items-center justify-center gap-1 rounded-xl border-2 border-gray-200 bg-white"
                >
                  <ChevronLeft color={theme.secondary} size={18} />
                  <Text className="text-[15px] font-bold text-secondary">Back</Text>
                </Pressable>
              ) : null}
              <View className={step > 0 ? 'flex-[2]' : 'flex-1'}>
                {step < 2 ? (
                  <PrimaryButton
                    label="Next"
                    trailingIcon={ChevronRight}
                    onPress={goNext}
                    disabled={busy}
                  />
                ) : (
                  <PrimaryButton
                    label="Register Restaurant"
                    onPress={submit}
                    loading={busy}
                    disabled={serviceHealth.data?.ok === false}
                  />
                )}
              </View>
            </View>
            {step === 0 ? (
              <Pressable
                onPress={goBack}
                disabled={busy}
                className="items-center py-1"
              >
                <Text className="text-sm font-semibold text-secondary-light">
                  Log out instead
                </Text>
              </Pressable>
            ) : null}
          </View>
        }
      >
        <SetupProgress
          step={step}
          maxStep={maxStep}
          onStep={(index) => {
            if (index <= maxStep) {
              setBanner(null);
              setStep(index as Step);
            }
          }}
        />

        {serviceHealth.data && !serviceHealth.data.ok ? (
          <AuthBanner
            type="error"
            message={
              serviceHealth.data.message ??
              'Restaurant service is unreachable. You cannot create an outlet until it is back.'
            }
          />
        ) : serviceHealth.data && !serviceHealth.data.ready ? (
          <AuthBanner
            type="error"
            message={
              serviceHealth.data.message ??
              'Restaurant database is not ready. Wait a moment and try again.'
            }
          />
        ) : null}
        {banner ? <AuthBanner type={banner.type} message={banner.message} /> : null}

        {step === 0 ? (
          <View className="gap-4">
            <SectionTitle icon={Store} title="Basic Information" />
            <View className="flex-row gap-3">
              <ImagePickCard
                title="Restaurant Logo"
                required
                subtitle="PNG/JPG • max 5MB"
                uri={logo?.uri}
                onPick={() => pickImage('logo')}
              />
              <ImagePickCard
                title="Cover Image"
                subtitle="Optional"
                uri={cover?.uri}
                onPick={() => pickImage('cover')}
              />
            </View>

            <Field label="Restaurant Name" required value={name} onChangeText={setName} placeholder="e.g. Spice Master Restaurant" />
            <TextArea label="Description" value={description} onChangeText={setDescription} />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="FSSAI License" value={fssai} onChangeText={setFssai} placeholder="12345678901234" />
              </View>
              <View className="flex-1">
                <Field label="GSTIN" value={gstin} onChangeText={setGstin} placeholder="22AAAAA0000A1Z5" />
              </View>
            </View>
            <Text className="text-sm font-semibold text-secondary">Price Range</Text>
            <View className="flex-row flex-wrap gap-2">
              {[
                { id: 'budget', label: 'Budget' },
                { id: 'moderate', label: 'Moderate' },
                { id: 'expensive', label: 'Expensive' },
                { id: 'fine_dining', label: 'Fine Dining' },
              ].map((opt) => (
                <Chip
                  key={opt.id}
                  label={opt.label}
                  active={priceRange === opt.id}
                  onPress={() => setPriceRange(opt.id as typeof priceRange)}
                />
              ))}
            </View>
            <Field
              label="Cost for Two (₹)"
              value={costForTwo}
              onChangeText={setCostForTwo}
              keyboardType="number-pad"
              placeholder="500"
            />
          </View>
        ) : null}

        {step === 1 ? (
          <View className="gap-4">
            <SectionTitle icon={MapPin} title="Address & Location" />

            <Pressable
              onPress={() => setMapOpen(true)}
              className="overflow-hidden rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-4"
            >
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-primary">
                  <MapPin color="#FFFFFF" size={22} />
                </View>
                <View className="flex-1">
                  <Text className="text-sm font-bold text-secondary">
                    {coords ? 'Change map location' : 'Pick restaurant location'}
                  </Text>
                <Text className="mt-0.5 text-xs text-secondary-light">
                  {coords
                    ? locationLabel ?? `Pinned: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`
                    : 'Search, auto-detect GPS, then confirm on the map'}
                </Text>
                {coords ? (
                  <Text className="mt-1 text-[11px] font-medium text-primary">
                    API: [lng {coords.lng.toFixed(5)}, lat {coords.lat.toFixed(5)}]
                  </Text>
                ) : null}
                </View>
                <ChevronRight color={theme.primary} size={20} />
              </View>
            </Pressable>

            <Field label="Street Address" required value={street} onChangeText={setStreet} placeholder="45 MG Road" />
            <Field label="Area / Locality" value={area} onChangeText={setArea} placeholder="Koramangala" />
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="City" required value={city} onChangeText={setCity} placeholder="Bangalore" />
              </View>
              <View className="flex-1">
                <Field label="State" required value={stateName} onChangeText={setStateName} placeholder="Karnataka" />
              </View>
            </View>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="Pincode" required value={pincode} onChangeText={setPincode} keyboardType="number-pad" placeholder="560034" />
              </View>
              <View className="flex-1">
                <Field label="Country" value={country} onChangeText={setCountry} placeholder="India" />
              </View>
            </View>
          </View>
        ) : null}

        {step === 2 ? (
          <View className="gap-4">
            <SectionTitle icon={UtensilsCrossed} title="Cuisine & Tags" />
            <Text className="text-sm text-secondary-light">
              Select cuisines you serve (optional). Helps customers discover you.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {cuisinesQuery.names.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={cuisines.includes(c)}
                  onPress={() =>
                    setCuisines((prev) => {
                      if (prev.includes(c)) return prev.filter((x) => x !== c);
                      if (prev.length >= 10) return prev;
                      return [...prev, c];
                    })
                  }
                />
              ))}
            </View>
            {cuisinesQuery.isError ? (
              <Text className="text-sm text-red-500">
                Could not load cuisine catalog. Showing a local list — save still
                works.
              </Text>
            ) : null}
            <View className="rounded-2xl border border-gray-200 bg-surface p-4">
              <Text className="text-sm font-bold text-secondary">Summary</Text>
              <SummaryRow label="Name" value={name || '—'} />
              <SummaryRow label="City" value={city ? `${city}, ${stateName}` : '—'} />
              <SummaryRow label="Cuisines" value={cuisines.length ? cuisines.join(', ') : '—'} />
              <SummaryRow label="Logo" value={logo?.fileName ?? (logo ? 'Selected' : '—')} />
              <SummaryRow label="Location" value={coords ? 'Pinned on map' : '—'} />
              {coords ? (
                <SummaryRow
                  label="Coordinates"
                  value={`[${coords.lng.toFixed(5)}, ${coords.lat.toFixed(5)}]`}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        {busy ? (
          <View className="mt-4 flex-row items-center justify-center gap-2">
            <ActivityIndicator color={theme.primary} />
            <Text className="text-sm text-secondary-light">Submitting…</Text>
          </View>
        ) : null}
      </AuthShell>

      <LocationMapPicker
        visible={mapOpen}
        initial={coords}
        autoDetectOnOpen={!coords}
        onClose={() => setMapOpen(false)}
        onConfirm={(result) => {
          setCoords({ lat: result.lat, lng: result.lng });
          setLocationLabel(result.formattedAddress || result.label);
          const parsed = parseDeliveryAddress({
            formattedAddress: result.formattedAddress || result.label,
            label: result.label,
            lat: result.lat,
            lng: result.lng,
          });
          // Prefill form from the confirmed pin (user can still edit).
          if (!street.trim() || street.trim().length < 3) {
            setStreet(parsed.street);
          }
          if (!area.trim()) setArea(parsed.area);
          if (!city.trim() || city.trim().length < 2) setCity(parsed.city);
          if (!stateName.trim() || stateName.trim().length < 2) {
            setStateName(parsed.state);
          }
          if (!pincode.trim() || pincode.trim().length < 4) {
            setPincode(parsed.pincode === '000000' ? '' : parsed.pincode);
          }
          setMapOpen(false);
          setBanner({
            type: 'success',
            message: 'Location confirmed. Address fields updated — review before continuing.',
          });
        }}
      />
    </>
  );
}

function ImagePickCard({
  title,
  subtitle,
  uri,
  onPick,
  required,
}: {
  title: string;
  subtitle: string;
  uri?: string;
  onPick: () => void;
  required?: boolean;
}) {
  return (
    <Pressable
      onPress={onPick}
      className="flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white"
      style={cardShadow}
    >
      <View className="px-3 py-2.5">
        <Text className="text-xs font-bold uppercase tracking-wider text-secondary-light">
          {title}
          {required ? <Text className="text-danger"> *</Text> : null}
        </Text>
        <Text className="text-xs text-gray-400">{subtitle}</Text>
      </View>
      <View className="h-28 items-center justify-center bg-surface">
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <View className="items-center gap-2">
            <UploadCloud color={theme.muted} size={22} />
            <Text className="text-xs font-medium text-secondary-light">Tap to upload</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  required,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  required?: boolean;
}) {
  return (
    <View>
      {required ? (
        <RequiredLabel>{label}</RequiredLabel>
      ) : (
        <Text className="mb-1.5 text-sm font-semibold text-secondary">{label}</Text>
      )}
      <View className="h-12 justify-center rounded-xl border border-gray-200 bg-white px-3.5">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.muted}
          keyboardType={keyboardType}
          className="text-[15px] text-secondary"
        />
      </View>
    </View>
  );
}

function TextArea({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <View>
      <Text className="mb-1.5 text-sm font-semibold text-secondary">{label}</Text>
      <View className="rounded-xl border border-gray-200 bg-white px-3.5 py-2">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Tell customers about your restaurant…"
          placeholderTextColor={theme.muted}
          multiline
          className="min-h-[80px] text-[15px] text-secondary"
        />
      </View>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-3 py-2 ${
        active ? 'border-primary bg-primary/10' : 'border-gray-200 bg-white'
      }`}
    >
      <Text className={`text-xs font-semibold ${active ? 'text-primary' : 'text-secondary-light'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <Text className="mt-1.5 text-sm text-secondary-light">
      <Text className="font-semibold text-secondary">{label}: </Text>
      {value}
    </Text>
  );
}
