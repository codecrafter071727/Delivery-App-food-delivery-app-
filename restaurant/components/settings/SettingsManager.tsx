import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Building2,
  Clock3,
  ImageIcon,
  Lock,
  Settings2,
  Store,
  Trash2,
  Users,
} from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { KitchenDutyCard } from '@/components/dashboard/KitchenDutyCard';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { KitchenHoursEditor } from '@/components/settings/KitchenHoursEditor';
import { KitchenPushCard } from '@/components/settings/KitchenPushCard';
import { RestaurantPhotosManager } from '@/components/settings/RestaurantPhotosManager';
import { StaffManager } from '@/components/staff/StaffManager';
import {
  LocationMapPicker,
  type MapPickResult,
} from '@/components/restaurant/LocationMapPicker';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  useRestaurantDetail,
  useRestaurantSettingsMutations,
} from '@/lib/restaurant/settings-hooks';
import { useCuisineCatalog, restaurantOutletKeys } from '@/lib/restaurant/hooks';
import {
  PRICE_RANGE_OPTIONS,
  type RestaurantDetail,
  type RestaurantSettings,
  type UpdateRestaurantPayload,
} from '@/lib/restaurant/settings-types';
import { useAuthStore } from '@/store/auth-store';

type TabKey =
  | 'profile'
  | 'images'
  | 'hours'
  | 'operations'
  | 'staff'
  | 'security';

const TABS: { key: TabKey; label: string; Icon: typeof Building2 }[] = [
  { key: 'profile', label: 'Profile', Icon: Building2 },
  { key: 'images', label: 'Photos', Icon: ImageIcon },
  { key: 'hours', label: 'Hours', Icon: Clock3 },
  { key: 'operations', label: 'Operations', Icon: Settings2 },
  { key: 'staff', label: 'Staff', Icon: Users },
  { key: 'security', label: 'Security', Icon: Lock },
];

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  secureTextEntry?: boolean;
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
        secureTextEntry={secureTextEntry}
        autoCapitalize={secureTextEntry ? 'none' : undefined}
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
  children: ReactNode;
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

