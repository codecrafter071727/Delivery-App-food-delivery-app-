import * as ImagePicker from 'expo-image-picker';
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Landmark,
  MapPin,
  ShieldAlert,
  Upload,
  UtensilsCrossed,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { isListingLive } from '@/lib/restaurant/listing-status';
import { useMyRestaurantId } from '@/lib/order/hooks';
import {
  useIfscLookup,
  useOnboardingDocuments,
  useOnboardingMutations,
  useOnboardingStatus,
  useRestaurantBank,
} from '@/lib/restaurant/onboarding-hooks';
import {
  FSSAI_RE,
  GSTIN_RE,
  IFSC_RE,
  KYC_FILE,
  PAN_RE,
  type KycDocType,
  type OnboardingStep,
  type OnboardingStepKey,
} from '@/lib/restaurant/onboarding-types';

type UploadFile = { uri: string; fileName: string; mimeType: string };
type ExpandKey = 'fssai' | 'gst' | 'pan' | 'bank' | 'photos' | null;

function mimeFromAsset(asset: ImagePicker.ImagePickerAsset) {
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime) return mime;
  const name = (asset.fileName || asset.uri).toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'image/jpeg';
}

async function pickKycPhoto(): Promise<UploadFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert('Photos needed', 'Allow photo access to upload KYC documents.');
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const mime = mimeFromAsset(asset);
  if (asset.fileSize && asset.fileSize > KYC_FILE.maxBytes) {
    Alert.alert('File too large', 'Each document must be under 8 MB.');
    return null;
  }
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return {
    uri: asset.uri,
    fileName: asset.fileName || `kyc-${Date.now()}.${ext}`,
    mimeType: mime.startsWith('image/') ? mime : 'image/jpeg',
  };
}

function statusChip(kycStatus: string, listingStatus: string) {
  if (isListingLive(listingStatus)) {
    return { label: 'Listing live', color: '#15803D', bg: '#DCFCE7' };
  }
  if (kycStatus === 'rejected') {
    return { label: 'Needs changes', color: '#B91C1C', bg: '#FEE2E2' };
  }
  if (kycStatus === 'submitted' || kycStatus === 'under_review') {
    return { label: 'Under review', color: '#B45309', bg: '#FEF3C7' };
  }
  return { label: 'Not live', color: '#475569', bg: '#F1F5F9' };
}

function listingTrackLabel(listingStatus: string) {
  if (isListingLive(listingStatus)) return 'Live';
  if (listingStatus === 'suspended') return 'Suspended';
  if (listingStatus === 'closed') return 'Closed';
  if (listingStatus === 'rejected') return 'Rejected';
  return 'Not live';
}

function kycTrackLabel(kycStatus: string) {
  if (kycStatus === 'rejected') return 'Needs changes';
  if (kycStatus === 'submitted' || kycStatus === 'under_review') return 'With ops';
  return 'In progress';
}

function bankTrackLabel(verificationStatus?: string, payoutsEnabled?: boolean) {
  if (payoutsEnabled || verificationStatus === 'verified') return 'Verified';
  if (verificationStatus === 'failed') return 'Failed';
  return 'Unverified';
}

function docStatus(status?: string) {
  if (status === 'verified') return { label: 'Verified', color: '#15803D' };
  if (status === 'rejected') return { label: 'Rejected', color: '#B91C1C' };
  if (status === 'uploaded') return { label: 'Uploaded', color: '#B45309' };
  return { label: 'Not uploaded', color: authTheme.textMuted };
}

