import * as ImagePicker from 'expo-image-picker';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileText,
  Headphones,
  Mail,
  MessageCircle,
  Phone,
  PlayCircle,
  Plus,
  Upload,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDeliveryHeaderScrollProps } from '@/components/delivery/shared/header-scroll';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useCreateSupportTicket,
  usePartnerSupportHub,
} from '@/lib/delivery-partner/support-hooks';
import type {
  SupportIssueType,
  SupportTicket,
  SupportTicketStatus,
} from '@/lib/delivery-partner/support-types';
import { SUPPORT_ISSUE_TYPE_OPTIONS } from '@/lib/delivery-partner/support-types';

function statusMeta(status: SupportTicketStatus) {
  const s = String(status).toLowerCase();
  if (s === 'resolved' || s === 'closed') {
    return { label: 'Resolved', color: '#15803D', bg: '#DCFCE7', done: true };
  }
  if (s === 'in_progress' || s === 'open' || s === 'pending') {
    return {
      label: s === 'open' ? 'Open' : 'In Progress',
      color: authTheme.brand,
      bg: authTheme.brandSoft,
      done: false,
    };
  }
  return {
    label: status || 'Open',
    color: authTheme.textMuted,
    bg: '#F1F5F9',
    done: false,
  };
}

function ContactCard({
  icon: Icon,
  iconColor,
  title,
  value,
  hint,
  onPress,
}: {
  icon: typeof Phone;
  iconColor: string;
  title: string;
  value: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.contactCard}>
      <View style={[styles.contactIcon, { backgroundColor: `${iconColor}18` }]}>
        <Icon color={iconColor} size={18} />
      </View>
      <Text style={styles.contactTitle}>{title}</Text>
      <Text style={styles.contactValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.contactHint}>{hint}</Text>
    </Pressable>
  );
}

function TicketCard({ ticket }: { ticket: SupportTicket }) {
  const meta = statusMeta(ticket.status);
  return (
    <View style={styles.ticketCard}>
      <View style={styles.ticketTop}>
        <Text style={styles.ticketSubject} numberOfLines={2}>
          {ticket.subject}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
          {meta.done ? <CheckCircle2 color={meta.color} size={12} /> : null}
          <Text style={{ color: meta.color, fontFamily: fonts.semiBold, fontSize: 11 }}>
            {meta.label}
          </Text>
        </View>
      </View>
      {ticket.preview ? (
        <Text style={styles.ticketPreview} numberOfLines={2}>
          {ticket.preview}
        </Text>
      ) : null}
      {ticket.updatedLabel ? (
        <Text style={styles.ticketTime}>{ticket.updatedLabel}</Text>
      ) : null}
    </View>
  );
}

