import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { formatFinanceError } from '@/lib/delivery-partner/finance-api';
import { useFinanceMutations } from '@/lib/delivery-partner/finance-hooks';
import type { CodUpiQr } from '@/lib/delivery-partner/finance-types';

type Props = {
  visible: boolean;
  deliveryId: string | null;
  onClose: () => void;
};

function parseUpi(intent?: string) {
  if (!intent) return {};
  const query = intent.split('?')[1] ?? '';
  const params = new URLSearchParams(query);
  return {
    pa: params.get('pa') ?? undefined,
    pn: params.get('pn') ?? undefined,
    am: params.get('am') ?? undefined,
  };
}

function qrImageForIntent(intent?: string, qrImageUrl?: string | null) {
  if (qrImageUrl) return qrImageUrl;
  if (!intent) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(intent)}`;
}

export function CodUpiSheet({ visible, deliveryId, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { createUpiQr, markUpi } = useFinanceMutations();
  const [qr, setQr] = useState<CodUpiQr | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [txnRef, setTxnRef] = useState('');
  const [note, setNote] = useState('');
  const [markError, setMarkError] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    if (!visible || !deliveryId) {
      setQr(null);
      setLoadError(null);
      setTxnRef('');
      setNote('');
      setMarkError(null);
      setMarked(false);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    createUpiQr
      .mutateAsync(deliveryId)
      .then((data) => {
        if (!cancelled) setQr(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(formatFinanceError(err, 'Could not create UPI QR.'));
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generate once per open
  }, [visible, deliveryId]);

  const parsed = useMemo(() => parseUpi(qr?.upiIntent), [qr?.upiIntent]);
  const imageUrl = qrImageForIntent(qr?.upiIntent, qr?.qrImageUrl);

  const onOpenUpi = async () => {
    if (!qr?.upiIntent) return;
    const can = await Linking.canOpenURL(qr.upiIntent);
    if (!can) {
      Alert.alert('No UPI app', 'Ask the customer to scan the QR, or copy the VPA.');
      return;
    }
    await Linking.openURL(qr.upiIntent);
  };

  const onCopy = async () => {
    const text = qr?.upiIntent || parsed.pa || '';
    if (!text) return;
    await Share.share({ message: text, title: 'Platform UPI' });
  };

  const onMark = async () => {
    if (!deliveryId) return;
    const ref = txnRef.trim();
    if (ref.length < 4) {
      setMarkError('Enter the UPI UTR / txn id from the customer.');
      return;
    }
    setMarkError(null);
    try {
      await markUpi.mutateAsync({
        deliveryId,
        txnRef: ref,
        note: note.trim() || undefined,
      });
      setMarked(true);
    } catch (err) {
      setMarkError(formatFinanceError(err, 'Could not mark UPI paid.'));
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.kicker}>Doorstep collection</Text>
              <Text style={styles.title}>Collect via UPI</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
              <X color="#6B7280" size={20} />
            </Pressable>
          </View>

          {createUpiQr.isPending && !qr ? (
            <ActivityIndicator color="#EA4B14" />
          ) : loadError ? (
            <View style={styles.block}>
              <Text style={styles.error}>{loadError}</Text>
              <Pressable
                onPress={() => {
                  if (!deliveryId) return;
                  setLoadError(null);
                  createUpiQr
                    .mutateAsync(deliveryId)
                    .then(setQr)
                    .catch((err) =>
                      setLoadError(formatFinanceError(err, 'Could not create UPI QR.'))
                    );
                }}
                style={styles.primary}
              >
                <Text style={styles.primaryText}>Retry QR</Text>
              </Pressable>
            </View>
          ) : marked ? (
            <View style={styles.block}>
              <Text style={styles.ok}>Marked paid via UPI</Text>
              <Text style={styles.meta}>
                This does not add cash in hand. You can deliver without collecting notes.
              </Text>
              <Pressable onPress={onClose} style={styles.primary}>
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.block}>
              <Text style={styles.amount}>
                {formatCurrency(qr?.amount ?? Number(parsed.am) ?? 0, qr?.currency)}
              </Text>
              <Text style={styles.hint}>
                Pay to platform VPA{parsed.pa ? ` ${parsed.pa}` : ''} — never your personal UPI.
              </Text>
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.qr} />
              ) : null}
              <View style={styles.row}>
                <Pressable onPress={() => void onOpenUpi()} style={styles.secondary}>
                  <Text style={styles.secondaryText}>Open UPI app</Text>
                </Pressable>
                <Pressable onPress={() => void onCopy()} style={styles.secondary}>
                  <Text style={styles.secondaryText}>Share</Text>
                </Pressable>
              </View>
              {qr?.expiresAt ? (
                <Text style={styles.meta}>
                  QR valid until {new Date(qr.expiresAt).toLocaleTimeString()}
                </Text>
              ) : null}
              <TextInput
                value={txnRef}
                onChangeText={setTxnRef}
                placeholder="Customer UTR / txn id"
                autoCapitalize="characters"
                style={styles.input}
              />
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Note (optional)"
                style={styles.input}
              />
              {markError ? <Text style={styles.error}>{markError}</Text> : null}
              <Pressable
                onPress={() => void onMark()}
                disabled={markUpi.isPending}
                style={[styles.primary, markUpi.isPending && styles.disabled]}
              >
                {markUpi.isPending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryText}>Customer paid UPI</Text>
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
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  kicker: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    textTransform: 'uppercase',
  },
  title: { fontFamily: fonts.extraBold, fontSize: 20, color: '#111827' },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  block: { gap: 10, alignItems: 'center' },
  amount: { fontFamily: fonts.extraBold, fontSize: 26, color: '#111827' },
  hint: {
    fontFamily: fonts.medium,
    fontSize: 13,
    color: '#B45309',
    textAlign: 'center',
    lineHeight: 18,
  },
  qr: { width: 220, height: 220, borderRadius: 12, backgroundColor: '#F9FAFB' },
  row: { flexDirection: 'row', gap: 8, width: '100%' },
  secondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontFamily: fonts.bold, fontSize: 14, color: '#111827' },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 46,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  meta: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280' },
  error: { fontFamily: fonts.semiBold, fontSize: 13, color: '#B91C1C', textAlign: 'center' },
  ok: { fontFamily: fonts.bold, fontSize: 16, color: '#15803D' },
  primary: {
    width: '100%',
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.extraBold, fontSize: 15, color: '#FFFFFF' },
  disabled: { opacity: 0.5 },
});
