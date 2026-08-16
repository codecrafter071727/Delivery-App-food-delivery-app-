import {
  Copy,
  Link2,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PrimaryButton } from '@/components/auth/PrimaryButton';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { normalizeInvitePhone } from '@/lib/restaurant/settings-api';
import {
  useRestaurantSettingsMutations,
  useRestaurantStaff,
} from '@/lib/restaurant/settings-hooks';
import {
  DEFAULT_STAFF_PERMISSIONS,
  STAFF_PERMISSIONS,
  STAFF_ROLE_OPTIONS,
  formatStaffRole,
  type RestaurantStaffMember,
  type StaffInvite,
  type StaffPermission,
  type StaffRole,
} from '@/lib/restaurant/settings-types';

type TabKey = 'team' | 'invites';

function formatSeen(iso?: string | null) {
  if (!iso) return 'No KDS activity yet';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'No KDS activity yet';
  const diff = Date.now() - date.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 2) return 'On kitchen now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function staffErrorTitle(error: unknown) {
  const message = getApiErrorMessage(error);
  if (message.includes('INVITE_ALREADY_PENDING')) return 'Already invited';
  if (message.includes('INVITE_RATE_LIMITED')) return 'Too many invites';
  if (message.includes('STAFF_ALREADY_EXISTS')) return 'Already on the team';
  if (message.includes('OWNERSHIP_TRANSFER')) return 'Can’t change owner';
  if (message.includes('FORBIDDEN') || message.includes('403')) {
    return 'Not allowed';
  }
  if (message.includes('STAFF_NOT_FOUND')) return 'Staff not found';
  return 'Could not update team';
}

async function shareInvite(link: string, name?: string, restaurantName?: string) {
  const message = [
    restaurantName
      ? `${restaurantName} invited you to join the kitchen team.`
      : 'You’re invited to join a restaurant team.',
    name ? `Hi ${name},` : null,
    'Open this link while signed in. It expires in 72 hours.',
    link,
  ]
    .filter(Boolean)
    .join('\n');
  try {
    await Share.share({ message, title: 'Kitchen team invite' });
  } catch {
    await copyInvite(link);
  }
}

async function copyInvite(link: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      const clipboard = (
        navigator as Navigator & {
          clipboard?: { writeText?: (value: string) => Promise<void> };
        }
      ).clipboard;
      if (clipboard?.writeText) {
        await clipboard.writeText(link);
        Alert.alert('Copied', 'Invite link copied.');
        return;
      }
    }
    await Share.share({ message: link, title: 'Kitchen team invite' });
  } catch {
    Alert.alert('Could not share', 'Copy this link manually:\n' + link);
  }
}

