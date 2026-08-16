import {
  Bike,
  Calendar,
  Copy,
  Link2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { RestaurantPageHeader } from '@/components/dashboard/RestaurantPageHeader';
import {
  dutyLabel,
  FleetPartnerSheet,
} from '@/components/partners/FleetPartnerSheet';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { normalizeInvitePhone } from '@/lib/partner/api';
import {
  useAvailablePartners,
  usePartnerMutations,
  useRestaurantInvitations,
  useRestaurantPartners,
} from '@/lib/partner/hooks';
import type {
  DeliveryPartner,
  PartnerInvitation,
} from '@/lib/partner/types';

type TabKey = 'partners' | 'available' | 'invites';
type InviteFilter = 'pending' | 'accepted' | 'cancelled' | 'all';
type RosterFilter = 'all' | 'online' | 'delivery' | 'suspended';

const ROSTER_FILTERS: { key: RosterFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Online' },
  { key: 'delivery', label: 'On trip' },
  { key: 'suspended', label: 'Suspended' },
];

const INVITE_FILTERS: { key: InviteFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Joined' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function statusColor(status?: string) {
  const value = String(status ?? '').toLowerCase();
  if (
    value === 'active' ||
    value === 'accepted' ||
    value === 'online' ||
    value === 'on a delivery'
  ) {
    return { bg: '#ECFDF5', text: '#059669' };
  }
  if (value === 'pending' || value === 'on break') {
    return { bg: '#FFF7ED', text: '#EA580C' };
  }
  if (
    value === 'inactive' ||
    value === 'cancelled' ||
    value === 'rejected' ||
    value === 'expired' ||
    value === 'suspended' ||
    value === 'deactivated' ||
    value === 'offline'
  ) {
    return { bg: '#FEF2F2', text: '#DC2626' };
  }
  return { bg: authTheme.brandSoft, text: authTheme.brand };
}

function matchesRoster(
  partner: DeliveryPartner,
  filter: RosterFilter,
  query: string
) {
  const hay = [partner.name, partner.phone, partner.partnerCode, partner.vehicleNumber]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (query && !hay.includes(query)) return false;
  const status = String(partner.status ?? '').toLowerCase();
  const duty = String(partner.dutyStatus ?? '').toLowerCase();
  if (filter === 'online') {
    return Boolean(partner.isOnline) && !duty.includes('deliver');
  }
  if (filter === 'delivery') {
    return duty.includes('deliver');
  }
  if (filter === 'suspended') {
    return ['suspended', 'deactivated', 'inactive'].includes(status);
  }
  return true;
}

async function shareInviteLink(
  link: string,
  riderName?: string,
  restaurantName?: string
) {
  const message = [
    restaurantName
      ? `${restaurantName} invited you as a delivery partner.`
      : 'You’re invited as a delivery partner.',
    riderName ? `Hi ${riderName},` : null,
    'Open this link to join. It expires in 72 hours.',
    link,
  ]
    .filter(Boolean)
    .join('\n');
  try {
    await Share.share({ message, title: 'Delivery partner invite' });
  } catch {
    await copyInviteLink(link);
  }
}

async function copyInviteLink(link: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      const clipboard = (
        navigator as Navigator & {
          clipboard?: { writeText?: (value: string) => Promise<void> };
        }
      ).clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(link);
        Alert.alert('Copied', 'Invite link copied to clipboard.');
        return;
      }
    }
    await Share.share({ message: link, title: 'Delivery partner invite' });
  } catch {
    Alert.alert('Could not share', 'Copy this link manually:\n' + link);
  }
}

