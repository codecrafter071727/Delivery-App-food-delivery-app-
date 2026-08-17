import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts } from '@/constants/typography';
import {
  appendRiderChat,
  getRiderChat,
  isRiderPeerTyping,
  mapRiderChatMessage,
  setRiderChatThread,
  subscribeRiderChat,
  type RiderChatMessage,
} from '@/lib/delivery-partner/chat-store';
import {
  useSendTripChat,
  useTripChat,
} from '@/lib/delivery-partner/hooks';
import { emitRiderEvent, isRiderSocketConnected } from '@/lib/delivery-partner/rider-gateway';
import { formatTripError } from '@/lib/delivery-partner/rider-ack';

const QUICK_REPLIES: Record<'customer' | 'restaurant', string[]> = {
  customer: ['I am at the gate', 'Please share the OTP', 'Coming in 2 mins'],
  restaurant: ["I've arrived for pickup", 'Is the order ready?', 'On my way'],
};

type Props = {
  visible: boolean;
  deliveryId: string;
  orderId?: string;
  onClose: () => void;
};

/**
 * In-trip chat: GET/POST /partners/me/deliveries/:id/chat + live socket.
 */
export function TripChatSheet({ visible, deliveryId, orderId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const [to, setTo] = useState<'customer' | 'restaurant'>('customer');
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<RiderChatMessage[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typingOnRef = useRef(false);
  const thread = useTripChat(deliveryId, visible && Boolean(deliveryId));
  const sendChat = useSendTripChat();
  const closed = Boolean(thread.data?.closed);

  useEffect(() => {
    if (!visible) return;
    const rows = (thread.data?.messages ?? []).map((row) => ({
      id: row.id,
      deliveryId: row.deliveryId,
      orderId: row.orderId,
      text: row.text,
      fromRole: row.senderRole,
      to: row.to,
      createdAt: row.createdAt,
    }));
    if (thread.data) setRiderChatThread(deliveryId, rows);
  }, [visible, deliveryId, thread.data]);

  useEffect(() => {
    if (!visible) return;
    const sync = () => {
      setMessages(getRiderChat(deliveryId));
      setPeerTyping(isRiderPeerTyping(deliveryId));
    };
    sync();
    return subscribeRiderChat((id) => {
      if (id === deliveryId) sync();
    });
  }, [visible, deliveryId, thread.dataUpdatedAt]);

  const emitTyping = (isTyping: boolean) => {
    if (!isRiderSocketConnected()) return;
    if (typingOnRef.current === isTyping) return;
    typingOnRef.current = isTyping;
    void emitRiderEvent('typing', {
      deliveryId,
      orderId,
      to,
      isTyping,
    }).catch(() => undefined);
  };

  const send = async (preset?: string) => {
    const trimmed = (preset ?? text).trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    emitTyping(false);
    try {
      let mapped = mapRiderChatMessage(
        await sendChat.mutateAsync({
          deliveryId,
          to,
          text: trimmed,
        })
      );
      if (!mapped) {
        mapped = {
          id: `${deliveryId}-${Date.now()}`,
          deliveryId,
          orderId,
          text: trimmed,
          fromRole: 'partner',
          to,
          createdAt: new Date().toISOString(),
        };
      }
      appendRiderChat(mapped);
      setText('');
    } catch (err) {
      if (isRiderSocketConnected()) {
        try {
          const ack = await emitRiderEvent('chat:new-message', {
            deliveryId,
            orderId,
            to,
            text: trimmed,
          });
          const mapped =
            mapRiderChatMessage({
              ...(typeof ack === 'object' && ack ? ack : {}),
              deliveryId,
              orderId,
              text: trimmed,
              senderRole: 'partner',
              to,
            }) ?? {
              id: `${deliveryId}-${Date.now()}`,
              deliveryId,
              orderId,
              text: trimmed,
              fromRole: 'partner',
              to,
              createdAt: new Date().toISOString(),
            };
          appendRiderChat(mapped);
          setText('');
          return;
        } catch {
          // fall through to REST error copy
        }
      }
      setError(formatTripError(err, 'Could not send. Check your connection.'));
    } finally {
      setSending(false);
    }
  };

  const visibleMessages = messages.filter(
    (row) => !row.to || row.to === to || row.to === 'all' || row.fromRole === 'system'
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.dim} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Trip chat</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <View style={styles.tabs}>
            {(['customer', 'restaurant'] as const).map((role) => (
              <Pressable
                key={role}
                onPress={() => setTo(role)}
                style={[styles.tab, to === role && styles.tabOn]}
              >
                <Text style={[styles.tabText, to === role && styles.tabTextOn]}>
                  {role === 'customer' ? 'Customer' : 'Restaurant'}
                </Text>
              </Pressable>
            ))}
          </View>
          <ScrollView style={styles.thread} contentContainerStyle={styles.threadInner}>
            {thread.isLoading && !visibleMessages.length ? (
              <View style={styles.center}>
                <ActivityIndicator color="#EA4B14" />
                <Text style={styles.empty}>Loading chat…</Text>
              </View>
            ) : thread.isError && !visibleMessages.length ? (
              <Pressable onPress={() => void thread.refetch()}>
                <Text style={styles.error}>
                  {formatTripError(thread.error, 'Could not load chat. Tap to retry.')}
                </Text>
              </Pressable>
            ) : visibleMessages.length === 0 ? (
              <Text style={styles.empty}>
                {closed
                  ? 'Chat is closed for this trip.'
                  : 'Messages stay on this trip. Customer and kitchen see them live.'}
              </Text>
            ) : (
              visibleMessages.map((row) => {
                const mine = row.fromRole === 'partner';
                const system = row.fromRole === 'system';
                return (
                  <View
                    key={row.id}
                    style={[
                      styles.bubble,
                      mine ? styles.bubbleMine : styles.bubbleTheirs,
                      system && styles.bubbleSystem,
                    ]}
                  >
                    {!mine ? (
                      <Text style={styles.bubbleMeta}>
                        {system ? 'Update' : row.fromRole === 'restaurant' ? 'Kitchen' : 'Customer'}
                      </Text>
                    ) : null}
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                      {row.text}
                    </Text>
                  </View>
                );
              })
            )}
            {peerTyping ? <Text style={styles.typing}>Typing…</Text> : null}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!closed ? (
            <View style={styles.quickRow}>
              {QUICK_REPLIES[to].map((line) => (
                <Pressable
                  key={line}
                  onPress={() => void send(line)}
                  disabled={sending}
                  style={styles.quick}
                >
                  <Text style={styles.quickText}>{line}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={(value) => {
                setText(value);
                emitTyping(value.trim().length > 0);
              }}
              onBlur={() => emitTyping(false)}
              placeholder={closed ? 'Chat closed' : `Message ${to}…`}
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              editable={!sending && !closed}
              maxLength={500}
            />
            <Pressable
              onPress={() => void send()}
              disabled={sending || closed || !text.trim()}
              style={styles.send}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.sendText}>Send</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  dim: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    maxHeight: '78%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: { fontFamily: fonts.extraBold, fontSize: 18, color: '#111827' },
  close: { fontFamily: fonts.semiBold, fontSize: 14, color: '#EA4B14' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
  },
  tabOn: { backgroundColor: '#111827' },
  tabText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#4B5563' },
  tabTextOn: { color: '#FFFFFF' },
  thread: { minHeight: 180, maxHeight: 280 },
  threadInner: { paddingVertical: 8, gap: 8 },
  empty: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    paddingVertical: 24,
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: '#EA4B14' },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: '#F3F4F6' },
  bubbleSystem: { alignSelf: 'center', backgroundColor: '#EEF2FF' },
  bubbleMeta: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    color: '#6B7280',
    marginBottom: 2,
  },
  bubbleText: { fontFamily: fonts.medium, fontSize: 14, color: '#111827' },
  bubbleTextMine: { color: '#FFFFFF' },
  typing: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280' },
  error: { fontFamily: fonts.medium, fontSize: 12, color: '#EF4444', marginBottom: 6 },
  center: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  quick: {
    borderRadius: 999,
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickText: { fontFamily: fonts.semiBold, fontSize: 11, color: '#C2410C' },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#111827',
  },
  send: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#EA4B14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontFamily: fonts.bold, fontSize: 14, color: '#FFFFFF' },
});