function ProfileTab({
  detail,
  busy,
  onSave,
}: {
  detail: RestaurantDetail;
  busy: boolean;
  onSave: (payload: UpdateRestaurantPayload) => void;
}) {
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
  }, [detail]);

  const toggleCuisine = (cuisine: string) => {
    setCuisines((prev) => {
      if (prev.includes(cuisine)) return prev.filter((item) => item !== cuisine);
      if (prev.length >= 10) return prev;
      return [...prev, cuisine];
    });
  };

  const onMapConfirm = (result: MapPickResult) => {
    setCoords({ lat: result.lat, lng: result.lng });
    setMapDirty(true);
    if (result.formattedAddress) {
      if (!street.trim()) setStreet(result.label || result.formattedAddress);
    }
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

    if (addressChanged) {
      payload.address = {
        street: street.trim(),
        area: area.trim() || undefined,
        city: city.trim(),
        state: stateName.trim(),
        country: country.trim() || 'India',
        pincode: pincode.trim(),
      };
    }

    // Existing DB rows sometimes store coordinates without GeoJSON `type: "Point"`.
    // Mongo then rejects ANY update. Repair only when needed, or when map changed.
    const locationBroken = Boolean(coords) && detail.locationGeoValid === false;

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

      <Section title="Address & Location">
        <Pressable
          onPress={() => setMapOpen(true)}
          style={({ pressed }) => [
            styles.secondaryBtn,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryBtnText}>Change on Map</Text>
        </Pressable>
        {coords ? (
          <View style={styles.locationOk}>
            <Text style={styles.locationOkText}>
              Location set: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              {detail.locationGeoValid === false
                ? ' · will auto-fix map format on save'
                : ''}
            </Text>
          </View>
        ) : (
          <Text style={styles.meta}>No coordinates set yet.</Text>
        )}
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
          const payload = buildPartialPayload();
          if (!payload) {
            Alert.alert('No changes', 'Edit a field before saving.');
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
      />
    </View>
  );
}

function OperationsTab({
  restaurantId,
  detail,
  busy,
  onSave,
}: {
  restaurantId: string;
  detail: RestaurantDetail;
  busy: boolean;
  onSave: (settings: RestaurantSettings) => void;
}) {
  const router = useRouter();
  const settings = detail.settings ?? {};

  const [taxRate, setTaxRate] = useState(String(settings.taxRate ?? ''));
  const [packagingCharge, setPackagingCharge] = useState(
    String(settings.packagingCharge ?? '')
  );
  const [minOrderValue, setMinOrderValue] = useState(
    String(settings.minOrderValue ?? '')
  );
  const [freeDeliveryThreshold, setFreeDeliveryThreshold] = useState(
    String(settings.freeDeliveryThreshold ?? '')
  );
  const [maxDeliveryRadius, setMaxDeliveryRadius] = useState(
    String(settings.maxDeliveryRadius ?? '')
  );
  const [avgPreparationTime, setAvgPreparationTime] = useState(
    String(settings.avgPreparationTime ?? '')
  );
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(
    Boolean(settings.autoAcceptOrders)
  );
  const [acceptScheduledOrders, setAcceptScheduledOrders] = useState(
    Boolean(settings.acceptScheduledOrders)
  );
  const [pureVegetarian, setPureVegetarian] = useState(
    Boolean(settings.pureVegetarian)
  );
  const [cashOnDelivery, setCashOnDelivery] = useState(
    settings.cashOnDelivery !== false
  );
  const [onlinePayments, setOnlinePayments] = useState(
    settings.onlinePayments !== false
  );
  const [sellsAlcohol, setSellsAlcohol] = useState(
    Boolean(settings.sellsAlcohol)
  );
  const [acceptPreOrders, setAcceptPreOrders] = useState(
    Boolean(settings.acceptPreOrders)
  );

  useEffect(() => {
    const next = detail.settings ?? {};
    setTaxRate(String(next.taxRate ?? ''));
    setPackagingCharge(String(next.packagingCharge ?? ''));
    setMinOrderValue(String(next.minOrderValue ?? ''));
    setFreeDeliveryThreshold(String(next.freeDeliveryThreshold ?? ''));
    setMaxDeliveryRadius(String(next.maxDeliveryRadius ?? ''));
    setAvgPreparationTime(String(next.avgPreparationTime ?? ''));
    setAutoAcceptOrders(Boolean(next.autoAcceptOrders));
    setAcceptScheduledOrders(Boolean(next.acceptScheduledOrders));
    setPureVegetarian(Boolean(next.pureVegetarian));
    setCashOnDelivery(next.cashOnDelivery !== false);
    setOnlinePayments(next.onlinePayments !== false);
    setSellsAlcohol(Boolean(next.sellsAlcohol));
    setAcceptPreOrders(Boolean(next.acceptPreOrders));
  }, [detail]);

  const num = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return (
    <View style={{ gap: 14 }}>
      <KitchenDutyCard restaurantId={restaurantId} />
      <KitchenPushCard restaurantId={restaurantId} />

      <Pressable
        onPress={() => router.push('/chain')}
        style={styles.chainRow}
      >
        <Store color={authTheme.brand} size={18} />
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleLabel}>Other outlets</Text>
          <Text style={styles.meta}>
            Copy menu, prices, sold-out and operations to sibling restaurants.
          </Text>
        </View>
      </Pressable>

      <Section title="Financial Settings">
        <Field
          label="Tax Rate (%)"
          value={taxRate}
          onChangeText={setTaxRate}
          keyboardType="numeric"
        />
        <Field
          label="Packaging Charge (₹)"
          value={packagingCharge}
          onChangeText={setPackagingCharge}
          keyboardType="numeric"
        />
        <Field
          label="Minimum Order Value (₹)"
          value={minOrderValue}
          onChangeText={setMinOrderValue}
          keyboardType="numeric"
        />
        <Field
          label="Free Delivery Threshold (₹)"
          value={freeDeliveryThreshold}
          onChangeText={setFreeDeliveryThreshold}
          keyboardType="numeric"
        />
      </Section>

      <Section title="Delivery Settings">
        <Field
          label="Max Delivery Radius (km)"
          value={maxDeliveryRadius}
          onChangeText={setMaxDeliveryRadius}
          keyboardType="numeric"
        />
        <Field
          label="Avg. Preparation Time (min)"
          value={avgPreparationTime}
          onChangeText={setAvgPreparationTime}
          keyboardType="numeric"
        />
      </Section>

      <Section title="Order Preferences">
        {(
          [
            ['Auto-accept orders', autoAcceptOrders, setAutoAcceptOrders],
            ['Accept scheduled orders', acceptScheduledOrders, setAcceptScheduledOrders],
            ['Pure vegetarian restaurant', pureVegetarian, setPureVegetarian],
            ['Cash on delivery', cashOnDelivery, setCashOnDelivery],
            ['Online payments', onlinePayments, setOnlinePayments],
            ['Accept pre-orders', acceptPreOrders, setAcceptPreOrders],
            ['Serve alcohol', sellsAlcohol, setSellsAlcohol],
          ] as const
        ).map(([label, value, setter]) => (
          <View key={label} style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{label}</Text>
            <Switch
              value={value}
              onValueChange={setter}
              trackColor={{ false: '#E2E8F0', true: 'rgba(122,14,34,0.35)' }}
              thumbColor={value ? authTheme.brand : '#F8FAFC'}
            />
          </View>
        ))}
        <Text style={styles.meta}>
          Alcohol can only be turned on where city law allows delivery. Dry
          cities stay off — the save will explain why.
        </Text>
      </Section>

      <PrimaryButton
        label="Save Operations"
        loading={busy}
        onPress={() =>
          onSave({
            taxRate: num(taxRate),
            packagingCharge: num(packagingCharge),
            minOrderValue: num(minOrderValue),
            freeDeliveryThreshold: num(freeDeliveryThreshold),
            maxDeliveryRadius: num(maxDeliveryRadius),
            avgPreparationTime: num(avgPreparationTime),
            autoAcceptOrders,
            acceptScheduledOrders,
            pureVegetarian,
            cashOnDelivery,
            onlinePayments,
            acceptPreOrders,
            sellsAlcohol,
          })
        }
      />
    </View>
  );
}