function PartnerRow({
  partner,
  onPress,
}: {
  partner: DeliveryPartner;
  onPress: () => void;
}) {
  const label = dutyLabel(partner);
  const tone = statusColor(label.toLowerCase());

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        {partner.avatarUrl ? (
          <Image source={{ uri: partner.avatarUrl }} style={styles.avatarPhoto} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarInitial}>
              {(partner.name || 'R').slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {partner.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[partner.partnerCode, partner.phone].filter(Boolean).join(' · ') ||
              'No contact'}
          </Text>
        </View>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Text style={[styles.chipText, { color: tone.text }]}>{label}</Text>
        </View>
      </View>

      <View style={styles.detailRow}>
        {partner.vehicleType || partner.vehicleNumber ? (
          <View style={styles.detailItem}>
            <Bike color={authTheme.textMuted} size={14} />
            <Text style={styles.detailText}>
              {[partner.vehicleType, partner.vehicleNumber]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        ) : null}
        {partner.distanceKm != null ? (
          <Text style={styles.detailText}>
            {partner.distanceKm < 10
              ? `${partner.distanceKm.toFixed(1)} km`
              : `${Math.round(partner.distanceKm)} km`}
          </Text>
        ) : null}
        {partner.rating != null && partner.rating > 0 ? (
          <Text style={styles.detailText}>{partner.rating.toFixed(1)}★</Text>
        ) : null}
        {partner.totalDeliveries != null ? (
          <Text style={styles.detailText}>{partner.totalDeliveries} trips</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function InviteRow({
  invite,
  busy,
  restaurantName,
  onCancel,
}: {
  invite: PartnerInvitation;
  busy?: boolean;
  restaurantName?: string;
  onCancel: () => void;
}) {
  const tone = statusColor(invite.status);
  const canCancel = String(invite.status).toLowerCase() === 'pending';
  const inviteLink = invite.inviteLink;

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <View style={styles.inviteNameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {invite.partnerName ||
                invite.partnerPhone ||
                invite.partnerEmail ||
                'Invitation'}
            </Text>
            <View style={[styles.chip, { backgroundColor: tone.bg }]}>
              <Text style={[styles.chipText, { color: tone.text }]}>
                {invite.status === 'accepted' ? 'Joined' : invite.status}
              </Text>
            </View>
          </View>

          <View style={styles.inviteMetaList}>
            {invite.partnerPhone ? (
              <View style={styles.inviteMetaItem}>
                <Phone color={authTheme.textMuted} size={12} />
                <Text style={styles.meta}>{invite.partnerPhone}</Text>
              </View>
            ) : null}
            {invite.partnerEmail ? (
              <View style={styles.inviteMetaItem}>
                <Mail color={authTheme.textMuted} size={12} />
                <Text style={styles.meta}>{invite.partnerEmail}</Text>
              </View>
            ) : null}
            {invite.expiresAt && canCancel ? (
              <View style={styles.inviteMetaItem}>
                <Calendar color={authTheme.textMuted} size={12} />
                <Text style={styles.meta}>
                  Expires {formatDate(invite.expiresAt)}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {canCancel ? (
          <Pressable
            onPress={onCancel}
            disabled={busy}
            hitSlop={8}
            accessibilityLabel="Cancel invite"
            style={({ pressed }) => [
              styles.iconDanger,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            <Trash2 color={authTheme.error} size={16} />
          </Pressable>
        ) : null}
      </View>

      {inviteLink ? (
        <View style={styles.linkBlock}>
          <View style={styles.linkRow}>
            <Link2 color={authTheme.brand} size={14} />
            <Text style={styles.linkText} numberOfLines={2} selectable>
              {inviteLink}
            </Text>
          </View>
          <View style={styles.linkActions}>
            <Pressable
              onPress={() => void copyInviteLink(inviteLink)}
              style={({ pressed }) => [
                styles.linkActionBtn,
                pressed && styles.pressed,
              ]}
            >
              <Copy color={authTheme.brand} size={14} />
              <Text style={styles.linkActionText}>Copy</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                void shareInviteLink(
                  inviteLink,
                  invite.partnerName,
                  restaurantName
                )
              }
              style={({ pressed }) => [
                styles.linkActionBtn,
                pressed && styles.pressed,
              ]}
            >
              <Link2 color={authTheme.brand} size={14} />
              <Text style={styles.linkActionText}>Share</Text>
            </Pressable>
          </View>
        </View>
      ) : canCancel ? (
        <Text style={styles.linkMissing}>
          Waiting for a shareable link from the server. Pull to refresh — we
          never invent a link.
        </Text>
      ) : null}
    </View>
  );
}

function SendInvitationForm({
  name,
  phone,
  email,
  busy,
  onChangeName,
  onChangePhone,
  onChangeEmail,
  onSubmit,
  onClose,
  compact = false,
}: {
  name: string;
  phone: string;
  email: string;
  busy: boolean;
  onChangeName: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeEmail: (value: string) => void;
  onSubmit: () => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.inviteFormCard, compact && styles.inviteFormCardFlat]}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Send Invitation</Text>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <X color={authTheme.textMuted} size={20} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.modalHint}>
        We’ll create a 72-hour join link. Share it with the rider so they can
        register for your fleet. Duplicate pending numbers are blocked.
      </Text>

      <Text style={styles.fieldLabel}>Full Name *</Text>
      <TextInput
        value={name}
        onChangeText={onChangeName}
        placeholder="Rahul Sharma"
        placeholderTextColor={authTheme.textDim}
        autoCapitalize="words"
        style={styles.formInput}
      />

      <Text style={styles.fieldLabel}>Phone *</Text>
      <TextInput
        value={phone}
        onChangeText={onChangePhone}
        placeholder="9876543210"
        placeholderTextColor={authTheme.textDim}
        keyboardType="phone-pad"
        maxLength={13}
        style={styles.formInput}
      />

      <Text style={styles.fieldLabel}>Email (optional)</Text>
      <TextInput
        value={email}
        onChangeText={onChangeEmail}
        placeholder="partner@example.com"
        placeholderTextColor={authTheme.textDim}
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.formInput}
      />

      <View style={styles.submitWrap}>
        <PrimaryButton
          label="Generate Invite Link"
          icon={Link2}
          loading={busy}
          onPress={onSubmit}
        />
      </View>
    </View>
  );
}

export function PartnersManager() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('partners');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteFilter, setInviteFilter] = useState<InviteFilter>('pending');
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const [rosterQuery, setRosterQuery] = useState('');
  const [selected, setSelected] = useState<DeliveryPartner | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const partners = useRestaurantPartners();
  const invitations = useRestaurantInvitations();
  const available = useAvailablePartners(tab === 'available');
  const mutations = usePartnerMutations(partners.restaurantId);

  const busy =
    mutations.invite.isPending ||
    mutations.cancelInvite.isPending ||
    mutations.setStatus.isPending;

  const partnerList = partners.data ?? [];
  const inviteList = invitations.data ?? [];
  const availableList = available.data ?? [];

  const visibleInvites = useMemo(() => {
    const rows = [...inviteList].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
    if (inviteFilter === 'all') return rows;
    if (inviteFilter === 'cancelled') {
      return rows.filter((row) =>
        ['cancelled', 'expired', 'rejected'].includes(
          String(row.status).toLowerCase()
        )
      );
    }
    return rows.filter(
      (row) => String(row.status).toLowerCase() === inviteFilter
    );
  }, [inviteList, inviteFilter]);

  const pendingInvites = useMemo(
    () =>
      inviteList.filter((row) => String(row.status).toLowerCase() === 'pending')
        .length,
    [inviteList]
  );

  const visiblePartners = useMemo(() => {
    const query = rosterQuery.trim().toLowerCase();
    return partnerList.filter((row) => matchesRoster(row, rosterFilter, query));
  }, [partnerList, rosterFilter, rosterQuery]);

  const onlineCount = useMemo(
    () => partnerList.filter((row) => row.isOnline).length,
    [partnerList]
  );

  const refreshing =
    partners.isRefetching ||
    invitations.isRefetching ||
    available.isRefetching;

  const loading =
    (tab === 'partners' && partners.isLoading && !partners.data) ||
    (tab === 'invites' && invitations.isLoading && !invitations.data) ||
    (tab === 'available' && available.isLoading && !available.data);

  const refreshAll = async () => {
    await Promise.all([
      partners.refetch(),
      invitations.refetch(),
      available.refetch(),
    ]);
  };

  const resetInviteForm = () => {
    setFullName('');
    setPhone('');
    setEmail('');
  };

  const submitInvite = async (from?: DeliveryPartner) => {
    try {
      const name = (from?.name ?? fullName).trim();
      const nationalPhone = normalizeInvitePhone(from?.phone ?? phone);
      const mail = from ? undefined : email.trim() || undefined;
      if (!name || !nationalPhone) {
        Alert.alert(
          'Missing details',
          from
            ? 'This rider has no phone on file. Invite them with name and number instead.'
            : 'Enter the rider’s full name and a 10-digit mobile number.'
        );
        return;
      }

      const created = await mutations.invite.mutateAsync({
        name,
        phone: nationalPhone,
        email: mail,
      });

      setInviteOpen(false);
      resetInviteForm();
      setTab('invites');
      setInviteFilter('pending');

      if (created.inviteLink) {
        Alert.alert(
          'Invite ready',
          `Share this link with ${created.partnerName || name}. It expires in 72 hours.`,
          [
            { text: 'Later' },
            {
              text: 'Copy',
              onPress: () => void copyInviteLink(created.inviteLink!),
            },
            {
              text: 'Share',
              onPress: () =>
                void shareInviteLink(
                  created.inviteLink!,
                  created.partnerName || name,
                  partners.restaurantName
                ),
            },
          ]
        );
      } else {
        Alert.alert(
          'Invitation saved',
          'The invite is pending, but the server did not return a shareable URL. Pull to refresh. Do not send a made-up link.'
        );
      }
    } catch (error) {
      const message = getApiErrorMessage(error);
      const title = message.includes('INVITE_ALREADY_PENDING')
        ? 'Already invited'
        : message.includes('INVITE_RATE_LIMITED')
          ? 'Too many invites'
          : message.includes('DOWNSTREAM') ||
              message.includes('RESTAURANT_SERVICE_UNAVAILABLE')
            ? 'Fleet service down'
            : 'Could not invite';
      Alert.alert(title, message);
    }
  };

  const cancelInvite = (invite: PartnerInvitation) => {
    Alert.alert(
      'Cancel this invite?',
      'The rider will no longer be able to join with this link.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel invite',
          style: 'destructive',
          onPress: () => {
            void mutations.cancelInvite.mutateAsync(invite.id).catch((error) => {
              Alert.alert('Could not cancel', getApiErrorMessage(error));
            });
          },
        },
      ]
    );
  };

  const openInvite = () => {
    setTab('invites');
    setInviteOpen(true);
  };

  return (
    <View style={styles.screen}>
      <RestaurantPageHeader
        title="Your fleet"
        subtitle={
          partners.restaurantName
            ? `${partners.restaurantName} · ${onlineCount} online`
            : 'Your riders · tap to activate or suspend'
        }
        showBack
        hideActions
        headerRight={
          <Pressable
            style={styles.headerIconBtn}
            onPress={openInvite}
            accessibilityLabel="Invite partner"
          >
            <Plus color={authTheme.text} size={18} strokeWidth={2.4} />
          </Pressable>
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + PARTNER_BOTTOM_NAV_INSET,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshAll()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.tabs}>
          {(
            [
              { key: 'partners', label: 'Partners', count: partnerList.length },
              {
                key: 'available',
                label: 'Nearby',
                count: availableList.length,
              },
              {
                key: 'invites',
                label: 'Invites',
                count: pendingInvites,
              },
            ] as const
          ).map((item) => {
            const active = tab === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setTab(item.key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {item.label}
                </Text>
                <Text
                  style={[styles.tabCount, active && styles.tabTextActive]}
                >
                  {item.count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
          </View>
        ) : null}

        {!loading && tab === 'partners' ? (
          partners.isError ? (
            <View style={styles.center}>
              <Text style={styles.errorTitle}>Couldn’t load your fleet</Text>
              <Text style={styles.muted}>
                {getApiErrorMessage(partners.error)}
              </Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => void partners.refetch()}
              >
                <RefreshCw color="#FFFFFF" size={14} />
                <Text style={styles.primaryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : partnerList.length ? (
            <View style={styles.list}>
              <View style={styles.searchRow}>
                <Search color={authTheme.textMuted} size={16} />
                <TextInput
                  value={rosterQuery}
                  onChangeText={setRosterQuery}
                  placeholder="Search name, phone, or code"
                  placeholderTextColor={authTheme.textDim}
                  style={styles.searchInput}
                />
              </View>
              <View style={styles.filterRow}>
                {ROSTER_FILTERS.map((item) => {
                  const active = rosterFilter === item.key;
                  return (
                    <Pressable
                      key={item.key}
                      onPress={() => setRosterFilter(item.key)}
                      style={[styles.filterChip, active && styles.filterChipOn]}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          active && styles.filterChipTextOn,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {visiblePartners.length ? (
                visiblePartners.map((partner) => (
                  <PartnerRow
                    key={partner.id}
                    partner={partner}
                    onPress={() => setSelected(partner)}
                  />
                ))
              ) : (
                <View style={styles.empty}>
                  <UserRound color={authTheme.textDim} size={36} />
                  <Text style={styles.emptyTitle}>No riders in this filter</Text>
                  <Text style={styles.muted}>
                    Try All, or invite a rider from the Invites tab.
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.empty}>
              <UserRound color={authTheme.textDim} size={36} />
              <Text style={styles.emptyTitle}>No partners yet</Text>
              <Text style={styles.muted}>
                Invite riders by phone. After they join, they appear here to
                activate, suspend, or assign on orders.
              </Text>
              <Pressable onPress={openInvite} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>Send invitation</Text>
              </Pressable>
            </View>
          )
        ) : null}

        {!loading && tab === 'available' ? (
          available.isError ? (
            <View style={styles.center}>
              <Text style={styles.errorTitle}>Couldn’t load nearby partners</Text>
              <Text style={styles.muted}>
                {getApiErrorMessage(available.error)}
              </Text>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => void available.refetch()}
              >
                <RefreshCw color="#FFFFFF" size={14} />
                <Text style={styles.primaryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : availableList.length ? (
            <View style={styles.list}>
              <Text style={styles.muted}>
                Fleet riders who are online and sharing GPS near your store.
                Tap for details — they are already on your roster.
              </Text>
              {availableList.map((partner) => (
                <PartnerRow
                  key={partner.id}
                  partner={partner}
                  onPress={() => setSelected(partner)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.empty}>
              <Bike color={authTheme.textDim} size={36} />
              <Text style={styles.emptyTitle}>No fleet riders online nearby</Text>
              <Text style={styles.muted}>
                Nearby only shows riders already in your fleet who are online
                with a live GPS ping. We never invent riders here.
              </Text>
            </View>
          )
        ) : null}

        {tab === 'invites' ? (
          <View style={styles.invitesWrap}>
            <SendInvitationForm
              name={fullName}
              phone={phone}
              email={email}
              busy={mutations.invite.isPending}
              onChangeName={setFullName}
              onChangePhone={setPhone}
              onChangeEmail={setEmail}
              onSubmit={() => void submitInvite()}
            />

            <View style={styles.filterRow}>
              {INVITE_FILTERS.map((item) => {
                const active = inviteFilter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setInviteFilter(item.key)}
                    style={[styles.filterChip, active && styles.filterChipOn]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        active && styles.filterChipTextOn,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {invitations.isError ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Couldn’t load invites</Text>
                <Text style={styles.muted}>
                  {getApiErrorMessage(invitations.error)}
                </Text>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => void invitations.refetch()}
                >
                  <RefreshCw color="#FFFFFF" size={14} />
                  <Text style={styles.primaryBtnText}>Retry</Text>
                </Pressable>
              </View>
            ) : invitations.isLoading && !invitations.data ? (
              <ActivityIndicator color={authTheme.brand} />
            ) : visibleInvites.length ? (
              <View style={styles.list}>
                {visibleInvites.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    busy={busy}
                    restaurantName={partners.restaurantName}
                    onCancel={() => cancelInvite(invite)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <Mail color={authTheme.textDim} size={36} />
                <Text style={styles.emptyTitle}>
                  {inviteFilter === 'pending'
                    ? 'No pending invites'
                    : 'Nothing in this filter'}
                </Text>
                <Text style={styles.muted}>
                  Add a rider’s name and mobile, then generate a join link.
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={inviteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={styles.modalDismiss}
            onPress={() => setInviteOpen(false)}
          />
          <View
            style={[
              styles.modalSheet,
              { paddingBottom: Math.max(insets.bottom, 16) },
            ]}
          >
            <View style={styles.modalHandle} />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              contentContainerStyle={styles.modalScrollContent}
            >
              <SendInvitationForm
                name={fullName}
                phone={phone}
                email={email}
                busy={mutations.invite.isPending}
                onChangeName={setFullName}
                onChangePhone={setPhone}
                onChangeEmail={setEmail}
                onSubmit={() => void submitInvite()}
                onClose={() => setInviteOpen(false)}
                compact
              />
            </ScrollView>
            <PrimaryButton
              label="Cancel"
              variant="outline"
              onPress={() => setInviteOpen(false)}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <FleetPartnerSheet
        visible={Boolean(selected)}
        restaurantId={partners.restaurantId}
        partner={selected}
        onClose={() => setSelected(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 14 },
  headerIconBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteFab: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#7A0E22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabs: {
    marginTop: 16,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  tabActive: { backgroundColor: authTheme.brand },
  tabText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  tabCount: {
    color: authTheme.textDim,
    fontSize: 11,
    fontFamily: fonts.semiBold,
  },
  tabTextActive: { color: '#FFFFFF' },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: authTheme.surface,
  },
  filterChipOn: {
    backgroundColor: authTheme.brandSoft,
  },
  filterChipText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  filterChipTextOn: {
    color: authTheme.brand,
  },
  list: { gap: 10 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 16,
    gap: 12,
    overflow: 'hidden',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarPhoto: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: authTheme.surface,
  },
  avatarInitial: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.brand,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
    paddingVertical: 10,
  },
  name: {
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.bold,
  },
  meta: {
    marginTop: 2,
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 11,
    fontFamily: fonts.bold,
    textTransform: 'capitalize',
  },
  detailRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignItems: 'center',
  },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(122,14,34,0.1)',
  },
  toggleLabel: {
    color: authTheme.text,
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
    paddingVertical: 14,
    marginHorizontal: -16,
    marginBottom: -16,
  },
  secondaryBtnText: {
    color: authTheme.brand,
    fontSize: 14,
    fontFamily: fonts.semiBold,
  },
  dangerBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dangerBtnText: {
    color: authTheme.error,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyTitle: {
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.extraBold,
  },
  muted: {
    color: authTheme.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: fonts.medium,
    paddingHorizontal: 12,
  },
  errorTitle: {
    color: authTheme.error,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  primaryBtn: {
    marginTop: 8,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  pressed: { opacity: 0.88 },
  disabled: { opacity: 0.5 },
  invitesWrap: { gap: 14 },
  listTitle: {
    color: authTheme.text,
    fontSize: 15,
    fontFamily: fonts.bold,
    marginTop: 4,
  },
  inviteFormCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
    padding: 16,
    gap: 8,
  },
  inviteFormCardFlat: {
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: authTheme.text,
    fontSize: 17,
    fontFamily: fonts.bold,
  },
  modalHint: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
    marginBottom: 6,
  },
  fieldLabel: {
    marginTop: 6,
    color: authTheme.text,
    fontSize: 12,
    fontFamily: fonts.semiBold,
  },
  formInput: {
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
  submitWrap: {
    marginTop: 14,
    width: '100%',
  },
  inviteNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  inviteMetaList: {
    marginTop: 8,
    gap: 4,
  },
  inviteMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconDanger: {
    padding: 6,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: authTheme.surface,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.08)',
  },
  linkBlock: {
    marginTop: 10,
    gap: 8,
  },
  linkActions: {
    flexDirection: 'row',
    gap: 8,
  },
  linkActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: authTheme.brandSoft,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  linkActionText: {
    color: authTheme.brand,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  linkMissing: {
    marginTop: 8,
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
  },
  linkText: {
    flex: 1,
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.medium,
    lineHeight: 16,
  },
  copyBtn: {
    padding: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalDismiss: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 16,
    maxHeight: '92%',
    gap: 10,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#D4D4D8',
    marginBottom: 4,
  },
  modalScrollContent: {
    paddingBottom: 4,
  },
});
