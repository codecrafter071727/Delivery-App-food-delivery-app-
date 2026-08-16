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
  subscribeRiderChat,
  type RiderChatMessage,
} from '@/lib/delivery-partner/chat-store';
import { emitRiderEvent, isRiderSocketConnected } from '@/lib/delivery-partner/rider-gateway';
import { getApiErrorMessage } from '@/lib/errors';

type Props = {
  visible: boolean;
  deliveryId: string;
  orderId?: string;
  onClose: () => void;
};

/**
 * In-trip chat with customer / restaurant. Socket `chat:new-message` + `typing`.
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
  }, [visible, deliveryId]);

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

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    emitTyping(false);
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
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not send. Check your connection.'));
    } finally {
      setSending(false);
    }
  };

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
            {messages.length === 0 ? (
              <Text style={styles.empty}>
                Messages stay on this trip. Customer and kitchen see them live.
              </Text>
            ) : (
              messages.map((row) => {
                const mine = row.fromRole === 'partner';
                return (
                  <View
                    key={row.id}
                    style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
                  >
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
          <View style={styles.composer}>
            <TextInput
              value={text}
              onChangeText={(value) => {
                setText(value);
                emitTyping(value.trim().length > 0);
              }}
              onBlur={() => emitTyping(false)}
              placeholder={`Message ${to}…`}
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              editable={!sending}
            />
            <Pressable
              onPress={() => void send()}
              disabled={sending || !text.trim()}
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
  bubbleText: { fontFamily: fonts.medium, fontSize: 14, color: '#111827' },
  bubbleTextMine: { color: '#FFFFFF' },
  typing: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280' },
  error: { fontFamily: fonts.medium, fontSize: 12, color: '#EF4444', marginBottom: 6 },
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
