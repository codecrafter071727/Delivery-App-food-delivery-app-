import { X } from 'lucide-react-native';
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

import { KitchenTicketCard } from '@/components/support/KitchenTicketCard';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { useKitchenTicket } from '@/lib/restaurant/support-hooks';

export function KitchenTicketDetailSheet({
  restaurantId,
  ticketId,
  onClose,
}: {
  restaurantId: string;
  ticketId: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const detail = useKitchenTicket(restaurantId, ticketId);

  return (
    <Modal
      visible={Boolean(ticketId)}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, 12) + 8 },
          ]}
        >
          <View style={styles.head}>
            <Text style={styles.title}>Ticket timeline</Text>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <X color={authTheme.text} size={18} />
            </Pressable>
          </View>

          {detail.isLoading && !detail.data ? (
            <View style={styles.center}>
              <ActivityIndicator color={authTheme.brand} />
            </View>
          ) : detail.isError && !detail.data ? (
            <View style={styles.center}>
              <Text style={styles.muted}>
                {detail.error instanceof Error
                  ? detail.error.message
                  : 'Could not load ticket'}
              </Text>
              <Pressable
                style={styles.retry}
                onPress={() => void detail.refetch()}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : detail.data ? (
            <ScrollView
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
            >
              <KitchenTicketCard ticket={detail.data} expanded />
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    minHeight: '50%',
    paddingTop: 12,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  title: { color: authTheme.text, fontSize: 17, fontFamily: fonts.bold },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.surface,
  },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
  center: { padding: 32, alignItems: 'center', gap: 10 },
  muted: {
    color: authTheme.textMuted,
    fontSize: 13,
    fontFamily: fonts.medium,
    textAlign: 'center',
  },
  retry: {
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13 },
});
