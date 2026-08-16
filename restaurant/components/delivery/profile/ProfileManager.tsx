import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  Bike,
  BadgeCheck,
  Camera,
  CreditCard,
  Clock3,
  KeyRound,
  LogOut,
  Mail,
  MailCheck,
  MonitorSmartphone,
  Pencil,
  Phone,
  ShieldAlert,
  ShieldOff,
  Star,
  User,
  X,
  Zap,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatPercent,
  formatRating,
} from '@/lib/delivery-partner/analytics-api';
import {
  getDocumentProgress,
  getPartnerVerificationBadge,
} from '@/lib/delivery-partner/go-online-guard';
import {
  useDeliveryPartnerMe,
  useUpdatePartnerProfile,
  useUploadPartnerDocument,
} from '@/lib/delivery-partner/hooks';
import { DELIVERY_ROUTES } from '@/lib/delivery-partner/navigation';
import {
  VEHICLE_TYPE_OPTIONS,
  type DeliveryPartnerProfile,
  type UpdatePartnerProfilePayload,
  type VehicleType,
} from '@/lib/delivery-partner/types';
import { getApiErrorMessage } from '@/lib/errors';
import { useAuthStore } from '@/store/auth-store';

type EditSection = 'personal' | 'vehicle' | 'payout' | 'password' | null;

function dash(value?: string | null) {
  const v = value?.trim();
  return v ? v : '—';
}

function notSet(value?: string | null) {
  const v = value?.trim();
  return v ? v : 'Not set';
}

function partnerIdShort(id?: string) {
  if (!id?.trim()) return '—';
  const clean = id.replace(/[^a-zA-Z0-9]/g, '');
  return (clean.slice(-8) || id.slice(-8)).toUpperCase();
}

function initialsFrom(profile?: DeliveryPartnerProfile | null) {
  const first = profile?.firstName?.trim()?.[0];
  const last = profile?.lastName?.trim()?.[0];
  if (first || last) return `${first ?? ''}${last ?? ''}`.toUpperCase();
  const parts = (profile?.name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  if (parts[0]?.[0]) return parts[0][0].toUpperCase();
  return '?';
}

function vehicleLabel(type?: string) {
  if (!type?.trim()) return '—';
  const key = type.trim().toLowerCase().replace(/\s+/g, '_');
  const match = VEHICLE_TYPE_OPTIONS.find(
    (o) => o.value === key || o.label.toLowerCase() === type.trim().toLowerCase()
  );
  if (match) return match.label;
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function FieldBox({
  label,
  value,
  muted,
  icon: Icon,
}: {
  label: string;
  value: string;
  muted?: boolean;
  icon?: typeof Phone;
}) {
  return (
    <View style={styles.fieldBox}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldValueRow}>
        {Icon ? <Icon color={'#EA4B14'} size={14} /> : null}
        <Text
          style={[
            styles.fieldValue,
            muted && styles.fieldValueMuted,
            Icon ? { marginLeft: 6 } : null,
          ]}
          numberOfLines={2}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  secureTextEntry?: boolean;
}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={'#9CA3AF'}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        style={styles.formInput}
      />
    </View>
  );
}

