import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { formatIncentiveError } from '@/lib/delivery-partner/incentives-api';
import {
  useIncentiveDetail,
  useIncentiveMutations,
  useIncentiveProgress,
} from '@/lib/delivery-partner/incentives-hooks';
import {
  incentiveKindLabel,
  incentiveWindowLabel,
  metricLabelCopy,
  type IncentiveProgram,
  type IncentiveProgress,
  type IncentiveSlab,
} from '@/lib/delivery-partner/incentives-types';

type Props = {
  incentiveId: string | null;
  seed?: IncentiveProgram | null;
  onClose: () => void;
};

function slabList(program?: IncentiveProgram | null, live?: IncentiveProgress | null) {
  if (live?.slabs?.length) return live.slabs;
  if (program?.progress?.slabs?.length) return program.progress.slabs;
  return program?.slabs ?? [];
}

function progressPct(metric: number, slabs: IncentiveSlab[]) {
  const last = slabs[slabs.length - 1]?.target ?? 0;
  if (last <= 0) return 0;
  return Math.max(0, Math.min(100, (metric / last) * 100));
}

export function IncentiveDetailSheet({ incentiveId, seed, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const visible = Boolean(incentiveId);
  const { optIn } = useIncentiveMutations();
  const [error, setError] = useState<string | null>(null);

  const detail = useIncentiveDetail(incentiveId ?? undefined, visible);
  const live = useIncentiveProgress(incentiveId ?? undefined, visible);

  useEffect(() => {
    if (!visible) {
      setError(null);
      optIn.reset();
    }
  }, [visible]);

  const program = detail.data ?? seed ?? null;
  const progress = live.data ?? program?.progress ?? null;
  const slabs = useMemo(() => slabList(program, progress), [program, progress]);
  const metric = progress?.metric ?? 0;
  const next = progress?.nextSlab ?? null;
  const needsOptIn = Boolean(
    (progress?.requiresOptIn ?? program?.requiresOptIn) &&
      !(progress?.optedIn ?? program?.optedIn)
  );
  const eligible = progress?.eligible ?? true;
  const loading = detail.isLoading && !program;

  const onOptIn = async () => {
    if (!incentiveId) return;
    setError(null);
    try {
      await optIn.mutateAsync(incentiveId);
    } catch (err) {
      setError(formatIncentiveError(err, 'Could not opt in. Try again.'));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>
              {program?.title ?? 'Incentive'}
            </Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
              <X color="#111827" size={18} />
            </Pressable>
          </View>

          {loading ? (
            <ActivityIndicator color="#EA4B14" style={{ marginVertical: 28 }} />
          ) : detail.isError && !program ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {formatIncentiveError(detail.error, 'Could not load this program.')}
              </Text>
              <Pressable onPress={() => void detail.refetch()} style={styles.retry}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.metaRow}>
                <Text style={styles.chip}>
                  {incentiveKindLabel(program?.kind ?? progress?.kind)}
                </Text>
                {incentiveWindowLabel(program?.window ?? progress?.window) ? (
                  <Text style={styles.chipMuted}>
                    {incentiveWindowLabel(program?.window ?? progress?.window)}
                  </Text>
                ) : null}
                {progress?.optedIn || program?.optedIn ? (
                  <Text style={styles.chipOk}>Enrolled</Text>
                ) : program?.requiresOptIn ? (
                  <Text style={styles.chipWarn}>Opt-in</Text>
                ) : (
                  <Text style={styles.chipOk}>Auto</Text>
                )}
              </View>

              {program?.description ? (
                <Text style={styles.desc}>{program.description}</Text>
              ) : null}

              <View style={styles.progressCard}>
                <View style={styles.progressTop}>
                  <Text style={styles.metric}>
                    {metric}
                    <Text style={styles.metricUnit}>
                      {' '}
                      {metricLabelCopy(progress?.metricLabel)}
                    </Text>
                  </Text>
                  <Text style={styles.pending}>
                    {formatCurrency(progress?.bonusEarnedInr ?? 0)} earned
                  </Text>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${progressPct(metric, slabs)}%` },
                    ]}
                  />
                </View>
                <Text style={styles.next}>
                  {next
                    ? `Next: ${next.label ?? `${next.target}`} · ${formatCurrency(next.bonusInr)}`
                    : slabs.length
                      ? 'All slabs unlocked'
                      : 'No slabs on this program'}
                </Text>
                {progress?.periodKey ? (
                  <Text style={styles.period}>Period {progress.periodKey}</Text>
                ) : null}
              </View>

              {slabs.map((slab, index) => {
                const hit = metric >= slab.target || slab.achieved;
                return (
                  <View key={`${slab.target}-${index}`} style={styles.slab}>
                    <View style={[styles.dot, hit && styles.dotOn]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.slabTitle}>
                        {slab.label ?? `${slab.target}`}
                      </Text>
                      <Text style={styles.slabMeta}>
                        {formatCurrency(slab.bonusInr)}
                        {slab.credited ? ' · credited' : hit ? ' · unlocked' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.slabState, hit && styles.slabStateOn]}>
                      {hit ? 'Done' : `${Math.max(0, slab.target - metric)} left`}
                    </Text>
                  </View>
                );
              })}

              {!eligible && progress?.ineligibilityReason ? (
                <Text style={styles.warn}>{progress.ineligibilityReason}</Text>
              ) : null}
              {error ? <Text style={styles.warn}>{error}</Text> : null}

              {needsOptIn ? (
                <Pressable
                  onPress={() => void onOptIn()}
                  disabled={!eligible || optIn.isPending}
                  style={[
                    styles.cta,
                    (!eligible || optIn.isPending) && styles.ctaOff,
                  ]}
                >
                  {optIn.isPending ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.ctaText}>
                      {eligible ? 'Opt in this period' : 'Not eligible'}
                    </Text>
                  )}
                </Pressable>
              ) : (
                <Text style={styles.hint}>
                  Progress updates as you complete trips. Bonuses credit to wallet
                  when a slab is hit.
                </Text>
              )}
            </ScrollView>
          )}
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
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 20,
    color: '#111827',
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9A3412',
    backgroundColor: '#FFEDD5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  chipMuted: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  chipOk: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#166534',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  chipWarn: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  desc: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 14,
  },
  progressCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
  },
  progressTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 10,
  },
  metric: {
    fontFamily: fonts.extraBold,
    fontSize: 28,
    color: '#9A3412',
  },
  metricUnit: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#C2410C',
  },
  pending: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#9A3412',
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FED7AA',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#EA4B14',
    borderRadius: 4,
  },
  next: {
    marginTop: 8,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#9A3412',
  },
  period: {
    marginTop: 4,
    fontFamily: fonts.regular,
    fontSize: 11,
    color: '#C2410C',
  },
  slab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F3F4F6',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#E5E7EB',
  },
  dotOn: { backgroundColor: '#22C55E' },
  slabTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: '#111827',
  },
  slabMeta: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  slabState: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#9CA3AF',
  },
  slabStateOn: { color: '#16A34A' },
  warn: {
    marginTop: 12,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#B45309',
  },
  hint: {
    marginTop: 14,
    marginBottom: 8,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 18,
  },
  cta: {
    marginTop: 16,
    marginBottom: 8,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#EA4B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOff: { opacity: 0.55 },
  ctaText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  empty: { alignItems: 'center', paddingVertical: 28, gap: 12 },
  emptyText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  retry: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
  },
  retryText: { fontFamily: fonts.semiBold, color: '#EA4B14' },
});
