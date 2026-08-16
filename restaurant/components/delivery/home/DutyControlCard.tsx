import { Coffee, Plus, RotateCcw } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { fonts } from '@/constants/typography';
import {
  breakDurationOptions,
  breakExtendMinutes,
  breakSecondsLeft,
  canAcceptOffers,
  dutyStatusHint,
  dutyStatusLabel,
  formatDutyKm,
  formatMinutes,
  type PartnerBreakPolicy,
  type PartnerDutyStatus,
  type PartnerDutyStatusSnapshot,
  type PartnerDutySummary,
} from '@/lib/delivery-partner/availability-types';

type Props = {
  snapshot?: PartnerDutyStatusSnapshot | null;
  fallbackStatus?: PartnerDutyStatus;
  isOnDuty: boolean;
  summary?: PartnerDutySummary | null;
  policy?: PartnerBreakPolicy | null;
  statusLoading?: boolean;
  statusError?: string | null;
  onRetryStatus?: () => void;
  togglePending?: boolean;
  breakBusy?: boolean;
  resumeBusy?: boolean;
  onToggle: () => void;
  onStartBreak: (durationMinutes: number) => void;
  onEndBreak: () => void;
  onExtendBreak: (additionalMinutes: number) => void;
  onLeaveHub: () => void;
  onOpenHubs: () => void;
  gpsBanner?: string | null;
  actionError?: string | null;
  summaryError?: string | null;
  onRetrySummary?: () => void;
};