export function StaffManager() {
  const roster = useRestaurantStaff();
  const mutations = useRestaurantSettingsMutations(roster.restaurantId);
  const [tab, setTab] = useState<TabKey>('team');
  const [selected, setSelected] = useState<RestaurantStaffMember | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const members = roster.data?.members ?? [];
  const invites = roster.data?.pendingInvites ?? [];
  const pending = invites.filter(
    (row) => String(row.status).toLowerCase() === 'pending'
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {(
          [
            { key: 'team', label: 'Team', count: members.length },
            { key: 'invites', label: 'Invites', count: pending.length },
          ] as const
        ).map((item) => {
          const on = tab === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setTab(item.key)}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>
                {item.label} {item.count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {roster.isError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Couldn’t load team</Text>
          <Text style={styles.muted}>{getApiErrorMessage(roster.error)}</Text>
          <Pressable style={styles.primary} onPress={() => void roster.refetch()}>
            <RefreshCw color="#FFFFFF" size={14} />
            <Text style={styles.primaryText}>Retry</Text>
          </Pressable>
        </View>
      ) : roster.isLoading && !roster.data ? (
        <ActivityIndicator color={authTheme.brand} style={{ marginTop: 24 }} />
      ) : tab === 'team' ? (
        <View style={styles.list}>
          <Pressable
            onPress={() => setInviteOpen(true)}
            style={styles.primary}
          >
            <Plus color="#FFFFFF" size={16} />
            <Text style={styles.primaryText}>Invite teammate</Text>
          </Pressable>
          {members.map((member) => (
            <Pressable
              key={`${member.staffId ?? 'owner'}-${member.userId}`}
              onPress={() =>
                member.role === 'owner' ? undefined : setSelected(member)
              }
              style={styles.card}
            >
              <View style={styles.avatar}>
                <Text style={styles.initial}>
                  {(member.name || formatStaffRole(member.role))
                    .slice(0, 1)
                    .toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>
                  {member.name || formatStaffRole(member.role)}
                </Text>
                <Text style={styles.meta}>
                  {[
                    formatStaffRole(member.role),
                    member.isActive === false ? 'Paused' : null,
                    member.phoneMasked,
                    member.emailMasked,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={styles.seen}>{formatSeen(member.lastSeenAt)}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.list}>
          <InviteForm
            restaurantName={roster.restaurantName}
            busy={mutations.inviteStaff.isPending}
            onSubmit={async (payload) => {
              const created = await mutations.inviteStaff.mutateAsync(payload);
              if (created.inviteUrl) {
                Alert.alert(
                  'Invite ready',
                  'Share this link. We never invent a URL.',
                  [
                    { text: 'Later' },
                    {
                      text: 'Copy',
                      onPress: () => void copyInvite(created.inviteUrl!),
                    },
                    {
                      text: 'Share',
                      onPress: () =>
                        void shareInvite(
                          created.inviteUrl!,
                          created.name,
                          roster.restaurantName
                        ),
                    },
                  ]
                );
              } else {
                Alert.alert(
                  'Invitation saved',
                  'Pending, but no shareable URL came back. Pull to refresh.'
                );
              }
            }}
          />
          {pending.length ? (
            pending.map((invite) => (
              <InviteRow
                key={invite.inviteId}
                invite={invite}
                restaurantName={roster.restaurantName}
              />
            ))
          ) : (
            <Text style={styles.muted}>
              Pending invites appear here until they join or the 72-hour link
              expires.
            </Text>
          )}
        </View>
      )}

      <MemberSheet
        member={selected}
        busy={
          mutations.updateStaff.isPending || mutations.removeStaff.isPending
        }
        onClose={() => setSelected(null)}
        onSave={async (staffId, payload) => {
          await mutations.updateStaff.mutateAsync({ staffId, payload });
          setSelected(null);
        }}
        onDeactivate={async (staffId) => {
          await mutations.removeStaff.mutateAsync(staffId);
          setSelected(null);
        }}
      />

      <Modal
        visible={inviteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteOpen(false)}
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setInviteOpen(false)}
          />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>Invite teammate</Text>
              <Pressable onPress={() => setInviteOpen(false)}>
                <X color={authTheme.textMuted} size={20} />
              </Pressable>
            </View>
            <InviteForm
              restaurantName={roster.restaurantName}
              busy={mutations.inviteStaff.isPending}
              onSubmit={async (payload) => {
                const created = await mutations.inviteStaff.mutateAsync(payload);
                setInviteOpen(false);
                setTab('invites');
                if (created.inviteUrl) {
                  Alert.alert('Invite ready', 'Share the join link with them.', [
                    { text: 'Later' },
                    {
                      text: 'Share',
                      onPress: () =>
                        void shareInvite(
                          created.inviteUrl!,
                          created.name,
                          roster.restaurantName
                        ),
                    },
                  ]);
                }
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InviteForm({
  restaurantName,
  busy,
  onSubmit,
}: {
  restaurantName?: string;
  busy: boolean;
  onSubmit: (payload: {
    name: string;
    phone?: string;
    email?: string;
    role: StaffRole;
  }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<StaffRole>('kitchen');
  const [userId, setUserId] = useState('');
  const [advanced, setAdvanced] = useState(false);

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        {restaurantName
          ? `Invite someone to ${restaurantName}. They sign in and open the link.`
          : 'They sign in and open the 72-hour join link.'}
      </Text>
      <Text style={styles.label}>Full name *</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Priya Sharma"
        placeholderTextColor={authTheme.textDim}
        style={styles.input}
      />
      <Text style={styles.label}>Mobile</Text>
      <View style={styles.inputRow}>
        <Phone color={authTheme.textDim} size={16} />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="9876543210"
          keyboardType="phone-pad"
          maxLength={13}
          placeholderTextColor={authTheme.textDim}
          style={styles.inputFlex}
        />
      </View>
      <Text style={styles.label}>Email (optional if mobile is set)</Text>
      <View style={styles.inputRow}>
        <Mail color={authTheme.textDim} size={16} />
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="priya@example.com"
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor={authTheme.textDim}
          style={styles.inputFlex}
        />
      </View>
      <Text style={styles.label}>Role</Text>
      <View style={styles.chips}>
        {STAFF_ROLE_OPTIONS.map((option) => {
          const on = role === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setRole(option.value)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <PrimaryButton
        label="Send invite"
        icon={Link2}
        loading={busy}
        onPress={() => {
          if (!name.trim()) {
            Alert.alert('Name required', 'Enter the teammate’s full name.');
            return;
          }
          void onSubmit({
            name: name.trim(),
            phone: phone.trim() || undefined,
            email: email.trim() || undefined,
            role,
          }).catch((error) => {
            Alert.alert(staffErrorTitle(error), getApiErrorMessage(error));
          });
        }}
      />
      <Pressable onPress={() => setAdvanced((value) => !value)}>
        <Text style={styles.link}>
          {advanced ? 'Hide user-id add' : 'They already have a user id'}
        </Text>
      </Pressable>
      {advanced ? (
        <DirectAdd
          role={role}
          userId={userId}
          onChangeUserId={setUserId}
          name={name}
        />
      ) : null}
    </View>
  );
}

function DirectAdd({
  role,
  userId,
  onChangeUserId,
  name,
}: {
  role: StaffRole;
  userId: string;
  onChangeUserId: (value: string) => void;
  name: string;
}) {
  const roster = useRestaurantStaff();
  const mutations = useRestaurantSettingsMutations(roster.restaurantId);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.hint}>
        Direct-add is only for a known Mongo user id. Prefer the invite link.
      </Text>
      <TextInput
        value={userId}
        onChangeText={onChangeUserId}
        placeholder="66u2…"
        autoCapitalize="none"
        placeholderTextColor={authTheme.textDim}
        style={styles.input}
      />
      <PrimaryButton
        label="Add by user id"
        loading={mutations.addStaff.isPending}
        onPress={() => {
          void mutations.addStaff
            .mutateAsync({
              userId: userId.trim(),
              role,
              name: name.trim() || undefined,
            })
            .then(() => {
              Alert.alert('Added', 'They can use this outlet now.');
              onChangeUserId('');
            })
            .catch((error) => {
              Alert.alert(staffErrorTitle(error), getApiErrorMessage(error));
            });
        }}
      />
    </View>
  );
}

function InviteRow({
  invite,
  restaurantName,
}: {
  invite: StaffInvite;
  restaurantName?: string;
}) {
  const link = invite.inviteUrl;
  return (
    <View style={styles.card}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.name}>{invite.name}</Text>
        <Text style={styles.meta}>
          {[
            formatStaffRole(invite.role),
            invite.phoneMasked,
            invite.emailMasked,
            invite.expiresAt
              ? `Expires ${new Date(invite.expiresAt).toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                })}`
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {link ? (
          <View style={styles.linkActions}>
            <Pressable
              onPress={() => void copyInvite(link)}
              style={styles.linkBtn}
            >
              <Copy color={authTheme.brand} size={14} />
              <Text style={styles.linkBtnText}>Copy</Text>
            </Pressable>
            <Pressable
              onPress={() => void shareInvite(link, invite.name, restaurantName)}
              style={styles.linkBtn}
            >
              <Link2 color={authTheme.brand} size={14} />
              <Text style={styles.linkBtnText}>Share</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.muted}>
            Waiting for a shareable link from the server.
          </Text>
        )}
      </View>
    </View>
  );
}

function MemberSheet({
  member,
  busy,
  onClose,
  onSave,
  onDeactivate,
}: {
  member: RestaurantStaffMember | null;
  busy: boolean;
  onClose: () => void;
  onSave: (
    staffId: string,
    payload: { role: StaffRole; permissions: StaffPermission[]; isActive: boolean }
  ) => Promise<void>;
  onDeactivate: (staffId: string) => Promise<void>;
}) {
  const role = normalizeSheetRole(member?.role);
  const [nextRole, setNextRole] = useState<StaffRole>(role);
  const [perms, setPerms] = useState<StaffPermission[]>(
    member?.permissions?.length
      ? member.permissions
      : DEFAULT_STAFF_PERMISSIONS[role]
  );
  const [active, setActive] = useState(member?.isActive !== false);

  const staffId = member?.staffId;
  const ready = Boolean(member && staffId);

  useEffect(() => {
    if (!member) return;
    const mapped = normalizeSheetRole(member.role);
    setNextRole(mapped);
    setPerms(
      member.permissions?.length
        ? member.permissions
        : DEFAULT_STAFF_PERMISSIONS[mapped]
    );
    setActive(member.isActive !== false);
  }, [member]);

  return (
    <Modal visible={Boolean(member)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>
              {member?.name || formatStaffRole(member?.role)}
            </Text>
            <Pressable onPress={onClose}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>
          <Text style={styles.meta}>
            {[member?.phoneMasked, member?.emailMasked, formatSeen(member?.lastSeenAt)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Text style={styles.label}>Role</Text>
          <View style={styles.chips}>
            {STAFF_ROLE_OPTIONS.map((option) => {
              const on = nextRole === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    setNextRole(option.value);
                    setPerms(DEFAULT_STAFF_PERMISSIONS[option.value]);
                  }}
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.label}>Access</Text>
          <View style={styles.chips}>
            {STAFF_PERMISSIONS.map((item) => {
              const on = perms.includes(item.key);
              return (
                <Pressable
                  key={item.key}
                  onPress={() =>
                    setPerms((prev) =>
                      on
                        ? prev.filter((key) => key !== item.key)
                        : [...prev, item.key]
                    )
                  }
                  style={[styles.chip, on && styles.chipOn]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.label}>Active on this outlet</Text>
            <Switch
              value={active}
              onValueChange={setActive}
              trackColor={{ true: '#FECACA', false: '#E5E7EB' }}
              thumbColor={active ? authTheme.brand : '#FFFFFF'}
            />
          </View>
          <View style={styles.actions}>
            <Pressable
              disabled={busy || !ready}
              onPress={() => {
                if (!staffId) return;
                Alert.alert(
                  'Deactivate this person?',
                  'They lose kitchen access. You can invite them again later.',
                  [
                    { text: 'Keep' },
                    {
                      text: 'Deactivate',
                      style: 'destructive',
                      onPress: () => {
                        void onDeactivate(staffId).catch((error) => {
                          Alert.alert(
                            staffErrorTitle(error),
                            getApiErrorMessage(error)
                          );
                        });
                      },
                    },
                  ]
                );
              }}
              style={styles.danger}
            >
              <Trash2 color="#FFFFFF" size={14} />
            </Pressable>
            <Pressable
              disabled={busy || !ready}
              onPress={() => {
                if (!staffId) return;
                void onSave(staffId, {
                  role: nextRole,
                  permissions: perms,
                  isActive: active,
                }).catch((error) => {
                  Alert.alert(staffErrorTitle(error), getApiErrorMessage(error));
                });
              }}
              style={styles.primaryFlex}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>Save access</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function normalizeSheetRole(role?: string | null): StaffRole {
  const raw = String(role ?? '').toLowerCase();
  if (raw === 'manager') return 'manager';
  if (raw === 'cashier') return 'cashier';
  return 'kitchen';
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 4,
  },
  tab: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  tabOn: { backgroundColor: authTheme.brand },
  tabText: { fontFamily: fonts.bold, fontSize: 12, color: authTheme.textMuted },
  tabTextOn: { color: '#FFFFFF' },
  list: { gap: 10 },
  card: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: fonts.bold, fontSize: 15, color: authTheme.brand },
  name: { fontFamily: fonts.bold, fontSize: 14, color: authTheme.text },
  meta: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  seen: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textDim,
  },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 8 },
  emptyTitle: { fontFamily: fonts.extraBold, fontSize: 15, color: authTheme.text },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
    textAlign: 'center',
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingVertical: 12,
  },
  primaryFlex: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.bold, fontSize: 13, color: '#FFFFFF' },
  form: { gap: 8 },
  hint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  label: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.text,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
    backgroundColor: '#FAFAFA',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FAFAFA',
  },
  inputFlex: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(122,14,34,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  chipOn: { backgroundColor: authTheme.brand, borderColor: authTheme.brand },
  chipText: { fontFamily: fonts.semiBold, fontSize: 12, color: authTheme.textMuted },
  chipTextOn: { color: '#FFFFFF' },
  link: { fontFamily: fonts.semiBold, fontSize: 12, color: authTheme.brand },
  linkActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: authTheme.brandSoft,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  linkBtnText: { fontFamily: fonts.bold, fontSize: 12, color: authTheme.brand },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 10,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { fontFamily: fonts.extraBold, fontSize: 18, color: authTheme.text },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  danger: {
    width: 44,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
