import { MessageCircle, Send } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { sendKitchenTyping } from '@/lib/gateway/kitchen-client';
import { useKitchenOrderChat } from '@/lib/gateway/kitchen-socket';

type Props = {
  orderId: string;
  fulfillmentTone?: 'table' | 'delivery' | 'pickup';
  hasPartner?: boolean;
};

export function KitchenOrderChat({
  orderId,
  fulfillmentTone,
  hasPartner,
}: Props) {
  const chat = useKitchenOrderChat(orderId, true);
  const [draft, setDraft] = useState('');
  const [to, setTo] = useState<'customer' | 'partner'>('customer');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    return () => sendKitchenTyping(orderId, false);
  }, [orderId]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    chat.setTyping(false);
    try {
      await chat.send(text, to);
      setDraft('');
    } catch (error) {
      Alert.alert(
        'Could not send',
        error instanceof Error ? error.message : 'Please try again.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <MessageCircle color={authTheme.brand} size={16} />
        <Text style={styles.cardTitle}>Trip chat</Text>
      </View>
      {fulfillmentTone && fulfillmentTone !== 'delivery' ? (
        <Text style={styles.hint}>
          Chat is for delivery trips. Pickup and dine-in tickets stay on the
          kitchen board.
        </Text>
      ) : null}

      {hasPartner ? (
        <View style={styles.toRow}>
          {(['customer', 'partner'] as const).map((target) => (
            <Pressable
              key={target}
              onPress={() => setTo(target)}
              style={[styles.toChip, to === target && styles.toChipOn]}
            >
              <Text style={[styles.toChipText, to === target && styles.toChipTextOn]}>
                {target === 'customer' ? 'Customer' : 'Rider'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Text style={styles.hint}>
          Messages go to the customer. Rider chat opens after assignment.
        </Text>
      )}

      {chat.messages.length === 0 ? (
        <Text style={styles.muted}>No messages yet.</Text>
      ) : (
        chat.messages.map((row) => {
          const mine = row.fromRole === 'restaurant';
          return (
            <View
              key={row.id}
              style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
            >
              <Text style={[styles.bubbleMeta, mine && styles.bubbleMetaMine]}>
                {mine ? 'Kitchen' : row.fromRole === 'partner' ? 'Rider' : 'Customer'}
              </Text>
              <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                {row.text}
              </Text>
            </View>
          );
        })
      )}
      {chat.peerTyping ? (
        <Text style={styles.typing}>Someone is typing…</Text>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            chat.setTyping(value.trim().length > 0);
          }}
          placeholder={
            to === 'partner' ? 'Message the rider…' : 'Message the customer…'
          }
          placeholderTextColor={authTheme.textDim}
          style={styles.input}
          maxLength={500}
          editable={!sending}
          onSubmitEditing={() => void send()}
        />
        <Pressable
          onPress={() => void send()}
          disabled={sending || !draft.trim()}
          style={[styles.sendBtn, (!draft.trim() || sending) && styles.sendBtnOff]}
        >
          {sending ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <Send color="#FFFFFF" size={16} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: authTheme.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 10,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 15,
    color: authTheme.text,
  },
  hint: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  muted: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.textDim,
  },
  toRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: authTheme.surface,
  },
  toChipOn: {
    backgroundColor: authTheme.brandSoft,
  },
  toChipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  toChipTextOn: {
    color: authTheme.brand,
    fontFamily: fonts.semiBold,
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: authTheme.brand,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: authTheme.surface,
  },
  bubbleMeta: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: authTheme.textDim,
    marginBottom: 2,
  },
  bubbleMetaMine: {
    color: 'rgba(255,255,255,0.8)',
  },
  bubbleText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
    lineHeight: 20,
  },
  bubbleTextMine: {
    color: '#FFFFFF',
  },
  typing: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.brand,
    fontStyle: 'italic',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
    backgroundColor: authTheme.input,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: {
    opacity: 0.45,
  },
});