export function PartnerProfileManager() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const me = useDeliveryPartnerMe();
  const updateProfile = useUpdatePartnerProfile();
  const uploadDoc = useUploadPartnerDocument();
  const logout = useAuthStore((s) => s.logout);
  const logoutAll = useAuthStore((s) => s.logoutAll);
  const changePassword = useAuthStore((s) => s.changePassword);
  const resendEmailVerification = useAuthStore((s) => s.resendEmailVerification);
  const authUser = useAuthStore((s) => s.user);
  const authBusy = useAuthStore((s) => s.isLoading);

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editSection, setEditSection] = useState<EditSection>(null);
  const [saving, setSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');

  const [vehicleType, setVehicleType] = useState<VehicleType | ''>('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');

  const [bankAccountNo, setBankAccountNo] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [upiId, setUpiId] = useState('');

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const profile = me.data;
  const loading = me.isLoading && !profile;
  const error =
    me.isError && !profile
      ? getApiErrorMessage(me.error, 'Could not load profile.')
      : null;

  const displayName = useMemo(() => {
    if (!profile) return '—';
    return (
      profile.name?.trim() ||
      [profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
      '—'
    );
  }, [profile]);

  const initials = useMemo(() => initialsFrom(profile), [profile]);
  const online = Boolean(profile?.isOnline ?? profile?.isAvailable);
  const verification = useMemo(
    () => getPartnerVerificationBadge(profile),
    [profile]
  );
  const docProgress = useMemo(() => getDocumentProgress(profile), [profile]);
  const totalDeliveries = profile?.stats?.totalDeliveries ?? 0;
  const avgRating = profile?.stats?.avgRating ?? 0;
  const completionRate = profile?.stats?.completionRate ?? 0;
  const acceptanceRate = profile?.stats?.acceptanceRate ?? 0;

  const VerificationIcon =
    verification.key === 'verified'
      ? BadgeCheck
      : verification.key === 'pending'
        ? Clock3
        : verification.key === 'rejected'
          ? ShieldAlert
          : ShieldOff;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await me.refetch();
    } finally {
      setPullRefreshing(false);
    }
  };

  const onLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setLoggingOut(true);
            try {
              await logout();
            } finally {
              setLoggingOut(false);
              router.replace('/login');
            }
          })();
        },
      },
    ]);
  };

  const onLogoutAll = () => {
    Alert.alert(
      'Log out everywhere?',
      'This will end your session on all devices.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out all',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setLoggingOut(true);
              try {
                await logoutAll();
              } finally {
                setLoggingOut(false);
                router.replace('/login');
              }
            })();
          },
        },
      ]
    );
  };

  const emailVerified = Boolean(authUser?.emailVerified);
  const accountEmail =
    authUser?.email?.trim() || profile?.email?.trim() || '';

  const onResendVerification = async () => {
    if (emailVerified) {
      Alert.alert('Already verified', 'Your email is already verified.');
      return;
    }
    setResendingEmail(true);
    try {
      const message = await resendEmailVerification();
      Alert.alert(
        'Email sent',
        message ||
          (accountEmail
            ? `Verification link sent to ${accountEmail}.`
            : 'Verification link sent to your inbox.')
      );
    } catch (err) {
      Alert.alert(
        'Could not send email',
        err instanceof Error ? err.message : 'Please try again.'
      );
    } finally {
      setResendingEmail(false);
    }
  };

  const openPasswordEdit = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError(null);
    setEditSection('password');
  };

  const submitPasswordChange = async () => {
    setPasswordError(null);
    if (oldPassword.length < 6) {
      setPasswordError('Enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setPasswordBusy(true);
    try {
      const message = await changePassword({
        oldPassword,
        newPassword,
        confirmPassword,
      });
      setEditSection(null);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Password updated', message || 'Your password was changed.');
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : 'Failed to change password'
      );
    } finally {
      setPasswordBusy(false);
    }
  };

  const openEdit = (section: EditSection) => {
    if (!profile || !section) return;
    if (section === 'personal') {
      setFirstName(profile.firstName ?? '');
      setLastName(profile.lastName ?? '');
      setPhone(profile.phone ?? '');
      setEmail(profile.email ?? '');
      setDateOfBirth(profile.dateOfBirth ?? '');
    }
    if (section === 'vehicle') {
      const rawType = (
        profile.vehicle?.type ??
        profile.vehicleType ??
        ''
      ).toLowerCase().replace(/\s+/g, '_');
      const matched = VEHICLE_TYPE_OPTIONS.find((o) => o.value === rawType);
      setVehicleType(matched?.value ?? '');
      setVehicleNumber(profile.vehicle?.number ?? profile.vehicleNumber ?? '');
      setVehicleModel(profile.vehicle?.model ?? profile.vehicleModel ?? '');
      setVehicleColor(profile.vehicle?.color ?? profile.vehicleColor ?? '');
    }
    if (section === 'payout') {
      setBankAccountNo(profile.payout?.bankAccountNo ?? '');
      setIfscCode(profile.payout?.ifscCode ?? '');
      setUpiId(profile.payout?.upiId ?? '');
    }
    setEditSection(section);
  };

  const closeEdit = () => {
    if (saving || passwordBusy) return;
    setPasswordError(null);
    setEditSection(null);
  };

  const saveEdit = async () => {
    if (!editSection || editSection === 'password') return;
    const payload: UpdatePartnerProfilePayload = {};

    if (editSection === 'personal') {
      if (!firstName.trim()) {
        Alert.alert('First name required', 'Please enter your first name.');
        return;
      }
      payload.firstName = firstName.trim();
      payload.lastName = lastName.trim();
      payload.phone = phone.trim();
      payload.email = email.trim();
      // DOB is display-only — PUT /partners/me rejects dateOfBirth
    }

    if (editSection === 'vehicle') {
      if (!vehicleType) {
        Alert.alert('Vehicle type required', 'Please select a vehicle type.');
        return;
      }
      payload.vehicleType = vehicleType;
      payload.vehicleNumber = vehicleNumber.trim();
      payload.vehicleModel = vehicleModel.trim();
      payload.vehicleColor = vehicleColor.trim();
    }

    if (editSection === 'payout') {
      payload.bankAccountNo = bankAccountNo.trim();
      payload.ifscCode = ifscCode.trim();
      payload.upiId = upiId.trim();
    }

    setSaving(true);
    try {
      await updateProfile.mutateAsync(payload);
      setEditSection(null);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (err) {
      Alert.alert(
        'Update failed',
        getApiErrorMessage(err, 'Could not update profile.')
      );
    } finally {
      setSaving(false);
    }
  };

  const pickAndUploadPhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Allow photo access to upload a profile photo.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
      aspect: [1, 1],
      exif: false,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    const asset = result.assets[0];
    setUploadingPhoto(true);
    try {
      await uploadDoc.mutateAsync({
        docType: 'profilePhoto',
        uri: asset.uri,
        fileName: `profile-${Date.now()}.jpg`,
        mimeType: 'image/jpeg',
      });
      Alert.alert('Uploaded', 'Profile photo updated.');
    } catch (err) {
      const message = getApiErrorMessage(err, 'Could not upload profile photo.');
      Alert.alert(
        'Upload failed',
        /internal server error/i.test(message)
          ? 'Server could not process this photo. Try a different JPG/PNG from your gallery (avoid screenshots if possible).'
          : message
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const modalTitle =
    editSection === 'personal'
      ? 'Edit Personal Information'
      : editSection === 'vehicle'
        ? 'Edit Vehicle Details'
        : editSection === 'payout'
          ? 'Edit Payout Details'
          : editSection === 'password'
            ? 'Change password'
            : '';

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + 12,
            paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={'#EA4B14'}
            colors={['#EA4B14']}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={'#EA4B14'} size="large" />
            <Text style={styles.muted}>Loading profile…</Text>
          </View>
        ) : error ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Couldn’t load profile</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : !profile ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>No partner profile</Text>
            <Text style={styles.muted}>
              Complete partner registration to view your profile.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.heroCard}>
              <View style={styles.avatarWrap}>
                {profile.photoUrl ? (
                  <Image
                    source={{ uri: profile.photoUrl }}
                    style={styles.avatar}
                    contentFit="cover"
                  />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                )}
                <Pressable
                  onPress={() => void pickAndUploadPhoto()}
                  disabled={uploadingPhoto}
                  style={styles.cameraBtn}
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Camera color="#FFFFFF" size={14} />
                  )}
                </Pressable>
              </View>

              <Text style={styles.name}>{displayName}</Text>
              <Text style={styles.partnerId}>
                Partner ID: {partnerIdShort(profile.id)}
              </Text>

              <View style={styles.ratingRow}>
                <Star color="#F59E0B" size={14} fill="#F59E0B" />
                <Text style={styles.ratingText}>
                  {formatRating(avgRating)}/5.0 ({totalDeliveries} deliveries)
                </Text>
              </View>

              <View style={styles.badgeRow}>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: verification.soft },
                  ]}
                >
                  <VerificationIcon color={verification.color} size={12} />
                  <Text
                    style={{
                      color: verification.color,
                      fontFamily: fonts.semiBold,
                      fontSize: 12,
                    }}
                  >
                    {verification.label}
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: online ? '#DCFCE7' : '#F1F5F9',
                    },
                  ]}
                >
                  <Zap
                    color={online ? '#15803D' : '#6B7280'}
                    size={12}
                  />
                  <Text
                    style={{
                      color: online ? '#15803D' : '#6B7280',
                      fontFamily: fonts.semiBold,
                      fontSize: 12,
                    }}
                  >
                    {online ? 'Online' : 'Offline'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: '#FFF7ED' },
                  ]}
                >
                  <Bike color={'#EA4B14'} size={12} />
                  <Text style={styles.vehicleBadgeText}>
                    {vehicleLabel(
                      profile.vehicle?.type ?? profile.vehicleType
                    )}
                  </Text>
                </View>
              </View>

              {verification.key !== 'verified' ? (
                <Pressable
                  onPress={() => router.push(DELIVERY_ROUTES.documents)}
                  style={styles.kycHint}
                >
                  <Text style={styles.kycHintText}>
                    Documents {docProgress.verified}/{docProgress.total} verified
                    {docProgress.pending
                      ? ` · ${docProgress.pending} pending`
                      : ''}
                    {docProgress.rejected
                      ? ` · ${docProgress.rejected} rejected`
                      : ''}
                    {' · '}
                    <Text style={styles.kycHintLink}>Manage KYC →</Text>
                  </Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <Star color="#F59E0B" size={16} />
                  <Text style={styles.sectionTitle}>Performance</Text>
                </View>
              </View>
              <View style={styles.statsGrid}>
                <StatCard
                  label="Total Deliveries"
                  value={String(totalDeliveries)}
                />
                <StatCard
                  label="Avg Rating"
                  value={`${Number.isFinite(avgRating) ? avgRating.toFixed(2) : '0.00'}/5`}
                />
                <StatCard
                  label="Completion Rate"
                  value={formatPercent(completionRate)}
                />
                <StatCard
                  label="Acceptance Rate"
                  value={formatPercent(acceptanceRate)}
                />
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <User color={'#EA4B14'} size={16} />
                  <Text style={styles.sectionTitle}>Personal Information</Text>
                </View>
                <Pressable
                  onPress={() => openEdit('personal')}
                  style={styles.editBtn}
                >
                  <Pencil color={'#6B7280'} size={13} />
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
              </View>
              <View style={styles.fieldsCol}>
                <FieldBox
                  label="Phone"
                  value={dash(profile.phone)}
                  icon={Phone}
                />
                <FieldBox
                  label="Email"
                  value={dash(profile.email)}
                  icon={Mail}
                />
                <View style={styles.fieldsRow}>
                  <View style={{ flex: 1 }}>
                    <FieldBox label="First Name" value={dash(profile.firstName)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <FieldBox label="Last Name" value={dash(profile.lastName)} />
                  </View>
                </View>
                <FieldBox
                  label="Date of Birth"
                  value={dash(profile.dateOfBirth)}
                />
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <Bike color={'#EA4B14'} size={16} />
                  <Text style={styles.sectionTitle}>Vehicle Details</Text>
                </View>
                <Pressable
                  onPress={() => openEdit('vehicle')}
                  style={styles.editBtn}
                >
                  <Pencil color={'#6B7280'} size={13} />
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
              </View>
              <View style={styles.fieldsRowWrap}>
                <View style={styles.halfField}>
                  <FieldBox
                    label="Type"
                    value={vehicleLabel(
                      profile.vehicle?.type ?? profile.vehicleType
                    )}
                  />
                </View>
                <View style={styles.halfField}>
                  <FieldBox
                    label="Number"
                    value={dash(
                      profile.vehicle?.number ?? profile.vehicleNumber
                    )}
                  />
                </View>
                <View style={styles.halfField}>
                  <FieldBox
                    label="Model"
                    value={dash(
                      profile.vehicle?.model ?? profile.vehicleModel
                    )}
                  />
                </View>
                <View style={styles.halfField}>
                  <FieldBox
                    label="Color"
                    value={dash(
                      profile.vehicle?.color ?? profile.vehicleColor
                    )}
                  />
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <CreditCard color={'#EA4B14'} size={16} />
                  <Text style={styles.sectionTitle}>Payout Details</Text>
                </View>
                <Pressable
                  onPress={() => openEdit('payout')}
                  style={styles.editBtn}
                >
                  <Pencil color={'#6B7280'} size={13} />
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
              </View>
              <View style={styles.fieldsRowWrap}>
                <View style={styles.thirdField}>
                  <FieldBox
                    label="Bank Account"
                    value={notSet(profile.payout?.bankAccountNo)}
                    muted={!profile.payout?.bankAccountNo?.trim()}
                  />
                </View>
                <View style={styles.thirdField}>
                  <FieldBox
                    label="IFSC Code"
                    value={notSet(profile.payout?.ifscCode)}
                    muted={!profile.payout?.ifscCode?.trim()}
                  />
                </View>
                <View style={styles.thirdField}>
                  <FieldBox
                    label="UPI ID"
                    value={notSet(profile.payout?.upiId)}
                    muted={!profile.payout?.upiId?.trim()}
                  />
                </View>
              </View>
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleRow}>
                  <KeyRound color={'#EA4B14'} size={16} />
                  <Text style={styles.sectionTitle}>Account security</Text>
                </View>
              </View>

              <View style={styles.accountRow}>
                <View
                  style={[
                    styles.accountIcon,
                    {
                      backgroundColor: emailVerified ? '#DCFCE7' : '#FEF3C7',
                    },
                  ]}
                >
                  {emailVerified ? (
                    <BadgeCheck color="#15803D" size={16} />
                  ) : (
                    <Mail color="#B45309" size={16} />
                  )}
                </View>
                <View style={styles.accountBody}>
                  <Text style={styles.accountLabel}>Email verification</Text>
                  <Text style={styles.accountHint} numberOfLines={1}>
                    {emailVerified
                      ? accountEmail || 'Email verified'
                      : accountEmail || 'Send verification link'}
                  </Text>
                  <View
                    style={[
                      styles.emailBadge,
                      {
                        backgroundColor: emailVerified ? '#DCFCE7' : '#FEF3C7',
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.emailBadgeText,
                        { color: emailVerified ? '#15803D' : '#B45309' },
                      ]}
                    >
                      {emailVerified ? 'Verified' : 'Unverified'}
                    </Text>
                  </View>
                </View>
                {!emailVerified ? (
                  <Pressable
                    onPress={() => void onResendVerification()}
                    disabled={resendingEmail || authBusy}
                    style={styles.accountAction}
                  >
                    {resendingEmail ? (
                      <ActivityIndicator color={'#EA4B14'} size="small" />
                    ) : (
                      <>
                        <MailCheck color={'#EA4B14'} size={14} />
                        <Text style={styles.accountActionText}>Resend</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>

              <View style={styles.accountDivider} />

              <Pressable
                onPress={openPasswordEdit}
                style={styles.accountRow}
                accessibilityRole="button"
                accessibilityLabel="Change password"
              >
                <View
                  style={[styles.accountIcon, { backgroundColor: '#EFF4FF' }]}
                >
                  <KeyRound color="#2563EB" size={16} />
                </View>
                <View style={styles.accountBody}>
                  <Text style={styles.accountLabel}>Change password</Text>
                  <Text style={styles.accountHint}>
                    Update your account password
                  </Text>
                </View>
                <Pencil color={'#9CA3AF'} size={14} />
              </Pressable>

              <View style={styles.accountDivider} />

              <Pressable
                onPress={onLogoutAll}
                disabled={loggingOut}
                style={styles.accountRow}
                accessibilityRole="button"
                accessibilityLabel="Log out all devices"
              >
                <View
                  style={[styles.accountIcon, { backgroundColor: '#F1F5F9' }]}
                >
                  <MonitorSmartphone color="#64748B" size={16} />
                </View>
                <View style={styles.accountBody}>
                  <Text style={styles.accountLabel}>Log out all devices</Text>
                  <Text style={styles.accountHint}>
                    End every active session
                  </Text>
                </View>
              </Pressable>
            </View>

            <Pressable
              onPress={onLogout}
              disabled={loggingOut}
              style={styles.logoutBtn}
            >
              {loggingOut ? (
                <ActivityIndicator color={authTheme.error} />
              ) : (
                <>
                  <LogOut color={authTheme.error} size={18} />
                  <Text style={styles.logoutText}>Log out</Text>
                </>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>

      <Modal
        visible={editSection != null}
        animationType="slide"
        transparent
        onRequestClose={closeEdit}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeEdit} />
          <View
            style={[
              styles.modalSheet,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{modalTitle}</Text>
              <Pressable onPress={closeEdit} style={styles.modalClose}>
                <X color={'#6B7280'} size={18} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalBody}
              showsVerticalScrollIndicator={false}
            >
              {editSection === 'personal' ? (
                <>
                  <FormField
                    label="First Name"
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First name"
                    autoCapitalize="words"
                  />
                  <FormField
                    label="Last Name"
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last name"
                    autoCapitalize="words"
                  />
                  <FormField
                    label="Phone"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+91…"
                    keyboardType="phone-pad"
                  />
                  <FormField
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Date of Birth</Text>
                    <View style={styles.readOnlyBox}>
                      <Text style={styles.readOnlyText}>
                        {dateOfBirth.trim() || 'Not set'}
                      </Text>
                    </View>
                    <Text style={styles.formHint}>
                      Date of birth can’t be changed here.
                    </Text>
                  </View>
                </>
              ) : null}

              {editSection === 'vehicle' ? (
                <>
                  <Text style={styles.formLabel}>Type</Text>
                  <View style={styles.vehicleOptions}>
                    {VEHICLE_TYPE_OPTIONS.map((opt) => {
                      const selected = vehicleType === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => setVehicleType(opt.value)}
                          style={[
                            styles.vehicleOption,
                            selected && styles.vehicleOptionSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.vehicleOptionText,
                              selected && styles.vehicleOptionTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <FormField
                    label="Number"
                    value={vehicleNumber}
                    onChangeText={setVehicleNumber}
                    placeholder="MP07SP1531"
                    autoCapitalize="characters"
                  />
                  <FormField
                    label="Model"
                    value={vehicleModel}
                    onChangeText={setVehicleModel}
                    placeholder="Optional"
                  />
                  <FormField
                    label="Color"
                    value={vehicleColor}
                    onChangeText={setVehicleColor}
                    placeholder="Optional"
                  />
                </>
              ) : null}

              {editSection === 'payout' ? (
                <>
                  <FormField
                    label="Bank Account"
                    value={bankAccountNo}
                    onChangeText={setBankAccountNo}
                    placeholder="Account number"
                    keyboardType="numeric"
                  />
                  <FormField
                    label="IFSC Code"
                    value={ifscCode}
                    onChangeText={setIfscCode}
                    placeholder="IFSC"
                    autoCapitalize="characters"
                  />
                  <FormField
                    label="UPI ID"
                    value={upiId}
                    onChangeText={setUpiId}
                    placeholder="name@upi"
                    autoCapitalize="none"
                  />
                </>
              ) : null}

              {editSection === 'password' ? (
                <>
                  <Text style={styles.passwordHint}>
                    Use your current password, then choose a new one (min. 6
                    characters).
                  </Text>
                  {passwordError ? (
                    <View style={styles.passwordErrorBox}>
                      <Text style={styles.passwordErrorText}>{passwordError}</Text>
                    </View>
                  ) : null}
                  <FormField
                    label="Current password"
                    value={oldPassword}
                    onChangeText={setOldPassword}
                    placeholder="Enter current password"
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <FormField
                    label="New password"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="At least 6 characters"
                    secureTextEntry
                    autoCapitalize="none"
                  />
                  <FormField
                    label="Confirm new password"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Re-enter new password"
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </>
              ) : null}
            </ScrollView>

            <Pressable
              onPress={() =>
                void (editSection === 'password'
                  ? submitPasswordChange()
                  : saveEdit())
              }
              disabled={saving || passwordBusy}
              style={styles.saveBtn}
            >
              {saving || passwordBusy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveText}>
                  {editSection === 'password' ? 'Update password' : 'Save'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  kicker: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#EA4B14',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: '#000000',
    marginTop: 2,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
  },
  scrollView: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 14,
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 10,
  },
  muted: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  banner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F3F4F6',
    padding: 16,
    gap: 8,
  },
  bannerTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#000000',
  },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#EA4B14',
  },
  retryText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F3F4F6',
    padding: 20,
    alignItems: 'center',
  },
  avatarWrap: {
    width: 96,
    height: 96,
    marginBottom: 12,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#FFF7ED',
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EA4B14',
  },
  avatarInitials: {
    fontFamily: fonts.bold,
    fontSize: 30,
    color: '#FFFFFF',
  },
  cameraBtn: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 22,
    color: '#000000',
    textAlign: 'center',
  },
  partnerId: {
    marginTop: 4,
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#EA4B14',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  ratingText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  vehicleBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#EA4B14',
  },
  kycHint: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    alignSelf: 'stretch',
  },
  kycHintText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#9A3412',
    textAlign: 'center',
    lineHeight: 17,
  },
  kycHintLink: {
    fontFamily: fonts.bold,
    color: '#EA4B14',
  },
  logoutBtn: {
    marginTop: 4,
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.error,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  accountIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  accountLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#000000',
  },
  accountHint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  accountAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
  },
  accountActionText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#EA4B14',
  },
  accountDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  emailBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  emailBadgeText: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
  },
  passwordHint: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
    marginBottom: 4,
  },
  passwordErrorBox: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#FECACA',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  passwordErrorText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.error,
    lineHeight: 18,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F3F4F6',
    padding: 14,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#000000',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  editText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '47.5%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    minWidth: '45%',
  },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  statValue: {
    marginTop: 6,
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#000000',
  },
  fieldsCol: {
    gap: 10,
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldsRowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  halfField: {
    width: '47.5%',
    flexGrow: 1,
    minWidth: '45%',
  },
  thirdField: {
    width: '30%',
    flexGrow: 1,
    minWidth: '28%',
  },
  fieldBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 4,
  },
  fieldValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldValue: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#000000',
    flexShrink: 1,
  },
  fieldValueMuted: {
    color: '#9CA3AF',
    fontFamily: fonts.medium,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingTop: 14,
    paddingHorizontal: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: '#000000',
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  modalBody: {
    paddingBottom: 12,
    gap: 4,
  },
  formField: {
    marginBottom: 10,
  },
  formLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#000000',
    backgroundColor: authTheme.input,
  },
  readOnlyBox: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  readOnlyText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#6B7280',
  },
  formHint: {
    marginTop: 6,
    fontFamily: fonts.regular,
    fontSize: 11,
    color: '#9CA3AF',
  },
  vehicleOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  vehicleOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  vehicleOptionSelected: {
    backgroundColor: '#FFF7ED',
    borderColor: '#EA4B14',
  },
  vehicleOptionText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
  },
  vehicleOptionTextSelected: {
    color: '#EA4B14',
    fontFamily: fonts.semiBold,
  },
  saveBtn: {
    marginTop: 4,
    backgroundColor: '#EA4B14',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
});
