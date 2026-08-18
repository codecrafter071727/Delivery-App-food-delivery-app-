import {
  Bike,
  Phone,
  Star,
  UserPlus,
} from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import type { KitchenRider } from '@/lib/order/owner-api';
import { displayStatus } from '@/lib/order/ui';

type Props = {
  rider?: KitchenRider;
  loading?: boolean;
  error?: unknown;
  canAssign?: boolean;
  canRate?: boolean;
  callBusy?: boolean;
  onRetry: () => void;
  onCallCustomer: () => void;
  onAssign: () => void;
  onRate: () => void;
};

function dutyLabel(rider: KitchenRider) {
  const raw = rider.dutyStatus || rider.status || '';
  if (!raw) return rider.isOnline ? 'Online' : null;
  if (raw.toLowerCase().includes('return')) return 'Returning to store';
  if (raw.toLowerCase().includes('arrived')) return 'At the store';
  return displayStatus(raw);
}

export function KitchenRiderCard({
  rider,
  loading,
  error,
  canAssign,
  canRate,
  callBusy,
  onRetry,
  onCallCustomer,
  onAssign,
  onRate,
}: Props) {
  const assigned = Boolean(rider?.assigned && (rider.name || rider.partnerId));
  const phone = assigned
    ? rider?.isFleetPartner
      ? rider?.phone || rider?.phoneMasked
      : rider?.phoneMasked
    : undefined;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Bike color={authTheme.brand} size={16} />
        <Text style={styles.title}>Delivery partner</Text>
      </View>

      {loading && !rider ? (
        <ActivityIndicator color={authTheme.brand} />
      ) : error && !assigned ? (
        <>
          <Text style={styles.error}>{getApiErrorMessage(error)}</Text>
          <Pressable onPress={onRetry} style={styles.ghost}>
            <Text style={styles.ghostText}>Retry</Text>
          </Pressable>
        </>
      ) : assigned ? (
        <>
          <Text style={styles.name}>{rider?.name || 'Rider'}</Text>
          <Text style={styles.meta}>
            {[
              rider?.isFleetPartner ? 'Your rider' : 'Platform rider',
              rider?.vehicleType,
              rider?.vehicleNumber,
              rider?.avgRating != null ? `${rider.avgRating.toFixed(1)}★` : null,
              dutyLabel(rider!),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {phone ? <Text style={styles.phone}>{phone}</Text> : null}
          {!rider?.isFleetPartner ? (
            <Text style={styles.hint}>
              Number is masked. Use Call customer — the platform connects you.
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.emptyTitle}>Finding a rider</Text>
          <Text style={styles.hint}>
            {rider?.message ||
              'Platform dispatch is looking. Assign one of your fleet riders if you need them now.'}
          </Text>
        </>
      )}

      <View style={styles.actions}>
        <Pressable
          disabled={callBusy}
          onPress={onCallCustomer}
          style={styles.action}
        >
          {callBusy ? (
            <ActivityIndicator color={authTheme.brand} size="small" />
          ) : (
            <Phone color={authTheme.brand} size={15} />
          )}
          <Text style={styles.actionText}>Call customer</Text>
        </Pressable>
        {canAssign ? (
          <Pressable onPress={onAssign} style={styles.action}>
            <UserPlus color={authTheme.brand} size={15} />
            <Text style={styles.actionText}>
              {assigned ? 'Assign your rider' : 'Assign rider'}
            </Text>
          </Pressable>
        ) : null}
        {canRate && assigned ? (
          <Pressable onPress={onRate} style={styles.action}>
            <Star color="#D97706" size={15} />
            <Text style={styles.actionText}>Rate pickup</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: authTheme.text,
  },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  phone: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
  hint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  emptyTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
  error: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.error,
  },
  ghost: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  ghostText: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.brand,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  action: {
    flexGrow: 1,
    minWidth: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: authTheme.surface,
  },
  actionText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.text,
  },
});