export function PartnerSupportManager() {
  const insets = useSafeAreaInsets();
  const headerScroll = useDeliveryHeaderScrollProps();
  const hub = usePartnerSupportHub();
  const createTicket = useCreateSupportTicket();

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [openFaqId, setOpenFaqId] = useState<string | null>('faq-accept');
  const [issueType, setIssueType] = useState<SupportIssueType | ''>('');
  const [description, setDescription] = useState('');
  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [ticketModalOpen, setTicketModalOpen] = useState(false);

  const data = hub.data;
  const contact = data?.contact;
  const faqs = data?.faqs ?? [];
  const tickets = data?.tickets ?? [];
  const training = useMemo(
    () => (data?.resources ?? []).filter((r) => r.kind === 'training'),
    [data?.resources]
  );
  const documents = useMemo(
    () => (data?.resources ?? []).filter((r) => r.kind === 'document'),
    [data?.resources]
  );

  const loading = hub.isLoading && !data;
  const error =
    hub.isError && !data
      ? getApiErrorMessage(hub.error, 'Could not load support.')
      : null;

  const selectedTypeLabel =
    SUPPORT_ISSUE_TYPE_OPTIONS.find((o) => o.value === issueType)?.label ??
    'Select issue type';

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await hub.refetch();
    } finally {
      setPullRefreshing(false);
    }
  };

  const callSupport = () => {
    const raw = contact?.phone || contact?.phoneLabel || '';
    const phone = raw.replace(/[^\d+]/g, '');
    if (!phone) {
      Alert.alert('Unavailable', 'Support phone will come from the API.');
      return;
    }
    void Linking.openURL(`tel:${phone}`);
  };

  const emailSupport = () => {
    const email = contact?.email || 'support@deliverhub.com';
    void Linking.openURL(`mailto:${email}`);
  };

  const startChat = () => {
    Alert.alert(
      'Live Chat',
      'Chat will connect when the support chat API is ready. For now, call or email us.'
    );
  };

  const openResource = (title: string) => {
    Alert.alert(title, 'This resource will open from the support API when available.');
  };

  const pickScreenshot = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo access to attach a screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]?.uri) {
      setScreenshotUri(result.assets[0].uri);
    }
  };

  const resetTicketForm = () => {
    setDescription('');
    setIssueType('');
    setScreenshotUri(null);
    setTypePickerOpen(false);
  };

  const openNewTicketModal = () => {
    resetTicketForm();
    setTicketModalOpen(true);
  };

  const closeNewTicketModal = () => {
    if (createTicket.isPending) return;
    setTicketModalOpen(false);
    resetTicketForm();
  };

  const submitReport = async () => {
    if (!issueType) {
      Alert.alert('Missing type', 'Please select an issue type.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Missing description', 'Please describe your issue.');
      return;
    }

    try {
      await createTicket.mutateAsync({
        issueType,
        description: description.trim(),
        screenshotUri,
      });
      setTicketModalOpen(false);
      resetTicketForm();
      Alert.alert('Ticket created', 'Your support ticket has been submitted.');
    } catch (err) {
      Alert.alert(
        'Could not submit',
        getApiErrorMessage(err, 'Please try again.')
      );
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: headerScroll.contentInsetTop + 12,
            paddingBottom: PARTNER_BOTTOM_NAV_INSET + 16,
          },
        ]}
        onScroll={headerScroll.onScroll}
        scrollEventThrottle={headerScroll.scrollEventThrottle}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={pullRefreshing}
            onRefresh={() => void onRefresh()}
            tintColor={authTheme.brand}
            colors={[authTheme.brand]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={authTheme.brand} size="large" />
            <Text style={styles.muted}>Loading support…</Text>
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Couldn’t load support</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.primaryBtn}>
              <Text style={styles.primaryBtnText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.contactRow}>
              <ContactCard
                icon={Phone}
                iconColor="#2563EB"
                title="Call Support"
                value={contact?.phoneLabel || contact?.phone || '1800-DELIVER'}
                hint={contact?.phoneHint || '24/7 Available'}
                onPress={callSupport}
              />
              <ContactCard
                icon={Mail}
                iconColor="#7C3AED"
                title="Email Support"
                value={contact?.email || 'support@deliverhub.com'}
                hint={contact?.emailHint || 'Response in 2 hours'}
                onPress={emailSupport}
              />
              <ContactCard
                icon={MessageCircle}
                iconColor={authTheme.success}
                title="Live Chat"
                value="Start Chat Now"
                hint={contact?.chatHint || 'Avg wait: 2 mins'}
                onPress={startChat}
              />
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHead}>
                <Headphones color={authTheme.brand} size={16} />
                <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
              </View>
              {faqs.map((faq) => {
                const open = openFaqId === faq.id;
                return (
                  <View key={faq.id} style={styles.faqItem}>
                    <Pressable
                      onPress={() => setOpenFaqId(open ? null : faq.id)}
                      style={styles.faqQ}
                    >
                      <Text style={styles.faqQuestion}>{faq.question}</Text>
                      <ChevronDown
                        color={authTheme.textMuted}
                        size={18}
                        style={{
                          transform: [{ rotate: open ? '180deg' : '0deg' }],
                        }}
                      />
                    </Pressable>
                    {open ? (
                      <Text style={styles.faqAnswer}>{faq.answer}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHead}>
                <PlayCircle color="#EA580C" size={16} />
                <Text style={styles.sectionTitle}>Training & Resources</Text>
              </View>
              {training.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => openResource(item.title)}
                  style={styles.linkRow}
                >
                  <BookOpen color={authTheme.brand} size={16} />
                  <Text style={styles.linkText}>{item.title}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.card}>
              <View style={styles.sectionHead}>
                <FileText color={authTheme.textMuted} size={16} />
                <Text style={styles.sectionTitle}>Important Documents</Text>
              </View>
              {documents.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => openResource(item.title)}
                  style={styles.linkRow}
                >
                  <FileText color={authTheme.textMuted} size={16} />
                  <Text style={styles.linkText}>{item.title}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.card}>
              <View style={styles.ticketsHead}>
                <Text style={styles.sectionTitle}>Your Support Tickets</Text>
                <Pressable
                  onPress={openNewTicketModal}
                  style={styles.newTicketBtn}
                >
                  <Plus color="#FFFFFF" size={14} />
                  <Text style={styles.newTicketText}>New Ticket</Text>
                </Pressable>
              </View>
              {tickets.length === 0 ? (
                <Text style={styles.muted}>No tickets yet.</Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {tickets.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} />
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={ticketModalOpen}
        transparent
        animationType="slide"
        onRequestClose={closeNewTicketModal}
      >
        <View style={styles.ticketModalRoot}>
          <Pressable
            style={styles.modalBackdropFill}
            onPress={closeNewTicketModal}
          />
          <View
            style={[
              styles.ticketModalSheet,
              { paddingBottom: Math.max(insets.bottom, 16) + 8 },
            ]}
          >
            <View style={styles.ticketModalHeader}>
              <Text style={styles.ticketModalTitle}>Report an Issue</Text>
              <Pressable
                onPress={closeNewTicketModal}
                style={styles.ticketCloseBtn}
                hitSlop={8}
              >
                <X color={authTheme.text} size={18} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.ticketModalBody}
            >
              <Text style={styles.fieldLabel}>Issue Type</Text>
              <Pressable
                onPress={() => setTypePickerOpen(true)}
                style={styles.selectField}
              >
                <Text
                  style={[
                    styles.selectText,
                    !issueType && { color: authTheme.textDim },
                  ]}
                >
                  {selectedTypeLabel}
                </Text>
                <ChevronDown color={authTheme.textMuted} size={18} />
              </Pressable>

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Describe your issue in detail…"
                placeholderTextColor={authTheme.textDim}
                multiline
                textAlignVertical="top"
                style={styles.textArea}
              />

              <Text style={styles.fieldLabel}>Attach Screenshot</Text>
              <Pressable
                onPress={() => void pickScreenshot()}
                style={styles.uploadBox}
              >
                <Upload color={authTheme.textMuted} size={18} />
                <Text style={styles.uploadText}>
                  {screenshotUri
                    ? 'Screenshot attached — tap to change'
                    : 'Tap to upload a screenshot'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => void submitReport()}
                disabled={createTicket.isPending}
                style={styles.submitHit}
              >
                <View style={styles.submitBtn}>
                  {createTicket.isPending ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitText}>Submit Report</Text>
                  )}
                </View>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={typePickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setTypePickerOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setTypePickerOpen(false)}
        >
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Select issue type</Text>
            {SUPPORT_ISSUE_TYPE_OPTIONS.map((opt) => (
              <Pressable
                key={opt.value}
                onPress={() => {
                  setIssueType(opt.value);
                  setTypePickerOpen(false);
                }}
                style={styles.modalRow}
              >
                <Text style={styles.modalRowText}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authTheme.surface,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: authTheme.card,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: authTheme.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: authTheme.cardBorder,
  },
  kicker: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: authTheme.brand,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    color: authTheme.text,
    marginTop: 2,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brandSoft,
  },
  scrollView: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  center: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 10,
  },
  muted: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: authTheme.textMuted,
    lineHeight: 18,
  },
  contactRow: {
    flexDirection: 'row',
    gap: 8,
  },
  contactCard: {
    flex: 1,
    backgroundColor: authTheme.card,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 10,
    minHeight: 118,
  },
  contactIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  contactTitle: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: authTheme.textMuted,
  },
  contactValue: {
    marginTop: 4,
    fontFamily: fonts.bold,
    fontSize: 12,
    color: authTheme.text,
  },
  contactHint: {
    marginTop: 4,
    fontFamily: fonts.regular,
    fontSize: 10,
    color: authTheme.textDim,
  },
  card: {
    backgroundColor: authTheme.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 8,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  faqItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
    paddingTop: 10,
    marginTop: 2,
  },
  faqQ: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  faqQuestion: {
    flex: 1,
    fontFamily: fonts.semiBold,
    fontSize: 13,
    color: authTheme.text,
  },
  faqAnswer: {
    marginTop: 8,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: authTheme.textMuted,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  linkText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: authTheme.text,
  },
  ticketsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  newTicketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: authTheme.brand,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  newTicketText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  ticketCard: {
    backgroundColor: authTheme.bgSoft,
    borderRadius: 12,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
  },
  ticketTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  ticketSubject: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 14,
    color: authTheme.text,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  ticketPreview: {
    marginTop: 6,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: authTheme.textMuted,
    lineHeight: 17,
  },
  ticketTime: {
    marginTop: 8,
    fontFamily: fonts.medium,
    fontSize: 11,
    color: authTheme.textDim,
  },
  fieldLabel: {
    marginTop: 8,
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: authTheme.textMuted,
  },
  selectField: {
    marginTop: 6,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    backgroundColor: authTheme.bgSoft,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectText: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: authTheme.text,
  },
  textArea: {
    marginTop: 6,
    minHeight: 110,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: authTheme.inputBorder,
    backgroundColor: authTheme.bgSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: authTheme.text,
  },
  uploadBox: {
    marginTop: 6,
    minHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: authTheme.inputBorder,
    backgroundColor: authTheme.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  uploadText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: authTheme.textMuted,
    textAlign: 'center',
  },
  submitHit: { marginTop: 12 },
  submitBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: authTheme.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  primaryBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: authTheme.brand,
  },
  primaryBtnText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  ticketModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  ticketModalSheet: {
    backgroundColor: authTheme.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingTop: 12,
  },
  ticketModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  ticketModalTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    color: authTheme.text,
  },
  ticketCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.bgSoft,
  },
  ticketModalBody: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 4,
  },
  modalSheet: {
    backgroundColor: authTheme.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    color: authTheme.text,
    marginBottom: 8,
  },
  modalRow: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: authTheme.cardBorder,
  },
  modalRowText: {
    fontFamily: fonts.semiBold,
    fontSize: 14,
    color: authTheme.text,
  },
});
