import {
  Building2,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Pencil,
  ShieldAlert,
  X,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
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
  formatBankError,
  partnerBankApi,
  saveTaxPdfOnDevice,
} from '@/lib/delivery-partner/bank-api';
import {
  useIfscLookup,
  usePartnerBank,
  usePartnerBankMutations,
  usePartnerTaxDetails,
  usePartnerTaxDocuments,
} from '@/lib/delivery-partner/bank-hooks';
import {
  bankStatusLabel,
  isValidAccount,
  isValidIfsc,
  isValidPan,
  normalizeIfsc,
  type PartnerBank,
} from '@/lib/delivery-partner/bank-types';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import { getApiErrorCode } from '@/lib/errors';

function statusColors(status?: string) {
  const key = (status ?? '').toLowerCase();
  if (key === 'verified' || key === 'success') {
    return { bg: '#DCFCE7', fg: '#15803D' };
  }
  if (key === 'pending') return { bg: '#FEF3C7', fg: '#B45309' };
  if (key === 'failed') return { bg: '#FEE2E2', fg: '#B91C1C' };
  return { bg: '#F1F5F9', fg: '#64748B' };
}

export function PartnerBankTaxSection() {
  const insets = useSafeAreaInsets();
  const bankQuery = usePartnerBank(true);
  const taxQuery = usePartnerTaxDetails(true);
  const taxDocs = usePartnerTaxDocuments(true);
  const mutations = usePartnerBankMutations();
  const [bankOpen, setBankOpen] = useState(false);
  const [taxOpen, setTaxOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const bank = bankQuery.data;
  const tax = taxQuery.data;

  const onVerify = () => {
    Alert.alert(
      'Verify bank account?',
      'We’ll penny-drop ₹1 via Cashfree to confirm the account. Payouts stay off until this succeeds.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Verify',
          onPress: () => {
            void (async () => {
              try {
                const next = await mutations.verifyBank.mutateAsync();
                Alert.alert(
                  bankStatusLabel(next.verificationStatus),
                  next.payoutsEnabled
                    ? 'Payouts are enabled on this account.'
                    : next.nameAtBank
                      ? `Bank name on file: ${next.nameAtBank}`
                      : 'Saved. Instant payouts unlock when verification succeeds.'
                );
              } catch (err) {
                Alert.alert(
                  'Could not verify',
                  formatBankError(err, 'Try again in a couple of minutes.')
                );
              }
            })();
          },
        },
      ]
    );
  };

  const onDownload = async (documentId: string) => {
    setDownloadingId(documentId);
    try {
      const file = await partnerBankApi.downloadTaxDocument(documentId);
      const uri = await saveTaxPdfOnDevice(file.filename, file.bytes);
      if (uri && !uri.startsWith('blob:')) {
        try {
          await Linking.openURL(uri);
        } catch {
          Alert.alert('Downloaded', `Saved ${file.filename}`);
        }
      } else if (!uri) {
        Alert.alert(
          'Open on web',
          'This PDF can be saved from the web app. The file was fetched but this phone cannot store it.'
        );
      }
    } catch (err) {
      Alert.alert(
        'Could not download',
        formatBankError(err, 'Try again.')
      );
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.section}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <CreditCard color="#EA4B14" size={16} />
            <Text style={styles.title}>Payout bank</Text>
          </View>
          <Pressable
            onPress={() => setBankOpen(true)}
            style={styles.editBtn}
          >
            <Pencil color="#6B7280" size={13} />
            <Text style={styles.editText}>{bank?.hasAccount ? 'Edit' : 'Add'}</Text>
          </Pressable>
        </View>
        <Text style={styles.lede}>
          Instant payouts need a penny-drop verified account — same as Swiggy / Zomato.
        </Text>

        {bankQuery.isLoading && bank == null ? (
          <ActivityIndicator color="#EA4B14" style={{ marginVertical: 10 }} />
        ) : bankQuery.isError ? (
          <Pressable onPress={() => void bankQuery.refetch()}>
            <Text style={styles.retry}>
              {formatBankError(bankQuery.error, 'Could not load bank. Retry')}
            </Text>
          </Pressable>
        ) : !bank?.hasAccount ? (
          <Text style={styles.empty}>No bank account yet. Add IFSC and account number.</Text>
        ) : (
          <BankSummary
            bank={bank}
            verifying={mutations.verifyBank.isPending}
            onVerify={onVerify}
          />
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <FileText color="#EA4B14" size={16} />
            <Text style={styles.title}>PAN & tax</Text>
          </View>
          <Pressable onPress={() => setTaxOpen(true)} style={styles.editBtn}>
            <Pencil color="#6B7280" size={13} />
            <Text style={styles.editText}>{tax?.hasPan ? 'Edit' : 'Add'}</Text>
          </Pressable>
        </View>

        {taxQuery.isLoading && tax == null ? (
          <ActivityIndicator color="#EA4B14" style={{ marginVertical: 10 }} />
        ) : taxQuery.isError ? (
          <Pressable onPress={() => void taxQuery.refetch()}>
            <Text style={styles.retry}>
              {formatBankError(taxQuery.error, 'Could not load tax details. Retry')}
            </Text>
          </Pressable>
        ) : (
          <View style={{ gap: 6 }}>
            <Text style={styles.rowText}>
              PAN · {tax?.panMasked || 'Not set'}
            </Text>
            {tax?.panName ? (
              <Text style={styles.hint}>{tax.panName}</Text>
            ) : null}
            <Text style={styles.rowText}>
              GSTIN · {tax?.gstinMasked || 'Not set'}
            </Text>
            {typeof tax?.tdsRate === 'number' ? (
              <Text style={styles.hint}>
                TDS {(tax.tdsRate * 100).toFixed(1)}%
              </Text>
            ) : null}
          </View>
        )}

        <Text style={[styles.lede, { marginTop: 12 }]}>Form 16A / TDS</Text>
        {taxDocs.isLoading && !taxDocs.data ? (
          <ActivityIndicator color="#EA4B14" />
        ) : taxDocs.isError ? (
          <Pressable onPress={() => void taxDocs.refetch()}>
            <Text style={styles.retry}>Could not load tax PDFs. Retry</Text>
          </Pressable>
        ) : !(taxDocs.data?.length) ? (
          <Text style={styles.empty}>No tax PDFs yet. They appear after you earn.</Text>
        ) : (
          taxDocs.data.map((doc) => (
            <View key={doc.documentId} style={styles.docRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>{doc.title}</Text>
                <Text style={styles.hint}>
                  {[
                    doc.periodLabel,
                    doc.tdsAmount != null
                      ? `TDS ${formatCurrency(doc.tdsAmount, 'INR')}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Pressable
                onPress={() => void onDownload(doc.documentId)}
                disabled={downloadingId === doc.documentId}
                hitSlop={8}
              >
                {downloadingId === doc.documentId ? (
                  <ActivityIndicator color="#EA4B14" size="small" />
                ) : (
                  <Download color="#EA4B14" size={18} />
                )}
              </Pressable>
            </View>
          ))
        )}
      </View>

      <BankEditModal
        visible={bankOpen}
        existing={bank}
        paddingBottom={Math.max(insets.bottom, 16)}
        onClose={() => setBankOpen(false)}
      />
      <TaxEditModal
        visible={taxOpen}
        panName={tax?.panName ?? ''}
        gstLegalName={tax?.gstLegalName ?? ''}
        paddingBottom={Math.max(insets.bottom, 16)}
        onClose={() => setTaxOpen(false)}
      />
    </View>
  );
}

function BankSummary({
  bank,
  verifying,
  onVerify,
}: {
  bank: PartnerBank;
  verifying: boolean;
  onVerify: () => void;
}) {
  const colors = statusColors(bank.verificationStatus);
  const verified =
    bank.verificationStatus === 'verified' || bank.payoutsEnabled;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.badgeRow}>
        <View style={[styles.badge, { backgroundColor: colors.bg }]}>
          {verified ? (
            <CheckCircle2 color={colors.fg} size={12} />
          ) : (
            <ShieldAlert color={colors.fg} size={12} />
          )}
          <Text style={[styles.badgeText, { color: colors.fg }]}>
            {bankStatusLabel(bank.verificationStatus)}
            {bank.payoutsEnabled ? ' · Payouts on' : ''}
          </Text>
        </View>
      </View>
      <Text style={styles.rowText}>{bank.holderName || 'Account holder'}</Text>
      <Text style={styles.hint}>
        {[bank.bankName, bank.branch, bank.city].filter(Boolean).join(' · ') ||
          'Bank on file'}
      </Text>
      <Text style={styles.rowText}>A/C {bank.accountMasked}</Text>
      <Text style={styles.hint}>IFSC {bank.ifsc}</Text>
      {bank.nameAtBank ? (
        <Text style={styles.hint}>Name at bank · {bank.nameAtBank}</Text>
      ) : null}
      {!verified ? (
        <Pressable
          onPress={onVerify}
          disabled={verifying}
          style={styles.verifyBtn}
        >
          {verifying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.verifyText}>Verify with penny-drop</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function BankEditModal({
  visible,
  existing,
  paddingBottom,
  onClose,
}: {
  visible: boolean;
  existing?: PartnerBank | null;
  paddingBottom: number;
  onClose: () => void;
}) {
  const mutations = usePartnerBankMutations();
  const [accountNo, setAccountNo] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [holderName, setHolderName] = useState('');
  const [otp, setOtp] = useState('');
  const [needOtp, setNeedOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = useIfscLookup(ifsc, visible);

  useEffect(() => {
    if (!visible) return;
    setAccountNo('');
    setIfsc(existing?.ifsc ?? '');
    setHolderName(existing?.holderName ?? '');
    setOtp('');
    setNeedOtp(Boolean(existing?.hasAccount));
    setError(null);
    setCooldown(0);
  }, [visible, existing?.ifsc, existing?.holderName, existing?.hasAccount]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendOtp = async () => {
    setError(null);
    try {
      const result = await mutations.sendOtp.mutateAsync();
      setNeedOtp(true);
      setCooldown(result.resendAfterSeconds || 60);
      Alert.alert(
        'OTP sent',
        result.sentTo
          ? `Code sent to ${result.sentTo}`
          : 'Enter the 6-digit SMS on your registered phone.'
      );
    } catch (err) {
      if (getApiErrorCode(err) === 'OTP_NOT_NEEDED') {
        setNeedOtp(false);
        return;
      }
      setError(formatBankError(err, 'Could not send OTP.'));
    }
  };

  const onSave = async () => {
    setError(null);
    if (!isValidAccount(accountNo)) {
      setError('Enter a 9–18 digit account number.');
      return;
    }
    if (!isValidIfsc(ifsc)) {
      setError('Enter a valid 11-character IFSC.');
      return;
    }
    if (holderName.trim().length < 2) {
      setError('Enter the name on the account.');
      return;
    }
    setBusy(true);
    try {
      await mutations.saveBank.mutateAsync({
        accountNo,
        ifsc,
        holderName,
        otp: needOtp ? otp : undefined,
      });
      Alert.alert(
        'Bank saved',
        'Account is unverified until penny-drop succeeds. Tap Verify on the card.'
      );
      onClose();
    } catch (err) {
      if (getApiErrorCode(err) === 'OTP_REQUIRED') {
        setNeedOtp(true);
        try {
          await sendOtp();
        } catch {
          // sendOtp sets error
        }
        setError('OTP required to change this account. Enter the SMS code.');
        return;
      }
      setError(formatBankError(err, 'Could not save bank details.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>
              {existing?.hasAccount ? 'Change bank account' : 'Add bank account'}
            </Text>
            <Pressable onPress={onClose} style={styles.close}>
              <X color="#6B7280" size={18} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Field
            label="Account number"
            value={accountNo}
            onChangeText={(v) => setAccountNo(v.replace(/\D/g, '').slice(0, 18))}
            keyboardType="number-pad"
            placeholder="9–18 digits"
          />
          <Field
            label="IFSC"
            value={ifsc}
            onChangeText={(v) => setIfsc(normalizeIfsc(v).slice(0, 11))}
            autoCapitalize="characters"
            placeholder="HDFC0000123"
          />
          {lookup.data?.bank ? (
            <View style={styles.ifscHit}>
              <Building2 color="#C2410C" size={14} />
              <Text style={styles.ifscHitText}>
                {[lookup.data.bank, lookup.data.branch, lookup.data.city]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ) : lookup.isFetching && isValidIfsc(ifsc) ? (
            <ActivityIndicator color="#EA4B14" />
          ) : lookup.isError && isValidIfsc(ifsc) ? (
            <Text style={styles.error}>
              {formatBankError(lookup.error, 'Unknown IFSC')}
            </Text>
          ) : null}
          <Field
            label="Account holder name"
            value={holderName}
            onChangeText={setHolderName}
            autoCapitalize="words"
            placeholder="As per passbook"
          />
          {needOtp ? (
            <>
              <Text style={styles.hint}>
                Changing account or IFSC needs an OTP on your registered phone.
              </Text>
              <Field
                label="OTP"
                value={otp}
                onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="6-digit OTP"
              />
              <Pressable
                onPress={() => void sendOtp()}
                disabled={cooldown > 0 || mutations.sendOtp.isPending}
              >
                <Text style={styles.link}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send OTP'}
                </Text>
              </Pressable>
            </>
          ) : null}
          <Pressable onPress={() => void onSave()} disabled={busy} style={styles.saveBtn}>
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveText}>Save bank</Text>
            )}
          </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TaxEditModal({
  visible,
  panName,
  gstLegalName,
  paddingBottom,
  onClose,
}: {
  visible: boolean;
  panName: string;
  gstLegalName: string;
  paddingBottom: number;
  onClose: () => void;
}) {
  const mutations = usePartnerBankMutations();
  const [panNumber, setPanNumber] = useState('');
  const [name, setName] = useState(panName);
  const [gstin, setGstin] = useState('');
  const [gstName, setGstName] = useState(gstLegalName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setPanNumber('');
    setName(panName);
    setGstin('');
    setGstName(gstLegalName);
    setError(null);
  }, [visible, panName, gstLegalName]);

  const onSave = async () => {
    setError(null);
    if (!isValidPan(panNumber)) {
      setError('Enter a valid PAN (AAAAA9999A).');
      return;
    }
    setBusy(true);
    try {
      await mutations.updateTax.mutateAsync({
        panNumber,
        panName: name,
        gstin,
        gstLegalName: gstName,
      });
      Alert.alert('Saved', 'PAN / GSTIN updated. Values are masked on the next load.');
      onClose();
    } catch (err) {
      setError(formatBankError(err, 'Could not save tax details.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>PAN & GSTIN</Text>
            <Pressable onPress={onClose} style={styles.close}>
              <X color="#6B7280" size={18} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Field
            label="PAN"
            value={panNumber}
            onChangeText={(v) => setPanNumber(v.replace(/\s/g, '').toUpperCase().slice(0, 10))}
            autoCapitalize="characters"
            placeholder="ABCDE1234F"
          />
          <Field
            label="Name on PAN"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Field
            label="GSTIN (optional)"
            value={gstin}
            onChangeText={(v) => setGstin(v.replace(/\s/g, '').toUpperCase().slice(0, 15))}
            autoCapitalize="characters"
            placeholder="15 characters"
          />
          <Field
            label="GST legal name"
            value={gstName}
            onChangeText={setGstName}
            autoCapitalize="words"
          />
          <Pressable onPress={() => void onSave()} disabled={busy} style={styles.saveBtn}>
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.saveText}>Save tax details</Text>
            )}
          </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'characters' | 'words';
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F3F4F6',
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 15, color: '#111827' },
  lede: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#6B7280',
    lineHeight: 17,
    marginBottom: 10,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  editText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#6B7280' },
  empty: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280' },
  rowText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#111827' },
  hint: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280', marginTop: 2 },
  retry: { fontFamily: fonts.semiBold, fontSize: 13, color: '#EA4B14' },
  badgeRow: { flexDirection: 'row' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontFamily: fonts.semiBold, fontSize: 11 },
  verifyBtn: {
    marginTop: 8,
    backgroundColor: '#EA4B14',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  verifyText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#FFFFFF' },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#00000066' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '88%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 18, color: '#111827' },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { fontFamily: fonts.medium, fontSize: 13, color: '#B91C1C', marginBottom: 8 },
  fieldLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#111827',
  },
  ifscHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF7ED',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  ifscHitText: { fontFamily: fonts.semiBold, fontSize: 12, color: '#C2410C', flex: 1 },
  link: { fontFamily: fonts.semiBold, fontSize: 13, color: '#EA4B14', marginBottom: 10 },
  saveBtn: {
    marginTop: 4,
    backgroundColor: '#EA4B14',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: { fontFamily: fonts.semiBold, fontSize: 15, color: '#FFFFFF' },
});