function StaffTab() {
  return <StaffManager />;
}

function SecurityTab() {
  const changePassword = useAuthStore((s) => s.changePassword);
  const isLoading = useAuthStore((s) => s.isLoading);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  return (
    <View style={{ gap: 14 }}>
      <Section title="Change Password">
        <Field
          label="Current Password"
          value={oldPassword}
          onChangeText={setOldPassword}
          secureTextEntry
        />
        <Field
          label="New Password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
        />
        <Field
          label="Confirm New Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
        />
      </Section>
      <PrimaryButton
        label="Update Password"
        icon={Lock}
        loading={isLoading}
        onPress={() => {
          if (oldPassword.length < 6 || newPassword.length < 6) {
            Alert.alert('Invalid password', 'Passwords must be at least 6 characters.');
            return;
          }
          if (newPassword !== confirmPassword) {
            Alert.alert('Mismatch', 'New password and confirmation do not match.');
            return;
          }
          void changePassword({
            oldPassword,
            newPassword,
            confirmPassword,
          })
            .then((message) => {
              Alert.alert('Updated', message || 'Password updated successfully.');
              setOldPassword('');
              setNewPassword('');
              setConfirmPassword('');
            })
            .catch((error) => {
              Alert.alert(
                'Update failed',
                error instanceof Error ? error.message : 'Could not update password'
              );
            });
        }}
      />
    </View>
  );
}

