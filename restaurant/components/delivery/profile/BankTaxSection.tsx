import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  CreditCard,
  Download,
  FileText,
  Pencil,
  ShieldAlert,
  X,
  Zap,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { formatCurrency } from '@/lib/delivery-partner/analytics-api';
import {
  formatBankError,
  partnerBankApi,
  shareTaxPdf,
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
  isBankVerified,
  isValidAccount,
  isValidGstin,
  isValidIfsc,
  isValidPan,
  normalizeIfsc,
  taxKindLabel,
  tdsPercentLabel,
  type PartnerBank,
  type PartnerTaxDocument,
} from '@/lib/delivery-partner/bank-types';
import { getApiErrorCode } from '@/lib/errors';

function statusTone(status?: string) {
  const key = (status ?? '').toLowerCase();
  if (key === 'verified' || key === 'success') {
    return { bg: '#DCFCE7', fg: '#15803D', strip: '#166534' };
  }
  if (key === 'pending' || key === 'in_progress') {
    return { bg: '#FEF3C7', fg: '#B45309', strip: '#B45309' };
  }
  if (key === 'failed') {
    return { bg: '#FEE2E2', fg: '#B91C1C', strip: '#B91C1C' };
  }
  return { bg: '#F1F5F9', fg: '#64748B', strip: '#EA4B14' };
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
  const [verifyCooldown, setVerifyCooldown] = useState(0);
  const [verifyBanner, setVerifyBanner] = useState<string | null>(null);

  const bank = bankQuery.data;
  const tax = taxQuery.data;
  const verified = isBankVerified(bank);
  const payoutsOn = Boolean(bank?.payoutsEnabled);
  const tone = statusTone(bank?.verificationStatus);

  useEffect(() => {
    if (verifyCooldown <= 0) return;
    const timer = setTimeout(
      () => setVerifyCooldown((n) => Math.max(0, n - 1)),
      1000
    );
    return () => clearTimeout(timer);
  }, [verifyCooldown]);

  const groupedDocs = useMemo(
    () => groupTaxDocuments(taxDocs.data ?? []),
    [taxDocs.data]
  );

  const onVerify = () => {
    if (verifyCooldown > 0) return;
    Alert.alert(
      'Verify bank account?',
      'We’ll penny-drop ₹1 via Cashfree to confirm this account. Instant payouts stay off until the bank name matches. This never marks verified without the provider.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Verify ₹1',
          onPress: () => {
            void (async () => {
              try {
                setVerifyBanner(null);
                const next = await mutations.verifyBank.mutateAsync();
                const ok = isBankVerified(next);
                Alert.alert(
                  bankStatusLabel(next.verificationStatus),
                  ok
                    ? 'Payouts are enabled on this account.'
                    : next.nameAtBank
                      ? `Bank returned “${next.nameAtBank}”. Instant payouts unlock when status is Verified.`
                      : 'Saved. Instant payouts unlock when penny-drop succeeds.'
                );
              } catch (err) {
                const code = getApiErrorCode(err);
                if (code === 'VERIFY_IN_PROGRESS') {
                  setVerifyCooldown(120);
                  setVerifyBanner(
                    'Verification already running. Wait two minutes before trying again.'
                  );
                  return;
                }
                if (code === 'BANK_VERIFY_UNAVAILABLE') {
                  setVerifyBanner(
                    'Penny-drop is unavailable right now. Your account is saved — payouts stay off until Cashfree is back. We never fake Verified.'
                  );
                  return;
                }
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
      await shareTaxPdf(file.filename, file.bytes);
    } catch (err) {
      Alert.alert('Could not download', formatBankError(err, 'Try again.'));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.section}>
        <View style={[styles.payoutStrip, { backgroundColor: tone.strip }]}>
          <Zap color="#FFFFFF" size={14} />
          <Text style={styles.payoutStripText}>
            {!bank?.hasAccount
              ? 'Add a bank account to get paid'
              : payoutsOn
                ? 'Instant payouts on'
                : verified
                  ? 'Verified · payouts enabling'
                  : 'Verify to unlock instant payouts'}
          </Text>
        </View>

        <View style={styles.header}>
          <View style={styles.titleRow}>
            <CreditCard color={authTheme.brand} size={16} />
            <Text style={styles.title}>Payout bank</Text>
          </View>
          <Pressable onPress={() => setBankOpen(true)} style={styles.editBtn}>
            <Pencil color="#6B7280" size={13} />
            <Text style={styles.editText}>
              {bank?.hasAccount ? 'Change' : 'Add'}
            </Text>
          </Pressable>
        </View>

        <PayoutSteps bank={bank} />

        {bankQuery.isLoading && bank == null ? (
          <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 12 }} />
        ) : bankQuery.isError ? (
          <Pressable onPress={() => void bankQuery.refetch()} style={styles.retryBox}>
            <Text style={styles.retry}>
              {formatBankError(bankQuery.error, 'Could not load bank. Retry')}
            </Text>
          </Pressable>
        ) : !bank?.hasAccount ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No payout account yet</Text>
            <Text style={styles.empty}>
              Add IFSC + account number. First add needs no OTP. Instant and
              weekly payouts need penny-drop Verified — same as Swiggy / Zomato.
            </Text>
            <Pressable onPress={() => setBankOpen(true)} style={styles.primaryBtn}>
              <Text style={styles.primaryText}>Add bank account</Text>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: tone.bg }]}>
                {verified ? (
                  <CheckCircle2 color={tone.fg} size={12} />
                ) : (
                  <ShieldAlert color={tone.fg} size={12} />
                )}
                <Text style={[styles.badgeText, { color: tone.fg }]}>
                  {bankStatusLabel(bank.verificationStatus)}
                </Text>
              </View>
            </View>
            <Text style={styles.holder}>{bank.holderName || 'Account holder'}</Text>
            <Text style={styles.hint}>
              {[bank.bankName, bank.branch, bank.city].filter(Boolean).join(' · ') ||
                'Bank on file'}
            </Text>
            <View style={styles.maskRow}>
              <Text style={styles.maskLabel}>A/C</Text>
              <Text style={styles.maskValue}>{bank.accountMasked}</Text>
            </View>
            <View style={styles.maskRow}>
              <Text style={styles.maskLabel}>IFSC</Text>
              <Text style={styles.maskValue}>{bank.ifsc}</Text>
            </View>
            {bank.nameAtBank ? (
              <Text style={styles.hint}>Name at bank · {bank.nameAtBank}</Text>
            ) : null}
            {bank.nameMatch === false ? (
              <View style={styles.warnNote}>
                <AlertTriangle color="#B45309" size={14} />
                <Text style={styles.warnNoteText}>
                  Name at bank doesn’t match the holder name. Payouts stay off
                  until this matches.
                </Text>
              </View>
            ) : null}
            {verifyBanner ? (
              <View style={styles.warnNote}>
                <ShieldAlert color="#B45309" size={14} />
                <Text style={styles.warnNoteText}>{verifyBanner}</Text>
              </View>
            ) : null}
            {!payoutsOn ? (
              <Pressable
                onPress={onVerify}
                disabled={
                  mutations.verifyBank.isPending || verifyCooldown > 0
                }
                style={[
                  styles.primaryBtn,
                  verifyCooldown > 0 ? styles.primaryBtnMuted : null,
                ]}
              >
                {mutations.verifyBank.isPending ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryText}>
                    {verifyCooldown > 0
                      ? `Retry verify in ${verifyCooldown}s`
                      : 'Verify with ₹1 penny-drop'}
                  </Text>
                )}
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <FileText color={authTheme.brand} size={16} />
            <Text style={styles.title}>PAN & tax</Text>
          </View>
          <Pressable onPress={() => setTaxOpen(true)} style={styles.editBtn}>
            <Pencil color="#6B7280" size={13} />
            <Text style={styles.editText}>{tax?.hasPan ? 'Edit' : 'Add'}</Text>
          </Pressable>
        </View>
        <Text style={styles.lede}>
          PAN card photo stays Under review in Documents until ops approve. The
          number here is for TDS / Form 16A.
        </Text>

        {taxQuery.isLoading && tax == null ? (
          <ActivityIndicator color={authTheme.brand} style={{ marginVertical: 10 }} />
        ) : taxQuery.isError ? (
          <Pressable onPress={() => void taxQuery.refetch()}>
            <Text style={styles.retry}>
              {formatBankError(taxQuery.error, 'Could not load tax details. Retry')}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.taxGrid}>
            <View style={styles.taxTile}>
              <Text style={styles.tileLabel}>PAN</Text>
              <Text style={styles.tileValue}>{tax?.panMasked || 'Not set'}</Text>
              {tax?.panName ? (
                <Text style={styles.hint}>{tax.panName}</Text>
              ) : null}
            </View>
            <View style={styles.taxTile}>
              <Text style={styles.tileLabel}>GSTIN</Text>
              <Text style={styles.tileValue}>{tax?.gstinMasked || 'Optional'}</Text>
              {tax?.gstLegalName ? (
                <Text style={styles.hint}>{tax.gstLegalName}</Text>
              ) : null}
            </View>
            <View style={[styles.taxTile, styles.taxTileWide]}>
              <Text style={styles.tileLabel}>Withholding</Text>
              <Text style={styles.tileValue}>
                {tdsPercentLabel(tax?.tdsRate) ?? '1% TDS'}
              </Text>
              <Text style={styles.hint}>Deducted on eligible earnings</Text>
            </View>
          </View>
        )}

        <Text style={[styles.title, { marginTop: 16, marginBottom: 8 }]}>
          Form 16A / TDS
        </Text>
        {taxDocs.isLoading && !taxDocs.data ? (
          <ActivityIndicator color={authTheme.brand} />
        ) : taxDocs.isError ? (
          <Pressable onPress={() => void taxDocs.refetch()}>
            <Text style={styles.retry}>Could not load tax PDFs. Retry</Text>
          </Pressable>
        ) : groupedDocs.length === 0 ? (
          <Text style={styles.empty}>
            No tax PDFs yet. Quarterly TDS, Form 16A, and annual statements
            appear after you earn.
          </Text>
        ) : (
          groupedDocs.map((group) => (
            <View key={group.kind} style={{ marginBottom: 4 }}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              {group.docs.map((doc) => (
                <View key={doc.documentId} style={styles.docRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowText}>{doc.title}</Text>
                    <Text style={styles.hint}>
                      {[
                        doc.periodLabel,
                        doc.grossEarnings != null
                          ? `Gross ${formatCurrency(doc.grossEarnings, 'INR')}`
                          : null,
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
                    style={styles.downloadHit}
                  >
                    {downloadingId === doc.documentId ? (
                      <ActivityIndicator color={authTheme.brand} size="small" />
                    ) : (
                      <Download color={authTheme.brand} size={18} />
                    )}
                  </Pressable>
                </View>
              ))}
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

function groupTaxDocuments(docs: PartnerTaxDocument[]) {
  const buckets = new Map<string, PartnerTaxDocument[]>();
  for (const doc of docs) {
    const kind = (doc.kind || 'tax').toLowerCase();
    const list = buckets.get(kind) ?? [];
    list.push(doc);
    buckets.set(kind, list);
  }
  const order = ['form_16a', 'tds_certificate', 'annual_statement', 'fy_statement'];
  const keys = [
    ...order.filter((k) => buckets.has(k)),
    ...[...buckets.keys()].filter((k) => !order.includes(k)),
  ];
  return keys.map((kind) => ({
    kind,
    label: taxKindLabel(kind),
    docs: buckets.get(kind) ?? [],
  }));
}

function PayoutSteps({ bank }: { bank?: PartnerBank | null }) {
  const added = Boolean(bank?.hasAccount);
  const verified = isBankVerified(bank);
  const payouts = Boolean(bank?.payoutsEnabled);
  const steps = [
    { key: 'add', label: 'Added', on: added },
    { key: 'verify', label: 'Verified', on: verified },
    { key: 'pay', label: 'Payouts', on: payouts },
  ];
  return (
    <View style={styles.steps}>
      {steps.map((step, index) => (
        <View key={step.key} style={styles.stepItem}>
          <View
            style={[
              styles.stepDot,
              { backgroundColor: step.on ? '#166534' : '#E5E7EB' },
            ]}
          >
            {step.on ? (
              <Check color="#FFFFFF" size={10} strokeWidth={3} />
            ) : (
              <Text style={styles.stepNum}>{index + 1}</Text>
            )}
          </View>
          <Text style={[styles.stepLabel, step.on && styles.stepLabelOn]}>
            {step.label}
          </Text>
          {index < steps.length - 1 ? (
            <View
              style={[
                styles.stepLine,
                { backgroundColor: steps[index + 1].on ? '#166534' : '#E5E7EB' },
              ]}
            />
          ) : null}
        </View>
      ))}
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
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lookup = useIfscLookup(ifsc, visible);
  const changing = Boolean(existing?.hasAccount);

  useEffect(() => {
    if (!visible) return;
    setAccountNo('');
    setIfsc(existing?.ifsc ?? '');
    setHolderName(existing?.holderName ?? '');
    setOtp('');
    setNeedOtp(changing);
    setSentTo(null);
    setError(null);
    setCooldown(0);
  }, [visible, existing?.ifsc, existing?.holderName, changing]);

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
      setSentTo(result.sentTo ?? null);
      setCooldown(result.resendAfterSeconds || 60);
    } catch (err) {
      const code = getApiErrorCode(err);
      if (code === 'OTP_NOT_NEEDED') {
        setNeedOtp(false);
        return;
      }
      if (code === 'OTP_COOLDOWN') {
        setCooldown(60);
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
    if (needOtp && otp.length !== 6) {
      setError('Enter the 6-digit SMS OTP to change this account.');
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
        changing
          ? 'Account is unverified until penny-drop succeeds. Tap Verify on the card.'
          : 'Next: verify with a ₹1 penny-drop to turn instant payouts on.'
      );
      onClose();
    } catch (err) {
      if (getApiErrorCode(err) === 'OTP_REQUIRED') {
        setNeedOtp(true);
        await sendOtp();
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
              {changing ? 'Change bank account' : 'Add bank account'}
            </Text>
            <Pressable onPress={onClose} style={styles.close}>
              <X color="#6B7280" size={18} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {changing ? (
              <Text style={styles.lede}>
                Current A/C {existing?.accountMasked}. Changing account or IFSC
                sends OTP to your registered phone and resets verification.
              </Text>
            ) : (
              <Text style={styles.lede}>
                First-time add does not need OTP. Use the name printed on the
                passbook.
              </Text>
            )}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Field
              label="Account number"
              value={accountNo}
              onChangeText={(v) => setAccountNo(v.replace(/\D/g, '').slice(0, 18))}
              keyboardType="number-pad"
              placeholder="9–18 digits"
              secureTextEntry
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
              <ActivityIndicator color={authTheme.brand} />
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
                  {sentTo
                    ? `OTP sent to ${sentTo}`
                    : 'Changing account or IFSC needs an OTP on your registered phone.'}
                </Text>
                <Field
                  label="6-digit OTP"
                  value={otp}
                  onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  placeholder="••••••"
                />
                <Pressable
                  onPress={() => void sendOtp()}
                  disabled={cooldown > 0 || mutations.sendOtp.isPending}
                >
                  <Text style={styles.link}>
                    {mutations.sendOtp.isPending
                      ? 'Sending…'
                      : cooldown > 0
                        ? `Resend in ${cooldown}s`
                        : sentTo
                          ? 'Resend OTP'
                          : 'Send OTP'}
                  </Text>
                </Pressable>
              </>
            ) : null}
            <Pressable onPress={() => void onSave()} disabled={busy} style={styles.saveBtn}>
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveText}>
                  {changing ? 'Save new account' : 'Save bank'}
                </Text>
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
    if (gstin && !isValidGstin(gstin)) {
      setError('Enter a valid 15-character GSTIN.');
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
            <Text style={styles.lede}>
              Enter the full PAN. We only show a masked value after save — same
              as Swiggy / Zomato partner tax.
            </Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Field
              label="PAN"
              value={panNumber}
              onChangeText={(v) =>
                setPanNumber(v.replace(/\s/g, '').toUpperCase().slice(0, 10))
              }
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
              onChangeText={(v) =>
                setGstin(v.replace(/\s/g, '').toUpperCase().slice(0, 15))
              }
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
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'characters' | 'words';
  secureTextEntry?: boolean;
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
        secureTextEntry={secureTextEntry}
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
    overflow: 'hidden',
    padding: 14,
  },
  payoutStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: -14,
    marginTop: -14,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  payoutStripText: {
    fontFamily: fonts.semiBold,
    fontSize: 12,
    color: '#FFFFFF',
    flex: 1,
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
  empty: { fontFamily: fonts.medium, fontSize: 13, color: '#6B7280', lineHeight: 18 },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
    marginBottom: 4,
  },
  emptyBox: { gap: 8, paddingTop: 4 },
  holder: { fontFamily: fonts.bold, fontSize: 16, color: '#111827' },
  rowText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#111827' },
  hint: { fontFamily: fonts.medium, fontSize: 12, color: '#6B7280', marginTop: 2 },
  retry: { fontFamily: fonts.semiBold, fontSize: 13, color: authTheme.brand },
  retryBox: { paddingVertical: 8 },
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
  maskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  maskLabel: { fontFamily: fonts.semiBold, fontSize: 12, color: '#64748B' },
  maskValue: { fontFamily: fonts.bold, fontSize: 15, color: '#111827', letterSpacing: 0.4 },
  warnNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 10,
  },
  warnNoteText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 12,
    color: '#92400E',
    lineHeight: 17,
  },
  primaryBtn: {
    marginTop: 4,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnMuted: { backgroundColor: '#FDBA74' },
  primaryText: { fontFamily: fonts.semiBold, fontSize: 14, color: '#FFFFFF' },
  steps: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    marginTop: 4,
  },
  stepItem: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNum: { fontFamily: fonts.bold, fontSize: 9, color: '#94A3B8' },
  stepLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    color: '#94A3B8',
    marginLeft: 4,
  },
  stepLabelOn: { color: '#166534', fontFamily: fonts.semiBold },
  stepLine: { flex: 1, height: 2, marginHorizontal: 6, borderRadius: 1 },
  taxGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  taxTile: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
  },
  taxTileWide: { width: '100%' },
  tileLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  tileValue: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: '#111827',
    marginTop: 4,
  },
  groupLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 11,
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
    marginBottom: 2,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F3F4F6',
  },
  downloadHit: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
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
  link: { fontFamily: fonts.semiBold, fontSize: 13, color: authTheme.brand, marginBottom: 10 },
  saveBtn: {
    marginTop: 4,
    backgroundColor: authTheme.brand,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: { fontFamily: fonts.semiBold, fontSize: 15, color: '#FFFFFF' },
});