export function OnboardingManager() {
  const router = useRouter();
  const restaurant = useMyRestaurantId();
  const restaurantId = restaurant.data?.id ?? '';
  const statusQuery = useOnboardingStatus(restaurantId);
  const docsQuery = useOnboardingDocuments(restaurantId);
  const bankQuery = useRestaurantBank(restaurantId);
  const mutations = useOnboardingMutations(restaurantId);

  const [expand, setExpand] = useState<ExpandKey>(null);
  const [fssaiNo, setFssaiNo] = useState('');
  const [gstin, setGstin] = useState('');
  const [panNo, setPanNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [holderName, setHolderName] = useState('');
  const pendingFile = useMemo(() => ({ current: null as UploadFile | null }), []);
  const [fileTick, setFileTick] = useState(0);

  const ifscQuery = useIfscLookup(restaurantId, ifsc);
  const status = statusQuery.data;
  const docs = docsQuery.data;
  const bank = bankQuery.data;
  const listingLive = isListingLive(status?.listingStatus);
  const kycWaiting =
    status?.kycStatus === 'submitted' || status?.kycStatus === 'under_review';
  const locked = Boolean(kycWaiting && !listingLive);
  const chip = status
    ? statusChip(status.kycStatus, status.listingStatus)
    : null;

  const latest = (type: KycDocType) =>
    docs?.documents.find((row) => row.type === type);

  const setPicked = (file: UploadFile | null) => {
    pendingFile.current = file;
    setFileTick((n) => n + 1);
  };

  const refresh = async () => {
    await Promise.all([
      statusQuery.refetch(),
      docsQuery.refetch(),
      bankQuery.refetch(),
    ]);
  };

  const runUpload = async (payload: Parameters<typeof mutations.uploadDocuments.mutateAsync>[0]) => {
    try {
      await mutations.uploadDocuments.mutateAsync(payload);
      setPicked(null);
      Alert.alert('Saved', 'Document details were uploaded.');
    } catch (error) {
      Alert.alert(
        'Upload failed',
        getApiErrorMessage(error, 'Could not upload document')
      );
    }
  };

  const saveLicense = async (kind: 'fssai' | 'gst' | 'pan') => {
    if (kind === 'fssai') {
      if (fssaiNo && !FSSAI_RE.test(fssaiNo)) {
        Alert.alert('Invalid FSSAI', 'FSSAI license must be 14 digits.');
        return;
      }
      await runUpload({
        fssaiLicense: fssaiNo || undefined,
        fssai: pendingFile.current ?? undefined,
      });
      return;
    }
    if (kind === 'gst') {
      const value = gstin.trim().toUpperCase();
      if (value && !GSTIN_RE.test(value)) {
        Alert.alert('Invalid GSTIN', 'Enter a valid 15-character GSTIN.');
        return;
      }
      await runUpload({
        gstin: value || undefined,
        gst: pendingFile.current ?? undefined,
      });
      return;
    }
    const value = panNo.trim().toUpperCase();
    if (value && !PAN_RE.test(value)) {
      Alert.alert('Invalid PAN', 'Enter a valid 10-character PAN.');
      return;
    }
    await runUpload({
      panNumber: value || undefined,
      pan: pendingFile.current ?? undefined,
    });
  };

  const saveBank = async () => {
    const code = ifsc.replace(/\s/g, '').toUpperCase();
    const account = accountNo.replace(/\s/g, '');
    if (!IFSC_RE.test(code)) {
      Alert.alert('Invalid IFSC', 'IFSC looks like HDFC0001234.');
      return;
    }
    if (!/^\d{9,18}$/.test(account)) {
      Alert.alert('Invalid account', 'Account number must be 9–18 digits.');
      return;
    }
    if (holderName.trim().length < 2) {
      Alert.alert('Holder name', 'Enter the name as printed on the passbook.');
      return;
    }
    try {
      await mutations.updateBank.mutateAsync({
        accountNo: account,
        ifsc: code,
        holderName: holderName.trim(),
      });
      if (pendingFile.current) {
        try {
          await mutations.uploadDocuments.mutateAsync({
            cancelledCheque: pendingFile.current,
          });
          setPicked(null);
        } catch (error) {
          Alert.alert(
            'Bank saved, cheque failed',
            getApiErrorMessage(error, 'Account is saved. Upload the cheque again.')
          );
          return;
        }
      }
      Alert.alert(
        'Bank saved',
        'Account is unverified until ops confirms it. Payouts stay off until then.'
      );
    } catch (error) {
      Alert.alert(
        'Could not save bank',
        getApiErrorMessage(error, 'Check IFSC and account number.')
      );
    }
  };

  const submit = () => {
    Alert.alert(
      'Submit for review?',
      'Admin will verify FSSAI and activate your listing. You cannot go online until then.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Submit',
          onPress: () => {
            void mutations.submitKyc
              .mutateAsync()
              .then(() =>
                Alert.alert(
                  'Submitted',
                  'Your KYC is with the team. We will notify you after approval.'
                )
              )
              .catch((error) =>
                Alert.alert(
                  'Cannot submit',
                  getApiErrorMessage(
                    error,
                    'Add FSSAI number and certificate first.'
                  )
                )
              );
          },
        },
      ]
    );
  };

  const pickAndSet = async () => {
    const file = await pickKycPhoto();
    if (file) setPicked(file);
  };

  const stepNav = (key: OnboardingStepKey) => {
    if (key === 'profile' || key === 'address') {
      router.push('/settings');
      return;
    }
    if (key === 'menu') {
      router.push('/menu');
      return;
    }
    if (key === 'photos') {
      setExpand(expand === 'photos' ? null : 'photos');
      return;
    }
    if (key === 'fssai' || key === 'gst' || key === 'pan' || key === 'bank') {
      setExpand(expand === key ? null : key);
      setPicked(null);
    }
  };

  const loading =
    (statusQuery.isLoading && !status) ||
    (docsQuery.isLoading && !docs) ||
    (bankQuery.isLoading && !bank);

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Listing & KYC"
        subtitle="FSSAI, bank, and go-live"
        showBack
        hideProfile
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={
              statusQuery.isRefetching ||
              docsQuery.isRefetching ||
              bankQuery.isRefetching
            }
            onRefresh={() => void refresh()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {!restaurantId ? (
          <Text style={styles.muted}>Complete restaurant setup first.</Text>
        ) : loading ? (
          <ActivityIndicator color={authTheme.brand} style={{ marginTop: 24 }} />
        ) : statusQuery.isError ? (
          <Text style={styles.error}>
            {getApiErrorMessage(statusQuery.error, 'Could not load onboarding')}
          </Text>
        ) : status ? (
          <>
            <View style={styles.hero}>
              <View style={styles.percentWrap}>
                <Text style={styles.percent}>{status.percent}%</Text>
                <Text style={styles.percentLabel}>complete</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>Partner onboarding</Text>
                <Text style={styles.heroSub}>
                  Ops must approve your listing after you submit. Saving KYC or
                  bank does not go live.
                </Text>
                {chip ? (
                  <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                    <Text style={[styles.chipText, { color: chip.color }]}>
                      {chip.label}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.trackRow}>
              <TrackCell
                label="Listing"
                value={listingTrackLabel(status.listingStatus)}
                live={listingLive}
              />
              <TrackCell
                label="KYC"
                value={kycTrackLabel(status.kycStatus)}
                live={false}
              />
              <TrackCell
                label="Bank"
                value={bankTrackLabel(bank?.verificationStatus, bank?.payoutsEnabled)}
                live={bank?.payoutsEnabled === true}
              />
            </View>

            <View style={styles.track}>
              <View
                style={[
                  styles.trackFill,
                  { width: `${Math.max(6, Math.min(100, status.percent))}%` },
                ]}
              />
            </View>

            {status.rejectReason ? (
              <View style={styles.rejectBox}>
                <ShieldAlert color="#B91C1C" size={16} />
                <Text style={styles.rejectText}>{status.rejectReason}</Text>
              </View>
            ) : null}

            {locked ? (
              <View style={styles.waitBox}>
                <Clock3 color="#B45309" size={16} />
                <Text style={styles.waitText}>
                  KYC is with ops. Your listing stays not live until they
                  approve. You cannot go online yet.
                </Text>
              </View>
            ) : null}

            {listingLive ? (
              <View style={styles.liveBox}>
                <CheckCircle2 color="#15803D" size={16} />
                <Text style={styles.liveText}>
                  Ops approved this listing. Go online from Home. Bank payouts
                  stay off until ops verifies the account.
                </Text>
              </View>
            ) : null}

            <Text style={styles.sectionLabel}>Checklist</Text>
            <View style={styles.card}>
              {status.steps.map((step, index) => (
                <StepRow
                  key={step.key}
                  step={step}
                  last={index === status.steps.length - 1}
                  locked={locked && ['fssai', 'gst', 'pan', 'bank', 'photos'].includes(step.key)}
                  onPress={() => stepNav(step.key)}
                />
              ))}
            </View>

            {expand === 'fssai' && !locked ? (
              <LicenseCard
                title="FSSAI license"
                hint="14-digit number + photo of the certificate. Required to submit."
                placeholder="14-digit FSSAI"
                keyboard="number-pad"
                maxLength={14}
                value={fssaiNo}
                onChangeText={(text) => setFssaiNo(text.replace(/\D/g, ''))}
                masked={docs?.fssaiMasked}
                doc={latest('fssai')}
                file={fileTick ? pendingFile.current : null}
                busy={mutations.uploadDocuments.isPending}
                onPick={() => void pickAndSet()}
                onSave={() => void saveLicense('fssai')}
              />
            ) : null}

            {expand === 'gst' && !locked ? (
              <LicenseCard
                title="GSTIN"
                hint="Optional. 15-character GSTIN and certificate photo."
                placeholder="22AAAAA0000A1Z5"
                autoCapitalize="characters"
                maxLength={15}
                value={gstin}
                onChangeText={(text) => setGstin(text.replace(/\s/g, '').toUpperCase())}
                masked={docs?.gstinMasked}
                doc={latest('gst')}
                file={fileTick ? pendingFile.current : null}
                busy={mutations.uploadDocuments.isPending}
                onPick={() => void pickAndSet()}
                onSave={() => void saveLicense('gst')}
              />
            ) : null}

            {expand === 'pan' && !locked ? (
              <LicenseCard
                title="PAN"
                hint="Optional. 10-character PAN and photo."
                placeholder="ABCDE1234F"
                autoCapitalize="characters"
                maxLength={10}
                value={panNo}
                onChangeText={(text) => setPanNo(text.replace(/\s/g, '').toUpperCase())}
                masked={docs?.panMasked}
                doc={latest('pan')}
                file={fileTick ? pendingFile.current : null}
                busy={mutations.uploadDocuments.isPending}
                onPick={() => void pickAndSet()}
                onSave={() => void saveLicense('pan')}
              />
            ) : null}

            {expand === 'bank' ? (
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>Settlement bank</Text>
                <Text style={styles.formHint}>
                  Saved as unverified. Payouts turn on only after ops verifies
                  the account.
                </Text>
                {bank?.accountMasked ? (
                  <Text style={styles.masked}>
                    {bank.holderName ? `${bank.holderName} · ` : ''}
                    {bank.accountMasked}
                    {bank.ifsc ? ` · ${bank.ifsc}` : ''}
                    {` · ${bank.payoutsEnabled ? 'Payouts on' : 'Unverified'}`}
                  </Text>
                ) : null}
                <Field
                  label="IFSC"
                  value={ifsc}
                  onChangeText={(text) =>
                    setIfsc(text.replace(/\s/g, '').toUpperCase())
                  }
                  placeholder="HDFC0001234"
                  autoCapitalize="characters"
                  maxLength={11}
                  editable={!locked}
                />
                {ifscQuery.data?.bank ? (
                  <Text style={styles.ifscHit}>
                    {ifscQuery.data.bank}
                    {ifscQuery.data.branch ? ` · ${ifscQuery.data.branch}` : ''}
                    {ifscQuery.data.city ? ` · ${ifscQuery.data.city}` : ''}
                  </Text>
                ) : ifscQuery.isError ? (
                  <Text style={styles.error}>
                    {getApiErrorMessage(ifscQuery.error, 'Unknown IFSC')}
                  </Text>
                ) : null}
                <Field
                  label="Account number"
                  value={accountNo}
                  onChangeText={(text) => setAccountNo(text.replace(/\D/g, ''))}
                  placeholder="9–18 digits"
                  keyboardType="number-pad"
                  maxLength={18}
                  editable={!locked}
                />
                <Field
                  label="Account holder name"
                  value={holderName}
                  onChangeText={setHolderName}
                  placeholder="As on passbook"
                  editable={!locked}
                />
                <Text style={styles.formHint}>Cancelled cheque (optional)</Text>
                <UploadRow
                  file={fileTick ? pendingFile.current : null}
                  doc={latest('cancelledCheque')}
                  disabled={locked}
                  onPick={() => void pickAndSet()}
                />
                {!locked ? (
                  <PrimaryButton
                    label="Save bank account"
                    loading={
                      mutations.updateBank.isPending ||
                      mutations.uploadDocuments.isPending
                    }
                    onPress={() => void saveBank()}
                  />
                ) : null}
              </View>
            ) : null}

            {expand === 'photos' && !locked ? (
              <View style={styles.formCard}>
                <Text style={styles.formTitle}>Outlet photos</Text>
                <Text style={styles.formHint}>
                  Kitchen / storefront photos for KYC (max 8). Logo and cover
                  also count — add those in Settings → Photos.
                </Text>
                <UploadRow
                  file={fileTick ? pendingFile.current : null}
                  disabled={false}
                  onPick={() => void pickAndSet()}
                />
                <PrimaryButton
                  label="Upload photo"
                  loading={mutations.uploadDocuments.isPending}
                  onPress={() => {
                    if (!pendingFile.current) {
                      Alert.alert('Choose a photo', 'Pick a kitchen or storefront photo first.');
                      return;
                    }
                    void runUpload({ outletPhotos: [pendingFile.current] });
                  }}
                />
                <Pressable onPress={() => router.push('/settings')}>
                  <Text style={styles.link}>Open Settings → Photos</Text>
                </Pressable>
              </View>
            ) : null}

            {!listingLive && !locked ? (
              <PrimaryButton
                label={
                  status.canSubmit
                    ? 'Submit for review'
                    : 'Complete FSSAI to submit'
                }
                loading={mutations.submitKyc.isPending}
                disabled={!status.canSubmit}
                onPress={submit}
              />
            ) : null}

            {status.blockers.length && !listingLive ? (
              <Text style={styles.muted}>{status.blockers[0]}</Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TrackCell({
  label,
  value,
  live,
}: {
  label: string;
  value: string;
  live: boolean;
}) {
  return (
    <View style={styles.trackCell}>
      <Text style={styles.trackLabel}>{label}</Text>
      <Text style={[styles.trackValue, live ? styles.trackValueLive : null]}>
        {value}
      </Text>
    </View>
  );
}

function StepRow({
  step,
  last,
  locked,
  onPress,
}: {
  step: OnboardingStep;
  last: boolean;
  locked: boolean;
  onPress: () => void;
}) {
  const Icon =
    step.key === 'bank'
      ? Landmark
      : step.key === 'address'
        ? MapPin
        : step.key === 'menu'
          ? UtensilsCrossed
          : Building2;
  return (
    <Pressable onPress={onPress} disabled={locked && !step.done}>
      <View style={[styles.stepRow, !last && styles.stepBorder]}>
        <View
          style={[
            styles.stepIcon,
            step.done ? styles.stepIconDone : styles.stepIconTodo,
          ]}
        >
          {step.done ? (
            <CheckCircle2 color="#15803D" size={16} />
          ) : (
            <Icon color={authTheme.textMuted} size={16} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepTitle}>
            {step.label}
            {step.required ? ' · Required' : ''}
          </Text>
          <Text style={styles.stepMeta} numberOfLines={1}>
            {step.done
              ? step.detail || 'Done'
              : step.required
                ? 'Add this to go live'
                : 'Optional'}
          </Text>
        </View>
        <ChevronRight color={authTheme.textDim} size={16} />
      </View>
    </Pressable>
  );
}

function LicenseCard({
  title,
  hint,
  placeholder,
  value,
  onChangeText,
  masked,
  doc,
  file,
  busy,
  onPick,
  onSave,
  keyboard,
  autoCapitalize,
  maxLength,
}: {
  title: string;
  hint: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  masked?: string | null;
  doc?: { status: string; url?: string; rejectReason?: string | null };
  file: UploadFile | null;
  busy: boolean;
  onPick: () => void;
  onSave: () => void;
  keyboard?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'characters';
  maxLength?: number;
}) {
  const meta = docStatus(doc?.status);
  return (
    <View style={styles.formCard}>
      <Text style={styles.formTitle}>{title}</Text>
      <Text style={styles.formHint}>{hint}</Text>
      {masked ? <Text style={styles.masked}>On file: {masked}</Text> : null}
      {doc ? (
        <Text style={{ color: meta.color, fontFamily: fonts.bold, fontSize: 12 }}>
          {meta.label}
          {doc.rejectReason ? ` · ${doc.rejectReason}` : ''}
        </Text>
      ) : null}
      <Field
        label="Number"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboard}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
      />
      <UploadRow file={file} doc={doc} onPick={onPick} />
      <PrimaryButton label="Save" loading={busy} onPress={onSave} />
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
  editable = true,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'characters';
  maxLength?: number;
  editable?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={authTheme.textDim}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize ?? 'none'}
        autoCorrect={false}
        maxLength={maxLength}
        editable={editable}
        style={styles.input}
      />
    </View>
  );
}

function UploadRow({
  file,
  doc,
  disabled,
  onPick,
}: {
  file: UploadFile | null;
  doc?: { url?: string; status?: string };
  disabled?: boolean;
  onPick: () => void;
}) {
  return (
    <Pressable onPress={onPick} disabled={disabled}>
      <View style={[styles.uploadRow, disabled && { opacity: 0.5 }]}>
        {file?.uri || doc?.url ? (
          <Image
            source={{ uri: file?.uri || doc?.url }}
            style={styles.thumb}
          />
        ) : (
          <View style={styles.thumbEmpty}>
            <Upload color={authTheme.textMuted} size={16} />
          </View>
        )}
        <Text style={styles.uploadLabel}>
          {file ? file.fileName : doc?.url ? 'Replace document photo' : 'Add document photo'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: authTheme.surface },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingBottom: PARTNER_BOTTOM_NAV_INSET,
    gap: 12,
  },
  hero: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    alignItems: 'center',
  },
  percentWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {
    color: authTheme.brand,
    fontFamily: fonts.extraBold,
    fontSize: 18,
  },
  percentLabel: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  heroTitle: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  heroSub: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  chip: {
    alignSelf: 'flex-start',
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: { fontFamily: fonts.bold, fontSize: 11 },
  trackRow: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    overflow: 'hidden',
  },
  trackCell: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 2,
  },
  trackLabel: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  trackValue: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  trackValueLive: { color: '#15803D' },
  track: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: authTheme.brand,
    borderRadius: 999,
  },
  rejectBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    alignItems: 'flex-start',
  },
  rejectText: {
    flex: 1,
    color: '#B91C1C',
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  waitBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    padding: 12,
  },
  waitText: {
    flex: 1,
    color: '#92400E',
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  liveBox: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#ECFDF3',
    borderRadius: 12,
    padding: 12,
  },
  liveText: {
    flex: 1,
    color: '#166534',
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  sectionLabel: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 16,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    overflow: 'hidden',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  stepBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepIconDone: { backgroundColor: '#DCFCE7' },
  stepIconTodo: { backgroundColor: '#F1F5F9' },
  stepTitle: {
    color: authTheme.text,
    fontFamily: fonts.semiBold,
    fontSize: 14,
  },
  stepMeta: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 2,
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 10,
  },
  formTitle: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  formHint: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  masked: {
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  ifscHit: {
    color: '#15803D',
    fontFamily: fonts.semiBold,
    fontSize: 13,
  },
  fieldLabel: {
    color: authTheme.text,
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
    backgroundColor: '#FFFFFF',
  },
  uploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    padding: 8,
  },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  thumbEmpty: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadLabel: {
    flex: 1,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  link: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  muted: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  error: {
    color: authTheme.error,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
});
