import { CheckCircle2, Send, X } from 'lucide-react-native';
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

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useAddSupportTicketMessage,
  useCloseSupportTicket,
  usePartnerSupportTicket,
} from '@/lib/delivery-partner/support-hooks';
import type {
  SupportTicketMessage,
  SupportTicketStatus,
} from '@/lib/delivery-partner/support-types';

function statusMeta(status: SupportTicketStatus) {
  const s = String(status).toLowerCase();
  if (s === 'resolved' || s === 'closed') {
    return { label: s === 'closed' ? 'Closed' : 'Resolved', color: '#15803D' };
  }
  if (s === 'in_progress' || s === 'waiting_partner') {
    return { label: 'In progress', color: authTheme.brand };
  }
  return { label: 'Open', color: authTheme.brand };
}

function formatWhen(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function MessageRow({ message }: { message: SupportTicketMessage }) {
  const role = String(message.senderRole).toLowerCase();
  const who =
    message.authorName ||
    (role === 'partner' ? 'You' : role === 'agent' ? 'Support' : 'System');
  return (
    <View style={styles.msg}>
      <Text style={styles.msgMeta}>
        {who} · {formatWhen(message.createdAt)}
      </Text>
      <Text style={styles.msgText}>{message.text}</Text>
    </View>
  );
}

export function PartnerTicketDetailSheet({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const detail = usePartnerSupportTicket(ticketId);
  const addMessage = useAddSupportTicketMessage(ticketId);
  const closeTicket = useCloseSupportTicket();
  const [text, setText] = useState('');

  const ticket = detail.data;
  const meta = statusMeta(ticket?.status ?? 'open');
  const closed =
    String(ticket?.status).toLowerCase() === 'closed' ||
    String(ticket?.status).toLowerCase() === 'resolved';

  const send = async () => {
    if (!text.trim()) return;
    try {
      await addMessage.mutateAsync({ text: text.trim() });
      setText('');
    } catch (err) {
      Alert.alert('Could not send', getApiErrorMessage(err, 'Try again.'));
    }
  };

  const onCloseTicket = () => {
    if (!ticketId) return;
    Alert.alert('Close ticket?', 'You can still view history after closing.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: () => {
          void closeTicket.mutateAsync(ticketId).catch((err) => {
            Alert.alert('Could not close', getApiErrorMessage(err, 'Try again.'));
          });
        },
      },
    ]);
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
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>{ticket?.ticketNo || ticket?.id || 'Ticket'}</Text>
              <Text style={styles.title} numberOfLines={2}>
                {ticket?.subject || 'Support ticket'}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <X color={authTheme.text} size={18} />
            </Pressable>
          </View>

          {detail.isLoading && !ticket ? (
            <View style={styles.center}>
              <ActivityIndicator color={authTheme.brand} />
            </View>
          ) : detail.isError && !ticket ? (
            <View style={styles.center}>
              <Text style={styles.muted}>
                {getApiErrorMessage(detail.error, 'Could not load ticket.')}
              </Text>
              <Pressable style={styles.retry} onPress={() => void detail.refetch()}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : ticket ? (
            <>
              <View style={styles.statusRow}>
                <View style={[styles.badge, { backgroundColor: `${meta.color}18` }]}>
                  {closed ? <CheckCircle2 color={meta.color} size={12} /> : null}
                  <Text style={{ color: meta.color, fontFamily: fonts.semiBold, fontSize: 11 }}>
                    {meta.label}
                  </Text>
                </View>
                {!closed ? (
                  <Pressable onPress={onCloseTicket} disabled={closeTicket.isPending}>
                    <Text style={styles.closeLink}>Close ticket</Text>
                  </Pressable>
                ) : null}
              </View>

              <ScrollView contentContainerStyle={styles.timeline} showsVerticalScrollIndicator={false}>
                <View style={styles.msg}>
                  <Text style={styles.msgMeta}>Opened · {formatWhen(ticket.createdAt)}</Text>
                  <Text style={styles.msgText}>{ticket.description}</Text>
                </View>
                {ticket.messages.map((m) => (
                  <MessageRow key={m.messageId} message={m} />
                ))}
                {ticket.resolution ? (
                  <View style={styles.msg}>
                    <Text style={styles.msgMeta}>Resolution</Text>
                    <Text style={styles.msgText}>{ticket.resolution}</Text>
                  </View>
                ) : null}
              </ScrollView>

              {!closed ? (
                <View style={styles.composer}>
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    placeholder="Reply to support…"
                    placeholderTextColor={authTheme.textDim}
                    style={styles.input}
                    multiline
                  />
                  <Pressable
                    onPress={() => void send()}
                    disabled={addMessage.isPending || !text.trim()}
                    style={[styles.sendBtn, (!text.trim() || addMessage.isPending) && styles.sendDisabled]}
                  >
                    {addMessage.isPending ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <Send color="#FFFFFF" size={16} />
                    )}
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  sheet: {
    backgroundColor: authTheme.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    minHeight: '55%',
    paddingTop: 12,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  kicker: { fontFamily: fonts.semiBold, fontSize: 11, color: authTheme.brand },
  title: { fontFamily: fonts.bold, fontSize: 17, color: authTheme.text, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: authTheme.bgSoft,
  },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, marginBottom: 8,
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
  },
  closeLink: { fontFamily: fonts.semiBold, fontSize: 12, color: authTheme.brand },
  timeline: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  msg: { backgroundColor: authTheme.bgSoft, borderRadius: 12, padding: 12, gap: 4 },
  msgMeta: { fontFamily: fonts.medium, fontSize: 11, color: authTheme.textDim },
  msgText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: authTheme.text },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: authTheme.cardBorder,
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 100, borderRadius: 12, borderWidth: 1,
    borderColor: authTheme.inputBorder, backgroundColor: authTheme.bgSoft,
    paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.regular, fontSize: 14, color: authTheme.text,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: authTheme.brand,
    alignItems: 'center', justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.45 },
  center: { padding: 32, alignItems: 'center', gap: 10 },
  muted: { fontFamily: fonts.regular, fontSize: 13, color: authTheme.textMuted, textAlign: 'center' },
  retry: { backgroundColor: authTheme.brand, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  retryText: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 13 },
});