export function SettingsManager() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('profile');
  const detailQuery = useRestaurantDetail(true);
  const restaurantId = detailQuery.restaurantId;
  const mutations = useRestaurantSettingsMutations(restaurantId);

  const detail = detailQuery.data;

  const busy =
    mutations.updateProfile.isPending ||
    mutations.updateStatus.isPending ||
    mutations.updateTimings.isPending ||
    mutations.updateSettings.isPending ||
    mutations.uploadLogo.isPending ||
    mutations.uploadCover.isPending ||
    mutations.uploadGallery.isPending ||
    mutations.deleteGalleryImage.isPending;

  const refresh = async () => {
    await Promise.all([
      detailQuery.refetch(),
      queryClient.invalidateQueries({ queryKey: restaurantOutletKeys.all }),
    ]);
  };

  const run = async (fn: () => Promise<unknown>, success: string) => {
    try {
      await fn();
      Alert.alert('Saved', success);
    } catch (error) {
      Alert.alert(
        'Save failed',
        error instanceof Error ? error.message : 'Could not save changes'
      );
    }
  };

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Settings"
        subtitle={
          detail?.name
            ? `${detail.name} · profile & operations`
            : 'Profile, images, hours & operations'
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: PARTNER_BOTTOM_NAV_INSET,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={detailQuery.isRefetching}
            onRefresh={() => void refresh()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {TABS.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Icon
                  color={active ? authTheme.brand : authTheme.textMuted}
                  size={16}
                />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {!restaurantId ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No restaurant found</Text>
            <Text style={styles.meta}>
              Complete restaurant setup before editing settings.
            </Text>
          </View>
        ) : detailQuery.isLoading && !detail ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : detailQuery.isError && !detail ? (
          <View style={styles.empty}>
            <Text style={styles.errorText}>
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : 'Could not load restaurant'}
            </Text>
            <PrimaryButton label="Retry" onPress={() => void refresh()} />
          </View>
        ) : detail ? (
          <>
            {tab === 'profile' ? (
              <ProfileTab
                detail={detail}
                busy={busy}
                onSave={(payload) =>
                  void run(
                    () => mutations.updateProfile.mutateAsync(payload),
                    'Profile updated.'
                  )
                }
              />
            ) : null}
            {tab === 'images' ? (
              <RestaurantPhotosManager
                detail={detail}
                busy={busy}
                onUploadLogo={(file) => mutations.uploadLogo.mutateAsync(file)}
                onUploadCover={(file) => mutations.uploadCover.mutateAsync(file)}
                onUploadGallery={(files) =>
                  mutations.uploadGallery.mutateAsync(files)
                }
                onDeleteImage={(image) =>
                  mutations.deleteGalleryImage.mutateAsync(image)
                }
              />
            ) : null}
            {tab === 'hours' ? (
              <KitchenHoursEditor
                restaurantId={restaurantId}
                busy={busy}
                onSave={(next) =>
                  void run(
                    () =>
                      mutations.updateTimings.mutateAsync({ timings: next }),
                    'Hours saved.'
                  )
                }
              />
            ) : null}
            {tab === 'operations' ? (
              <OperationsTab
                restaurantId={restaurantId}
                detail={detail}
                busy={busy}
                onSave={(settings) =>
                  void run(
                    () => mutations.updateSettings.mutateAsync(settings),
                    'Operations saved.'
                  )
                }
              />
            ) : null}
            {tab === 'staff' ? <StaffTab /> : null}
            {tab === 'security' ? <SecurityTab /> : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F5F5' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  heading: {
    color: authTheme.text,
    fontSize: 26,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.4,
  },
  subheading: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    marginTop: -6,
  },
  tabs: { gap: 8, paddingVertical: 4 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
  },
  tabActive: {
    borderColor: authTheme.brand,
    backgroundColor: authTheme.brandSoft,
  },
  tabText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  tabTextActive: { color: authTheme.brand },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: authTheme.text,
    fontSize: 16,
    fontFamily: fonts.bold,
  },
  sectionHint: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
    marginTop: -4,
  },
  field: { gap: 6 },
  label: {
    color: authTheme.text,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  input: {
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
    backgroundColor: '#FAFAFA',
  },
  inputMultiline: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  chipActive: {
    backgroundColor: authTheme.brand,
    borderColor: authTheme.brand,
  },
  chipText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  chipTextActive: { color: '#FFFFFF' },
  meta: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
  },
  secondaryBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.18)',
    backgroundColor: authTheme.brandSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  locationOk: {
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  locationOkText: {
    color: '#059669',
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  logoBox: {
    width: 110,
    height: 110,
    borderRadius: 16,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: { width: '100%', height: '100%' },
  coverBox: {
    width: '100%',
    height: 140,
    borderRadius: 16,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  coverImage: { width: '100%', height: '100%' },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  galleryItem: {
    width: 96,
    height: 96,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: authTheme.surface,
  },
  galleryImage: { width: '100%', height: '100%' },
  galleryDelete: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(15,23,42,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(122,14,34,0.1)',
    paddingTop: 10,
    gap: 8,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayLabel: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slotInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: authTheme.text,
    fontFamily: fonts.medium,
    backgroundColor: '#FAFAFA',
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  statusText: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.semiBold,
    flex: 1,
  },
  statusBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusBtnOffline: { borderColor: 'rgba(239,68,68,0.35)' },
  statusBtnOnline: { borderColor: 'rgba(34,197,94,0.35)' },
  statusBtnText: { fontSize: 12, fontFamily: fonts.bold },
  statusBtnTextOffline: { color: authTheme.error },
  statusBtnTextOnline: { color: authTheme.success },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  toggleLabel: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.semiBold,
    flex: 1,
    paddingRight: 12,
  },
  chainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  staffHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  addStaffBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 44,
  },
  addStaffBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  inviteCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 14,
    gap: 10,
  },
  inviteTitle: {
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FAFAFA',
    minHeight: 48,
  },
  inputFlex: {
    flex: 1,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
    paddingVertical: 12,
  },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inviteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  cancelPill: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    backgroundColor: authTheme.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  staffCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 14,
  },
  staffName: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 8,
  },
  emptyTitle: {
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.extraBold,
  },
  center: { paddingVertical: 40, alignItems: 'center' },
  errorText: {
    color: authTheme.error,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
  cancelText: {
    color: authTheme.textMuted,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
});
