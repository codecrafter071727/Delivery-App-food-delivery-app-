import { Bike, Phone, Star, X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import { usePartnerDetail, usePartnerMutations } from '@/lib/partner/hooks';
import type { DeliveryPartner, FleetStatusAction } from '@/lib/partner/types';

const SUSPEND_REASONS = [
  'Repeated late pickups',
  'Rude to kitchen staff',
  'Vehicle / gear issue',
  'Other',
];

type Props = {
  visible: boolean;
  restaurantId: string;
  partner?: DeliveryPartner | null;
  onClose: () => void;
};

export function dutyLabel(partner: DeliveryPartner) {
  const duty = String(partner.dutyStatus ?? '').toLowerCase();
  const status = String(partner.status ?? '').toLowerCase();
  if (status === 'suspended') return 'Suspended';
  if (status === 'deactivated' || status === 'inactive') return 'Deactivated';
  if (duty.includes('deliver')) return 'On a delivery';
  if (duty.includes('break')) return 'On break';
  if (partner.isOnline || duty.includes('available') || duty.includes('online')) {
    return 'Online';
  }
  if (duty.includes('off')) return 'Offline';
  return partner.isOnline ? 'Online' : 'Offline';
}

export function rosterStatusLabel(status?: string) {
  const value = String(status ?? 'active').toLowerCase();
  if (value === 'suspended') return 'Suspended';
  if (value === 'deactivated' || value === 'inactive') return 'Deactivated';
  if (value === 'active') return 'Active';
  return value.replace(/_/g, ' ');
}

function canActivate(status?: string) {
  const value = String(status ?? '').toLowerCase();
  return value === 'suspended' || value === 'deactivated' || value === 'inactive';
}

function statusErrorTitle(error: unknown) {
  const message = getApiErrorMessage(error);
  if (message.includes('PARTNER_KYC_PENDING')) return 'KYC pending';
  if (message.includes('PARTNER_ON_DELIVERY')) return 'On a delivery';
  if (message.includes('ILLEGAL_TRANSITION')) return 'Can’t change status';
  if (message.includes('REASON_REQUIRED')) return 'Reason needed';
  if (
    message.includes('DOWNSTREAM') ||
    message.includes('UNAVAILABLE') ||
    message.includes('503')
  ) {
    return 'Fleet service down';
  }
  return 'Could not update rider';
}

export function FleetPartnerSheet({
  visible,
  restaurantId,
  partner,
  onClose,
}: Props) {
  const partnerId = partner?.id;
  const detail = usePartnerDetail(
    restaurantId,
    partnerId,
    visible && Boolean(partnerId)
  );
  const mutations = usePartnerMutations(restaurantId);
  const row = detail.data ?? partner ?? null;
  const [action, setAction] = useState<Exclude<FleetStatusAction, 'activate'> | null>(
    null
  );
  const [reason, setReason] = useState(SUSPEND_REASONS[0]);
  const [note, setNote] = useState('');

  useEffect(() => {
    setAction(null);
    setReason(SUSPEND_REASONS[0]);
    setNote('');
  }, [partnerId, visible]);

  const reasonText = useMemo(() => {
    if (reason === 'Other') return note.trim();
    return reason;
  }, [note, reason]);

  const runStatus = async (next: FleetStatusAction) => {
    if (!partnerId) return;
    try {
      await mutations.setStatus.mutateAsync({
        partnerId,
        payload:
          next === 'activate'
            ? { action: 'activate' }
            : { action: next, reason: reasonText },
      });
      setAction(null);
      setNote('');
      onClose();
    } catch (error) {
      Alert.alert(statusErrorTitle(error), getApiErrorMessage(error));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>Rider details</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>

          {detail.isLoading && !row ? (
            <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 24 }} />
          ) : detail.isError && !row ? (
            <Text style={styles.error}>{getApiErrorMessage(detail.error)}</Text>
          ) : row ? (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.identity}>
                {row.avatarUrl ? (
                  <Image source={{ uri: row.avatarUrl }} style={styles.photo} />
                ) : (
                  <View style={styles.photoFallback}>
                    <Text style={styles.initial}>
                      {(row.name || 'R').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.name}</Text>
                  <Text style={styles.meta}>
                    {[row.partnerCode, dutyLabel(row), rosterStatusLabel(row.status)]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </View>

              {row.phone ? (
                <View style={styles.kv}>
                  <Phone color={authTheme.textMuted} size={14} />
                  <Text style={styles.kvText}>{row.phone}</Text>
                </View>
              ) : null}
              {row.vehicleType || row.vehicleNumber ? (
                <View style={styles.kv}>
                  <Bike color={authTheme.textMuted} size={14} />
                  <Text style={styles.kvText}>
                    {[row.vehicleType, row.vehicleNumber].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ) : null}
              {row.rating != null ? (
                <View style={styles.kv}>
                  <Star color="#D97706" size={14} />
                  <Text style={styles.kvText}>
                    {row.rating.toFixed(1)}
                    {row.ratingCount != null ? ` (${row.ratingCount})` : ''}
                    {row.totalDeliveries != null
                      ? ` · ${row.totalDeliveries} trips`
                      : ''}
                  </Text>
                </View>
              ) : null}

              {row.distanceKm != null ? (
                <Text style={styles.copy}>
                  {row.distanceKm < 10
                    ? `${row.distanceKm.toFixed(1)} km from store`
                    : `${Math.round(row.distanceKm)} km from store`}
                </Text>
              ) : null}

              {action ? (
                <View style={styles.reasonBox}>
                  <Text style={styles.reasonTitle}>
                    {action === 'suspend' ? 'Why suspend?' : 'Why deactivate?'}
                  </Text>
                  <Text style={styles.copy}>
                    Need at least 8 characters. This rider is forced offline and
                    cannot take new orders.
                  </Text>
                  <View style={styles.chips}>
                    {SUSPEND_REASONS.map((item) => {
                      const on = reason === item;
                      return (
                        <Pressable
                          key={item}
                          onPress={() => setReason(item)}
                          style={[styles.chip, on && styles.chipOn]}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]}>
                            {item}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {reason === 'Other' ? (
                    <TextInput
                      value={note}
                      onChangeText={setNote}
                      placeholder="Describe what happened"
                      placeholderTextColor={authTheme.textDim}
                      style={styles.input}
                    />
                  ) : null}
                  <View style={styles.actions}>
                    <Pressable onPress={() => setAction(null)} style={styles.secondary}>
                      <Text style={styles.secondaryText}>Back</Text>
                    </Pressable>
                    <Pressable
                      disabled={mutations.setStatus.isPending || reasonText.length < 8}
                      onPress={() => void runStatus(action)}
                      style={[
                        styles.danger,
                        (mutations.setStatus.isPending || reasonText.length < 8) &&
                          styles.disabled,
                      ]}
                    >
                      {mutations.setStatus.isPending ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.dangerText}>
                          {action === 'suspend' ? 'Suspend' : 'Deactivate'}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  {canActivate(row.status) ? (
                    <Pressable
                      disabled={mutations.setStatus.isPending}
                      onPress={() => void runStatus('activate')}
                      style={styles.primary}
                    >
                      {mutations.setStatus.isPending ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.primaryText}>Activate</Text>
                      )}
                    </Pressable>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => setAction('suspend')}
                        style={styles.secondary}
                      >
                        <Text style={styles.secondaryText}>Suspend</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setAction('deactivate')}
                        style={styles.danger}
                      >
                        <Text style={styles.dangerText}>Deactivate</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 17,
    color: authTheme.text,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  photo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: authTheme.surface,
  },
  photoFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: authTheme.brand,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: authTheme.text,
  },
  meta: {
    marginTop: 2,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  kv: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  kvText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.text,
  },
  copy: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.error,
  },
  reasonBox: { gap: 10, marginTop: 8 },
  reasonTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: authTheme.surface,
  },
  chipOn: { backgroundColor: authTheme.brandSoft },
  chipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  chipTextOn: { color: authTheme.brand, fontFamily: fonts.semiBold },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    paddingHorizontal: 12,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brand,
  },
  primaryText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  secondaryText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  danger: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DC2626',
  },
  dangerText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
});
