import { X } from 'lucide-react-native';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KitchenTicketCard } from '@/components/support/KitchenTicketCard';
import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useKitchenTicket,
  useReopenKitchenTicket,
} from '@/lib/restaurant/support-hooks';

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
  const reopen = useReopenKitchenTicket(restaurantId);
  const [reason, setReason] = useState('');

  const closed =
    detail.data?.stage === 'closed' ||
    detail.data?.status === 'closed' ||
    detail.data?.status === 'resolved';

  const onReopen = () => {
    if (!ticketId) return;
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      Alert.alert('Reason needed', 'Tell us why you are reopening (min 5 characters).');
      return;
    }
    reopen.mutate(
      { ticketId, reason: trimmed },
      {
        onSuccess: () => setReason(''),
        onError: (e) =>
          Alert.alert('Could not reopen', getApiErrorMessage(e, 'Try again.')),
      }
    );
  };

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
              {closed ? (
                <View style={styles.reopen}>
                  <Text style={styles.reopenTitle}>Still need help on this issue?</Text>
                  <TextInput
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Why are you reopening?"
                    placeholderTextColor={authTheme.textDim}
                    style={styles.input}
                    multiline
                  />
                  <Pressable
                    style={[styles.reopenBtn, reopen.isPending && styles.disabled]}
                    onPress={onReopen}
                    disabled={reopen.isPending}
                  >
                    <Text style={styles.reopenText}>
                      {reopen.isPending ? 'Reopening…' : 'Reopen same ticket'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
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
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
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
  reopen: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.1)',
    padding: 12,
    gap: 8,
    backgroundColor: '#FFF7F7',
  },
  reopenTitle: { color: authTheme.text, fontFamily: fonts.bold, fontSize: 14 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.12)',
    borderRadius: 10,
    padding: 10,
    minHeight: 64,
    textAlignVertical: 'top',
    color: authTheme.text,
    fontFamily: fonts.medium,
  },
  reopenBtn: {
    backgroundColor: authTheme.brand,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  reopenText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 14 },
  disabled: { opacity: 0.5 },
});
