import { Bike, Check, X } from 'lucide-react-native';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useAvailablePartners,
  usePartnerMutations,
  useRestaurantPartners,
} from '@/lib/partner/hooks';
import type { DeliveryPartner } from '@/lib/partner/types';

type Props = {
  visible: boolean;
  restaurantId: string;
  orderId: string;
  onClose: () => void;
  onAssigned?: (partner: DeliveryPartner) => void;
};

export function AssignPartnerModal({
  visible,
  restaurantId,
  orderId,
  onClose,
  onAssigned,
}: Props) {
  const partners = useRestaurantPartners();
  const available = useAvailablePartners(visible);
  const mutations = usePartnerMutations(restaurantId);

  const associated = (partners.data ?? []).filter((p) => {
    const status = String(p.status ?? '').toLowerCase();
    return !['inactive', 'suspended', 'deactivated'].includes(status);
  });
  const nearby = available.data ?? [];

  const poolMap = new Map<string, DeliveryPartner>();
  [...associated.filter((p) => String(p.status).toLowerCase() !== 'inactive'), ...nearby].forEach(
    (partner) => {
      if (partner.id) poolMap.set(partner.id, partner);
    }
  );
  const pool = Array.from(poolMap.values());

  const assign = async (partner: DeliveryPartner) => {
    try {
      const result = await mutations.manualAssign.mutateAsync({
        orderId,
        payload: { partnerId: partner.id },
      });
      const assigned: DeliveryPartner = {
        ...partner,
        id: result.partnerId ?? partner.id,
        name: result.name ?? partner.name,
        phone: result.phone ?? partner.phone,
        vehicleType: result.vehicleType ?? partner.vehicleType,
        vehicleNumber: result.vehicleNumber ?? partner.vehicleNumber,
        isOnline: true,
      };
      onAssigned?.(assigned);
      onClose();
      Alert.alert(
        'Offer sent',
        `${assigned.name} was offered this order. They must accept before pickup.`
      );
    } catch (error) {
      Alert.alert('Could not assign rider', getApiErrorMessage(error));
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Assign your rider</Text>
            <Pressable onPress={onClose}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Pick a fleet rider who is online. This offers the trip to them — it
            does not invent an assignment. Pickup orders cannot use this.
          </Text>

          {(partners.isError || available.isError) && pool.length === 0 ? (
            <Text style={styles.emptyText}>
              {getApiErrorMessage(partners.error ?? available.error)}
            </Text>
          ) : null}

          {(partners.isLoading || available.isLoading) && pool.length === 0 ? (
            <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 24 }} />
          ) : null}

          {pool.length === 0 && !partners.isLoading && !available.isLoading && !partners.isError && !available.isError ? (
            <View style={styles.empty}>
              <Bike color={authTheme.textDim} size={28} />
              <Text style={styles.emptyText}>
                No online fleet riders. Invite riders from Partners first — nearby
                is only your roster with a live GPS ping.
              </Text>
            </View>
          ) : pool.length > 0 ? (
            <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
              {pool.map((partner) => (
                <Pressable
                  key={partner.id}
                  disabled={mutations.manualAssign.isPending}
                  onPress={() => void assign(partner)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.pressed,
                    mutations.manualAssign.isPending && styles.disabled,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{partner.name}</Text>
                    <Text style={styles.meta}>
                      {[
                        partner.isOnline ? 'Online' : null,
                        partner.phone,
                        partner.distanceKm != null
                          ? `${partner.distanceKm.toFixed(1)} km`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Check color={authTheme.brand} size={18} />
                </Pressable>
              ))}
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
  card: {
    maxHeight: '78%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: authTheme.text,
    fontSize: 17,
    fontFamily: fonts.bold,
  },
  hint: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
  },
  list: { marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(122,14,34,0.1)',
  },
  name: {
    color: authTheme.text,
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  meta: {
    marginTop: 2,
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyText: {
    color: authTheme.textMuted,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: fonts.medium,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
