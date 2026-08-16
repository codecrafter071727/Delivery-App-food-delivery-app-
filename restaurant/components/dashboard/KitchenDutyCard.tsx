import { CloudRain, PauseCircle, Store, Wifi, WifiOff } from 'lucide-react-native';
import { useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useKitchenDuty,
  useKitchenDutyMutations,
  useKitchenSurge,
} from '@/lib/restaurant/hooks';
import { isListingLive } from '@/lib/restaurant/listing-status';
import type { PauseReasonCode } from '@/lib/restaurant/types';

const PAUSE_MINUTES = [15, 30, 45, 60] as const;

const PAUSE_REASONS: { code: PauseReasonCode; label: string }[] = [
  { code: 'too_busy', label: 'Too busy' },
  { code: 'staffing', label: 'Short staff' },
  { code: 'packaging', label: 'Packing delay' },
  { code: 'closing_soon', label: 'Closing soon' },
  { code: 'other', label: 'Other' },
];

function pauseReasonLabel(code?: string | null) {
  return PAUSE_REASONS.find((row) => row.code === code)?.label ?? code ?? 'Busy';
}

function remainingPause(iso?: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'ending now';
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
  }
  return `${mins} min left`;
}

type Props = {
  restaurantId: string;
  onHoursPress?: () => void;
  compact?: boolean;
};

