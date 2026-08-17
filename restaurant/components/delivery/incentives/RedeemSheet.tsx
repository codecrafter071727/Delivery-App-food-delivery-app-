import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { formatIncentiveError } from '@/lib/delivery-partner/incentives-api';
import { useIncentiveMutations } from '@/lib/delivery-partner/incentives-hooks';
import {
  rewardKindLabel,
  type RewardCatalogItem,
  type RewardRedemption,
} from '@/lib/delivery-partner/incentives-types';

type Props = {
  item: RewardCatalogItem | null;
  points: number;
  onClose: () => void;
};

export function RedeemSheet({ item, points, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { redeem } = useIncentiveMutations();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RewardRedemption | null>(null);

  useEffect(() => {
    if (!item) {
      setError(null);
      setResult(null);
      redeem.reset();
    }
  }, [item]);

  const canRedeem = Boolean(item?.canRedeem && points >= (item?.pointsCost ?? 0));

  const onRedeem = async () => {
    if (!item) return;
    setError(null);
    try {
      const row = await redeem.mutateAsync(
        item.sku ? { sku: item.sku } : { itemId: item.itemId }
      );
      setResult(row);
    } catch (err) {
      setError(formatIncentiveError(err, 'Could not redeem. Try again.'));
    }
  };

  const shareCode = async () => {
    if (!result?.voucherCode) return;
    await Share.share({
      message: `${result.title ?? 'Reward'} code: ${result.voucherCode}`,
    });
  };

  return (
    <Modal visible={Boolean(item)} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={2}>
              {result ? 'Reward redeemed' : item?.title ?? 'Redeem'}
            </Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityLabel="Close">
              <X color="#111827" size={18} />
            </Pressable>
          </View>

          {result ? (
            <View>
              <Text style={styles.desc}>
                {result.status === 'fulfilled'
                  ? 'Save this code now — it is shown once.'
                  : 'Merchandise is pending hub fulfilment. No voucher code yet.'}
              </Text>
              {result.voucherCode ? (
                <Pressable onPress={() => void shareCode()} style={styles.codeBox}>
                  <Text style={styles.codeLabel}>Voucher code · tap to share</Text>
                  <Text style={styles.code}>{result.voucherCode}</Text>
                </Pressable>
              ) : (
                <View style={styles.codeBox}>
                  <Text style={styles.codeLabel}>Status</Text>
                  <Text style={styles.code}>{result.status}</Text>
                </View>
              )}
              <Text style={styles.meta}>
                Spent {result.pointsSpent} pts
                {result.pointsBalanceAfter != null
                  ? ` · ${result.pointsBalanceAfter} left`
                  : ''}
                {result.valueInr
                  ? ` · ${formatCurrency(result.valueInr)} value`
                  : ''}
              </Text>
              <Pressable onPress={onClose} style={styles.cta}>
                <Text style={styles.ctaText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View>
              <Text style={styles.kind}>{rewardKindLabel(item?.kind)}</Text>
              {item?.description ? (
                <Text style={styles.desc}>{item.description}</Text>
              ) : null}
              {item?.terms ? <Text style={styles.terms}>{item.terms}</Text> : null}
              <View style={styles.costRow}>
                <Text style={styles.cost}>{item?.pointsCost ?? 0} pts</Text>
                <Text style={styles.balance}>{points} available</Text>
              </View>
              {item?.valueInr ? (
                <Text style={styles.meta}>{formatCurrency(item.valueInr)} value</Text>
              ) : null}
              {error ? <Text style={styles.warn}>{error}</Text> : null}
              {!item?.inStock ? (
                <Text style={styles.warn}>Out of stock</Text>
              ) : null}
              <Pressable
                onPress={() => void onRedeem()}
                disabled={!canRedeem || redeem.isPending}
                style={[styles.cta, (!canRedeem || redeem.isPending) && styles.ctaOff]}
              >
                {redeem.isPending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.ctaText}>
                    {canRedeem ? 'Confirm redeem' : 'Not enough points'}
                  </Text>
                )}
              </Pressable>
            </View>
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
  kind: {
    alignSelf: 'flex-start',
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#9A3412',
    backgroundColor: '#FFEDD5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 10,
  },
  desc: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 20,
    marginBottom: 10,
  },
  terms: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 12,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cost: {
    fontFamily: fonts.extraBold,
    fontSize: 28,
    color: '#111827',
  },
  balance: {
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: '#6B7280',
  },
  meta: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 8,
  },
  warn: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#B45309',
    marginBottom: 8,
  },
  codeBox: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  codeLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#9CA3AF',
    marginBottom: 6,
  },
  code: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  cta: {
    marginTop: 12,
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
});
