import { Camera, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
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

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import type {
  KitchenTicketCategory,
  KitchenTicketPriority,
} from '@/lib/restaurant/support-types';

const CATEGORIES: { key: KitchenTicketCategory; label: string }[] = [
  { key: 'orders', label: 'Orders' },
  { key: 'payout', label: 'Payouts' },
  { key: 'menu', label: 'Menu' },
  { key: 'kyc', label: 'KYC' },
  { key: 'app', label: 'App' },
  { key: 'other', label: 'Other' },
];

const PRIORITIES: { key: KitchenTicketPriority; label: string }[] = [
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'urgent', label: 'Urgent' },
];

export function KitchenTicketComposer({
  visible,
  pending,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    category: KitchenTicketCategory;
    priority: KitchenTicketPriority;
    subject: string;
    description: string;
    screenshotUris?: string[];
  }) => void;
}) {
  const [category, setCategory] = useState<KitchenTicketCategory>('orders');
  const [priority, setPriority] = useState<KitchenTicketPriority>('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [shots, setShots] = useState<string[]>([]);

  const reset = () => {
    setSubject('');
    setDescription('');
    setCategory('orders');
    setPriority('medium');
    setShots([]);
    onClose();
  };

  const pickShot = async () => {
    if (shots.length >= 5) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setShots((prev) => [...prev, result.assets[0].uri!].slice(0, 5));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={reset}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalBackdrop}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New ticket</Text>
            <Pressable onPress={reset}>
              <X color={authTheme.textMuted} size={20} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Topic</Text>
            <View style={styles.wrapChips}>
              {CATEGORIES.map((item) => {
                const on = item.key === category;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setCategory(item.key)}
                    style={[styles.choice, on && styles.choiceOn]}
                  >
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.label}>Priority</Text>
            <View style={styles.wrapChips}>
              {PRIORITIES.map((item) => {
                const on = item.key === priority;
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => setPriority(item.key)}
                    style={[styles.choice, on && styles.choiceOn]}
                  >
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.label}>Subject</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              placeholder="Short summary (min 5 characters)"
              placeholderTextColor={authTheme.textDim}
              maxLength={200}
              style={styles.input}
            />
            <Text style={styles.label}>Details</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What happened? Include order or payout ids if you have them."
              placeholderTextColor={authTheme.textDim}
              multiline
              maxLength={2000}
              style={[styles.input, styles.area]}
            />
            <Text style={styles.label}>Screenshot (optional)</Text>
            <View style={styles.shotRow}>
              {shots.map((uri) => (
                <View key={uri} style={styles.shotWrap}>
                  <Image source={{ uri }} style={styles.shot} />
                  <Pressable
                    style={styles.shotX}
                    onPress={() => setShots((prev) => prev.filter((u) => u !== uri))}
                  >
                    <X color="#FFFFFF" size={12} />
                  </Pressable>
                </View>
              ))}
              {shots.length < 5 ? (
                <Pressable style={styles.addShot} onPress={() => void pickShot()}>
                  <Camera color={authTheme.brand} size={18} />
                  <Text style={styles.addShotText}>Add</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
          <Pressable
            style={[styles.sendBtn, pending && styles.disabled]}
            onPress={() =>
              onSubmit({
                category,
                priority,
                subject,
                description,
                screenshotUris: shots,
              })
            }
            disabled={pending}
          >
            {pending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.sendText}>Submit ticket</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    gap: 12,
    maxHeight: '88%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { color: authTheme.text, fontSize: 18, fontFamily: fonts.bold },
  label: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.bold,
    marginBottom: 6,
    marginTop: 10,
  },
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: authTheme.surface,
  },
  choiceOn: { backgroundColor: authTheme.brand },
  choiceText: { color: authTheme.textMuted, fontSize: 13, fontFamily: fonts.semiBold },
  choiceTextOn: { color: '#FFFFFF' },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: authTheme.text,
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  area: { minHeight: 110, textAlignVertical: 'top' },
  shotRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shotWrap: { position: 'relative' },
  shot: { width: 64, height: 64, borderRadius: 10 },
  shotX: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    padding: 2,
  },
  addShot: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(122, 14, 34, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  addShotText: { color: authTheme.brand, fontSize: 11, fontFamily: fonts.semiBold },
  sendBtn: {
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sendText: { color: '#FFFFFF', fontSize: 15, fontFamily: fonts.bold },
  disabled: { opacity: 0.45 },
});