function DutyButton({
  label,
  onPress,
  disabled,
  icon,
  variant = 'primary',
  compact = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary';
  compact?: boolean;
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={[
          isPrimary ? styles.primaryBtn : styles.secondaryBtn,
          compact && isPrimary ? styles.primaryBtnCompact : null,
          compact && !isPrimary ? styles.secondaryBtnCompact : null,
          disabled ? styles.disabled : null,
        ]}
      >
        {icon}
        <Text
          style={[
            isPrimary ? styles.primaryBtnText : styles.secondaryBtnText,
            compact ? styles.btnTextCompact : null,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function KitchenDutyCard({
  restaurantId,
  onHoursPress,
  compact = false,
}: Props) {
  const dutyQuery = useKitchenDuty(restaurantId, Boolean(restaurantId));
  const surgeQuery = useKitchenSurge(restaurantId, Boolean(restaurantId));
  const mutations = useKitchenDutyMutations(restaurantId);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [minutes, setMinutes] = useState<(typeof PAUSE_MINUTES)[number]>(30);
  const [reason, setReason] = useState<PauseReasonCode>('too_busy');

  const duty = dutyQuery.data;
  const listingLive = isListingLive(duty?.status);
  const paused = duty?.duty === 'paused';
  const online = duty?.duty === 'online' && duty.isOnline === true;
  const storeOn = online || paused;
  const busy =
    mutations.goOnline.isPending ||
    mutations.goOffline.isPending ||
    mutations.pauseDuty.isPending;

  const headline = useMemo(() => {
    if (!duty) return 'Store status';
    if (!listingLive) return 'Listing not live';
    if (paused) return 'Temporarily paused';
    if (online) return duty.openNow ? 'Restaurant is open' : 'Online · closed hours';
    return 'Restaurant is closed';
  }, [duty, listingLive, online, paused]);

  const subtitle = useMemo(() => {
    if (!duty) return 'Checking store status…';
    if (!listingLive) {
      return compact
        ? 'Admin must approve before you can accept orders.'
        : 'Admin must approve this outlet before you can accept orders.';
    }
    if (paused) {
      const left = remainingPause(duty.pausedUntil);
      return compact
        ? `${pauseReasonLabel(duty.pauseReason)}${left ? ` · ${left}` : ''}`
        : `${pauseReasonLabel(duty.pauseReason)}${left ? ` · ${left}` : ''}. In-flight orders continue.`;
    }
    if (online) {
      if (duty.openNow) {
        return compact
          ? 'Accepting new orders'
          : 'Customers can order now. In-flight orders always continue.';
      }
      return compact
        ? 'Online, but outside weekly hours'
        : 'You are online, but weekly hours say closed. Update hours if you want orders.';
    }
    return compact
      ? 'New orders are paused. In-kitchen orders continue.'
      : 'New orders are stopped. In-flight orders still continue.';
  }, [compact, duty, listingLive, online, paused]);

  const runDuty = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (error) {
      Alert.alert(
        'Could not update store',
        getApiErrorMessage(error, 'Could not update store status')
      );
    }
  };

  const onToggle = (next: boolean) => {
    if (!listingLive) {
      Alert.alert(
        'Listing not live',
        'Admin must approve this restaurant before you can go online.'
      );
      return;
    }
    if (next) {
      void runDuty(() => mutations.goOnline.mutateAsync());
      return;
    }
    Alert.alert(
      'Go offline?',
      'New orders will stop. Orders already in the kitchen keep going.',
      [
        { text: 'Stay online', style: 'cancel' },
        {
          text: 'Go offline',
          style: 'destructive',
          onPress: () => void runDuty(() => mutations.goOffline.mutateAsync()),
        },
      ]
    );
  };

  const onPause = () => {
    if (!listingLive) {
      Alert.alert(
        'Listing not live',
        'Admin must approve this restaurant before you can pause.'
      );
      return;
    }
    if (!storeOn) {
      Alert.alert(
        'Go online first',
        'Pause only works while the store is online.'
      );
      return;
    }
    void runDuty(async () => {
      await mutations.pauseDuty.mutateAsync({ minutes, reason });
      setPauseOpen(false);
    });
  };

  const surge = surgeQuery.data;
  const showSurgeChip = Boolean(surge?.assigned && surge.surgeActive);
  const showZoneHint = surge && !surge.assigned;
  const showSurgeDown = surge?.unavailable === true;

  return (
    <View
      style={[
        styles.card,
        storeOn && listingLive && !paused ? styles.cardOpen : null,
        paused ? styles.cardPaused : null,
      ]}
    >
      <View style={styles.topRow}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: paused
                ? 'rgba(234, 179, 8, 0.14)'
                : storeOn
                  ? 'rgba(34, 197, 94, 0.12)'
                  : authTheme.brandSoft,
            },
          ]}
        >
          {paused ? (
            <PauseCircle color="#CA8A04" size={20} />
          ) : storeOn ? (
            <Wifi color={authTheme.success} size={20} />
          ) : (
            <WifiOff color={authTheme.textMuted} size={20} />
          )}
        </View>
        <View style={styles.titleCol}>
          <Text style={styles.kicker}>{compact ? 'Store' : 'Kitchen duty'}</Text>
          <Text style={styles.headline}>{headline}</Text>
        </View>
        {dutyQuery.isLoading && !duty ? (
          <ActivityIndicator color={authTheme.brand} />
        ) : (
          <Switch
            value={storeOn}
            onValueChange={onToggle}
            disabled={busy || !listingLive}
            trackColor={{ false: '#E2E8F0', true: 'rgba(34, 197, 94, 0.55)' }}
            thumbColor={storeOn ? authTheme.success : '#F8FAFC'}
          />
        )}
      </View>

      <Text style={styles.subtitle}>{subtitle}</Text>

      <View style={styles.chipRow}>
        {showSurgeChip ? (
          <View style={styles.surgeChip}>
            <CloudRain color="#1D4ED8" size={13} />
            <Text style={styles.surgeText}>
              {surge?.reason === 'zone_surge' ? 'Rain / surge' : 'Zone surge'} ·{' '}
              {Number(surge?.surgeMultiplier ?? 1).toFixed(1)}x
              {surge?.name ? ` · ${surge.name}` : ''}
            </Text>
          </View>
        ) : null}
        {showZoneHint ? (
          <View style={styles.mutedChip}>
            <Text style={styles.mutedChipText}>Zone not assigned</Text>
          </View>
        ) : null}
        {showSurgeDown ? (
          <View style={styles.mutedChip}>
            <Text style={styles.mutedChipText}>Surge unavailable</Text>
          </View>
        ) : null}
        {duty?.openNow && listingLive ? (
          <View style={styles.openChip}>
            <Store color="#15803D" size={13} />
            <Text style={styles.openChipText}>Open now</Text>
          </View>
        ) : null}
      </View>

      {listingLive && storeOn ? (
        paused ? (
          <DutyButton
            label="Resume orders"
            compact={compact}
            disabled={busy}
            onPress={() => void runDuty(() => mutations.goOnline.mutateAsync())}
          />
        ) : (
          <>
            <DutyButton
              variant="secondary"
              compact={compact}
              disabled={busy}
              onPress={() => setPauseOpen((open) => !open)}
              icon={<PauseCircle color="#EA4B14" size={compact ? 14 : 16} />}
              label={
                pauseOpen
                  ? 'Hide pause'
                  : compact
                    ? 'Pause orders'
                    : 'Busy? Pause new orders'
              }
            />
            {pauseOpen ? (
              <View style={styles.pauseBox}>
                <Text style={styles.pauseLabel}>Pause for</Text>
                <View style={styles.choiceRow}>
                  {PAUSE_MINUTES.map((value) => {
                    const active = minutes === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setMinutes(value)}
                      >
                        <View style={[styles.choice, active && styles.choiceOn]}>
                          <Text
                            style={[
                              styles.choiceText,
                              active && styles.choiceTextOn,
                            ]}
                          >
                            {value}m
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.pauseLabel}>Reason</Text>
                <View style={styles.choiceRow}>
                  {PAUSE_REASONS.map((row) => {
                    const active = reason === row.code;
                    return (
                      <Pressable
                        key={row.code}
                        onPress={() => setReason(row.code)}
                      >
                        <View style={[styles.choice, active && styles.choiceOn]}>
                          <Text
                            style={[
                              styles.choiceText,
                              active && styles.choiceTextOn,
                            ]}
                          >
                            {row.label}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <DutyButton
                  label={`Pause for ${minutes} min`}
                  compact={compact}
                  disabled={busy}
                  onPress={onPause}
                />
              </View>
            ) : null}
          </>
        )
      ) : null}

      {onHoursPress ? (
        <Pressable
          onPress={onHoursPress}
          style={({ pressed }) => [styles.linkBtn, pressed && styles.pressed]}
        >
          <Text style={styles.linkText}>
            {compact ? 'Opening hours' : 'Edit weekly hours'}
          </Text>
        </Pressable>
      ) : null}

      {dutyQuery.isError && !duty ? (
        <Pressable onPress={() => void dutyQuery.refetch()} style={styles.linkBtn}>
          <Text style={styles.errorText}>
            {getApiErrorMessage(dutyQuery.error, 'Could not load store status')}
            {' · '}
            Tap to retry
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 16,
    gap: 10,
  },
  cardOpen: {
    borderColor: 'rgba(22, 163, 74, 0.28)',
    backgroundColor: '#F7FEF9',
  },
  cardPaused: {
    borderColor: 'rgba(202, 138, 4, 0.32)',
    backgroundColor: '#FFFBEB',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleCol: { flex: 1, gap: 2 },
  kicker: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  headline: {
    color: authTheme.text,
    fontSize: 18,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  surgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DBEAFE',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  surgeText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  mutedChip: {
    backgroundColor: '#F1F5F9',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  mutedChipText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  openChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  openChipText: {
    color: '#15803D',
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  primaryBtn: {
    backgroundColor: '#EA4B14',
    borderRadius: 10,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtnCompact: {
    minHeight: 36,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: fonts.bold,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    minHeight: 40,
    borderWidth: 1,
    borderColor: '#EA4B14',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  secondaryBtnCompact: {
    alignSelf: 'flex-start',
    minHeight: 32,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  secondaryBtnText: {
    color: '#EA4B14',
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  btnTextCompact: {
    fontSize: 12,
  },
  pauseBox: { gap: 10 },
  pauseLabel: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choice: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  choiceOn: {
    backgroundColor: authTheme.brandSoft,
    borderColor: authTheme.brand,
  },
  choiceText: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
  },
  choiceTextOn: { color: authTheme.brand },
  linkBtn: { alignSelf: 'flex-start', paddingVertical: 2 },
  linkText: {
    color: authTheme.brand,
    fontSize: 13,
    fontFamily: fonts.bold,
  },
  errorText: {
    color: authTheme.error,
    fontSize: 12,
    fontFamily: fonts.medium,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.55 },
});
