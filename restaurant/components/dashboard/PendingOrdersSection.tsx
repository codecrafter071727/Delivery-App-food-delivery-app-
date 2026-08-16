import { ChevronRight, ClipboardList, Clock3, Package } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import {
  formatCurrency,
  formatOrderTime,
  summarizeItems,
} from '@/lib/dashboard/format';
import { displayStatus, statusTone } from '@/lib/order/ui';
import type { OwnerOrder } from '@/lib/dashboard/types';

type Props = {
  orders: OwnerOrder[];
  onQueuePress?: () => void;
  onOrderPress?: (order: OwnerOrder) => void;
};

function shortOrderId(order: OwnerOrder) {
  const raw = (order.orderNumber || order.id || '').trim();
  if (!raw) return '—';
  const parts = raw.split('-').filter(Boolean);
  const tail = parts[parts.length - 1] || raw;
  return tail.length > 10 ? tail.slice(-8).toUpperCase() : tail.toUpperCase();
}

export function PendingOrdersSection({
  orders,
  onQueuePress,
  onOrderPress,
}: Props) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionRow}>
        <View>
          <Text style={styles.kicker}>Kitchen queue</Text>
          <Text style={styles.sectionTitle}>New orders</Text>
        </View>
        <Pressable onPress={onQueuePress} hitSlop={8} style={styles.seeAll}>
          <Text style={styles.link}>
            {orders.length > 0 ? `See all (${orders.length})` : 'See all'}
          </Text>
          <ChevronRight color={authTheme.brand} size={16} />
        </Pressable>
      </View>

      <View style={styles.card}>
        {orders.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <ClipboardList color={authTheme.textDim} size={22} />
            </View>
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.emptyText}>
              New orders will land here the moment customers place them.
            </Text>
          </View>
        ) : (
          orders.map((order, index) => {
            const tone = statusTone(order.status);
            const hasTotal =
              order.total != null && Number.isFinite(order.total);

            return (
              <Pressable
                key={order.id}
                onPress={() => onOrderPress?.(order)}
                style={index < orders.length - 1 ? styles.listBorder : undefined}
              >
                <View style={styles.listRow}>
                  <View style={styles.listIconBox}>
                    <Package
                      color={authTheme.brand}
                      size={18}
                      strokeWidth={1.8}
                    />
                  </View>

                  <View style={styles.listMidCol}>
                    <Text style={styles.listIdText}>#{shortOrderId(order)}</Text>
                    <Text style={styles.listCustomerText} numberOfLines={1}>
                      {order.customerName
                        ? order.customerName
                        : summarizeItems(order.items)}
                    </Text>
                    <View style={styles.timeRow}>
                      <Clock3 color={authTheme.textDim} size={11} />
                      <Text style={styles.listTimeText}>
                        {formatOrderTime(order.createdAt)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.listRightCol}>
                    <Text style={styles.listAmount}>
                      {hasTotal ? formatCurrency(order.total as number) : '—'}
                    </Text>
                    <View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor: tone.backgroundColor,
                          borderColor: tone.border,
                        },
                      ]}
                    >
                      <Text style={[styles.listStatusText, { color: tone.color }]}>
                        {displayStatus(order.status)}
                      </Text>
                    </View>
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  kicker: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontFamily: fonts.extraBold,
    fontSize: 18,
    color: authTheme.text,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: authTheme.brand,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    paddingHorizontal: 12,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    gap: 6,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: authTheme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  emptyText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    textAlign: 'center',
    lineHeight: 17,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    width: '100%',
  },
  listBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  listIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listMidCol: {
    flex: 1,
    minWidth: 0,
  },
  listIdText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  listCustomerText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    marginTop: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  listTimeText: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textDim,
  },
  listRightCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  listAmount: {
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  listStatusText: {
    fontFamily: fonts.bold,
    fontSize: 10,
  },
});