function formatCountdown(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Live duty control — GET /status + GET /duty-summary, mutations for
 * go-online / go-offline / break / PUT /status (resume from hub).
 */
export function DutyControlCard({
  snapshot,
  fallbackStatus,
  isOnDuty,
  summary,
  policy,
  statusLoading,
  statusError,
  onRetryStatus,
  togglePending,
  breakBusy,
  resumeBusy,
  onToggle,
  onStartBreak,
  onEndBreak,
  onExtendBreak,
  onLeaveHub,
  onOpenHubs,
  gpsBanner,
  actionError,
  summaryError,
  onRetrySummary,
}: Props) {
  const dutyStatus = snapshot?.dutyStatus ?? fallbackStatus;
  const onDelivery = dutyStatus === 'on_delivery';
  const onBreak =
    dutyStatus === 'on_break' || Boolean(snapshot?.break?.active);
  const onWayToHub = dutyStatus === 'on_way_to_hub';
  const accepting = canAcceptOffers(dutyStatus);
  const durations = breakDurationOptions(snapshot?.break, policy);
  const extendBy = breakExtendMinutes(snapshot?.break, policy);
  const remainingToday =
    snapshot?.break?.minutesRemainingToday ?? policy?.maxMinutesPerDay ?? 0;
  const maxPerDay =
    policy?.maxMinutesPerDay ?? snapshot?.break?.maxMinutesPerDay ?? 60;

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!onBreak) return;
    const timer = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [onBreak]);

  const secondsLeft = useMemo(() => {
    void tick;
    return breakSecondsLeft(snapshot?.break);
  }, [snapshot?.break, tick]);

  return (
    <View>
      {statusError ? (
        <Pressable onPress={onRetryStatus} style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{statusError}</Text>
          <View style={styles.retryChip}>
            <RotateCcw color="#FECACA" size={12} />
            <Text style={styles.retryText}>Retry</Text>
          </View>
        </Pressable>
      ) : null}

      <View
        style={[
          styles.pill,
          accepting || onBreak || onWayToHub ? { marginBottom: 8 } : null,
        ]}
      >
        <View style={styles.info}>
          {statusLoading && !snapshot ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Text style={styles.hint}>
                {dutyStatusHint(snapshot ?? { dutyStatus })}
              </Text>
              <Text style={styles.title}>
                {dutyStatusLabel(dutyStatus ?? (isOnDuty ? 'online' : 'offline'))}
              </Text>
            </>
          )}
        </View>
        <Switch
          value={isOnDuty}
          onValueChange={onToggle}
          disabled={togglePending || onDelivery}
          trackColor={{ false: '#374151', true: '#EA4B14' }}
          thumbColor={isOnDuty ? '#000000' : '#9CA3AF'}
        />
      </View>

      {onBreak ? (
        <View style={styles.breakRow}>
          <Pressable
            onPress={onEndBreak}
            disabled={breakBusy}
            style={[styles.breakChoice, { flex: 1.2 }]}
          >
            {breakBusy ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Coffee color="#FFFFFF" size={15} />
                <Text style={styles.breakBtnText}>
                  {secondsLeft != null
                    ? `End · ${formatCountdown(secondsLeft)}`
                    : 'End break'}
                </Text>
              </>
            )}
          </Pressable>
          {extendBy > 0 ? (
            <Pressable
              onPress={() => onExtendBreak(extendBy)}
              disabled={breakBusy}
              style={styles.extendBtn}
            >
              <Plus color="#111827" size={15} />
              <Text style={styles.extendBtnText}>+{extendBy} min</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {accepting && !onDelivery ? (
        durations.length ? (
          <View style={styles.breakRow}>
            {durations.map((mins) => (
              <Pressable
                key={mins}
                onPress={() => onStartBreak(mins)}
                disabled={breakBusy}
                style={styles.breakChoice}
              >
                {breakBusy ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Coffee color="#FFFFFF" size={14} />
                    <Text style={styles.breakBtnText}>{mins} min break</Text>
                  </>
                )}
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.quotaNote}>
            Daily break limit reached ({snapshot?.break?.minutesUsedToday ?? 0}/
            {maxPerDay} min).
          </Text>
        )
      ) : null}

      {accepting && remainingToday > 0 && remainingToday < maxPerDay ? (
        <Text style={styles.quotaNote}>
          {remainingToday}m break left today
          {policy?.minOnlineMinutesBefore
            ? ` · wait ${policy.minOnlineMinutesBefore}m online first`
            : ''}
        </Text>
      ) : null}

      {onWayToHub ? (
        <View style={styles.hubActions}>
          <Pressable
            onPress={onLeaveHub}
            disabled={resumeBusy}
            style={styles.resumeBtn}
          >
            {resumeBusy ? (
              <ActivityIndicator color="#111827" size="small" />
            ) : (
              <Text style={styles.resumeBtnText}>
                {snapshot?.hub?.checkedInAt
                  ? 'Check out → online'
                  : 'Cancel heading → online'}
              </Text>
            )}
          </Pressable>
          <Pressable onPress={onOpenHubs} style={styles.hubLink}>
            <Text style={styles.hubLinkText}>View hubs</Text>
          </Pressable>
        </View>
      ) : accepting && !onDelivery ? (
        <Pressable onPress={onOpenHubs} style={styles.hubLink}>
          <Text style={styles.hubLinkText}>Nearby hubs & cash drop</Text>
        </Pressable>
      ) : null}

      {gpsBanner ? <Text style={styles.gpsBanner}>{gpsBanner}</Text> : null}
      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      <View style={styles.summaryRow}>
        {summaryError ? (
          <Pressable onPress={onRetrySummary} style={styles.summaryError}>
            <Text style={styles.summaryErrorText}>{summaryError}</Text>
            <Text style={styles.summaryRetry}>Retry</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>
                {formatMinutes(summary?.onlineMinutes)}
              </Text>
              <Text style={styles.summaryLabel}>Online today</Text>
            </View>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{summary?.deliveries ?? 0}</Text>
              <Text style={styles.summaryLabel}>Trips</Text>
            </View>
            <View style={styles.summaryCell}>
              <Text style={styles.summaryValue}>{formatDutyKm(summary?.km)}</Text>
              <Text style={styles.summaryLabel}>Distance</Text>
            </View>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#7F1D1D',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  errorBannerText: {
    flex: 1,
    color: '#FECACA',
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  retryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  retryText: {
    color: '#FECACA',
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#262626',
    borderRadius: 24,
    padding: 16,
    marginBottom: 16,
  },
  info: { flex: 1, paddingRight: 8 },
  hint: {
    color: '#9CA3AF',
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  title: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 16,
    marginTop: 4,
  },
  breakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#3F3F46',
    borderRadius: 16,
    paddingVertical: 12,
    marginBottom: 8,
  },
  breakRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  breakChoice: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#3F3F46',
    borderRadius: 16,
    paddingVertical: 12,
  },
  breakBtnText: {
    color: '#FFFFFF',
    fontFamily: fonts.semiBold,
    fontSize: 13,
  },
  extendBtn: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#FDBA74',
    borderRadius: 16,
    paddingVertical: 12,
  },
  extendBtnText: {
    color: '#111827',
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  quotaNote: {
    color: '#A1A1AA',
    fontFamily: fonts.medium,
    fontSize: 12,
    marginBottom: 10,
  },
  resumeBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDBA74',
    borderRadius: 16,
    paddingVertical: 12,
  },
  resumeBtnText: {
    color: '#111827',
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  hubActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  hubLink: {
    paddingVertical: 8,
    marginBottom: 8,
    alignItems: 'center',
  },
  hubLinkText: {
    color: '#FDBA74',
    fontFamily: fonts.semiBold,
    fontSize: 13,
  },
  gpsBanner: {
    marginTop: 4,
    marginBottom: 10,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#FDBA74',
    lineHeight: 17,
  },
  actionError: {
    marginBottom: 10,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#FCA5A5',
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  summaryCell: {
    flex: 1,
    backgroundColor: '#1F1F1F',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  summaryValue: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  summaryLabel: {
    marginTop: 2,
    color: '#9CA3AF',
    fontFamily: fonts.medium,
    fontSize: 11,
  },
  summaryError: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 4,
  },
  summaryErrorText: {
    flex: 1,
    color: '#FCA5A5',
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  summaryRetry: {
    color: '#FDBA74',
    fontFamily: fonts.semiBold,
    fontSize: 12,
  },
});
