import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileText,
  Upload,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDeliveryHeaderScrollProps } from '@/components/delivery/shared/header-scroll';
import { authTheme, PARTNER_BOTTOM_NAV_INSET } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useDeliveryPartnerMe,
  useUploadPartnerDocument,
} from '@/lib/delivery-partner/hooks';
import {
  PARTNER_DOC_TYPES,
  displayDocumentStatus,
  normalizeDocStatus,
} from '@/lib/delivery-partner/documents-types';
import type {
  PartnerDocument,
  PartnerDocumentStatus,
  PartnerDocumentType,
} from '@/lib/delivery-partner/documents-types';

function statusMeta(status: PartnerDocumentStatus) {
  const s = normalizeDocStatus(status);
  if (s === 'verified') {
    return {
      label: 'Verified',
      color: '#15803D',
      bg: '#DCFCE7',
      Icon: CheckCircle2,
    };
  }
  if (s === 'pending') {
    return {
      label: 'Under Review',
      color: '#B45309',
      bg: '#FEF3C7',
      Icon: Clock3,
    };
  }
  if (s === 'rejected') {
    return {
      label: 'Rejected',
      color: '#B91C1C',
      bg: '#FEE2E2',
      Icon: AlertCircle,
    };
  }
  return {
    label: 'Not Uploaded',
    color: authTheme.textMuted,
    bg: '#F1F5F9',
    Icon: FileText,
  };
}

function DocCard({
  label,
  hint,
  doc,
  uploading,
  onUpload,
}: {
  label: string;
  hint: string;
  doc?: PartnerDocument;
  uploading: boolean;
  onUpload: () => void;
}) {
  const status = displayDocumentStatus(doc);
  const meta = statusMeta(status);
  const StatusIcon = meta.Icon;
  const hasFile = Boolean(doc?.url);
  const canReupload = status !== 'verified';

  return (
    <View style={styles.docCard}>
      <View style={styles.docTop}>
        <View style={{ flex: 1, paddingRight: 6 }}>
          <Text style={styles.docTitle} numberOfLines={2}>
            {label}
          </Text>
          <Text style={styles.docHint} numberOfLines={2}>
            {hint}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <StatusIcon color={meta.color} size={11} />
          <Text
            style={{
              color: meta.color,
              fontFamily: fonts.semiBold,
              fontSize: 10,
            }}
            numberOfLines={1}
          >
            {meta.label}
          </Text>
        </View>
      </View>

      {hasFile ? (
        <Image
          source={{ uri: doc!.url }}
          style={styles.preview}
          contentFit="cover"
        />
      ) : (
        <View style={styles.previewEmpty}>
          <FileText color={authTheme.textDim} size={22} />
        </View>
      )}

      {status === 'rejected' && doc?.rejectionReason ? (
        <Text style={styles.rejectReason} numberOfLines={3}>
          {doc.rejectionReason}
        </Text>
      ) : null}

      <Pressable
        onPress={onUpload}
        disabled={uploading || !canReupload}
        style={styles.uploadHit}
      >
        <View
          style={[
            styles.uploadBtn,
            {
              backgroundColor: canReupload
                ? authTheme.brand
                : authTheme.textDim,
            },
          ]}
        >
          {uploading ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : (
            <>
              <Upload color="#FFFFFF" size={14} />
              <Text style={styles.uploadText}>
                {hasFile ? 'Re-upload' : 'Upload'}
              </Text>
            </>
          )}
        </View>
      </Pressable>
    </View>
  );
}

export function PartnerDocumentsManager() {
  const insets = useSafeAreaInsets();
  const headerScroll = useDeliveryHeaderScrollProps();
  const { width } = useWindowDimensions();

  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [uploadingType, setUploadingType] = useState<PartnerDocumentType | null>(
    null
  );

  const me = useDeliveryPartnerMe();
  const upload = useUploadPartnerDocument();

  const documents = me.data?.documents;
  const verifiedCount = useMemo(
    () =>
      PARTNER_DOC_TYPES.filter(
        (d) => displayDocumentStatus(documents?.[d.type]) === 'verified'
      ).length,
    [documents]
  );
  const totalDocs = PARTNER_DOC_TYPES.length;

  const loading = me.isLoading && !me.data;
  const error =
    me.isError && !me.data
      ? getApiErrorMessage(me.error, 'Could not load documents.')
      : null;

  const onRefresh = async () => {
    setPullRefreshing(true);
    try {
      await me.refetch();
    } finally {
      setPullRefreshing(false);
    }
  };

  const pickAndUpload = async (docType: PartnerDocumentType) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        'Allow photo access to upload documents.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;

    const asset = result.assets[0];
    setUploadingType(docType);
    try {
      await upload.mutateAsync({
        docType,
        uri: asset.uri,
        fileName: asset.fileName ?? `${docType}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
      Alert.alert(
        'Uploaded',
        'Document submitted for verification. This usually takes 24–48 hours.'
      );
    } catch (err) {
      Alert.alert(
        'Upload failed',
        getApiErrorMessage(err, 'Could not upload document.')
      );
    } finally {
      setUploadingType(null);
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
            <Text style={styles.muted}>Loading documents…</Text>
          </View>
        ) : error ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>Couldn’t load documents</Text>
            <Text style={styles.muted}>{error}</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.banner}>
              <View style={styles.bannerIcon}>
                <FileText color={authTheme.brand} size={18} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>Document Verification</Text>
                <Text style={styles.bannerBody}>
                  Upload clear photos of all required documents. Verification
                  typically takes 24–48 hours. All {totalDocs} documents must be
                  verified before you can start accepting deliveries.
                </Text>
              </View>
              <View style={styles.countBox}>
                <Text style={styles.countValue}>
                  {verifiedCount}/{totalDocs}
                </Text>
                <Text style={styles.countLabel}>verified</Text>
              </View>
            </View>

            <View style={styles.grid}>
              {PARTNER_DOC_TYPES.map((item) => (
                <DocCard
                  key={item.type}
                  label={item.label}
                  hint={item.hint}
                  doc={documents?.[item.type]}
                  uploading={uploadingType === item.type}
                  onUpload={() => void pickAndUpload(item.type)}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: authTheme.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: authTheme.card,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: authTheme.card,
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
    gap: 14,
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
  banner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: authTheme.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    padding: 16,
  },
  bannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brandSoft,
  },
  bannerTitle: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: authTheme.text,
  },
  bannerBody: {
    marginTop: 4,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: authTheme.textMuted,
  },
  countBox: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 52,
  },
  countValue: {
    fontFamily: fonts.extraBold,
    fontSize: 20,
    color: authTheme.text,
  },
  countLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: authTheme.textDim,
  },
  grid: {
    gap: 16,
  },
  docCard: {
    backgroundColor: authTheme.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    padding: 16,
    gap: 12,
  },
  docTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  docTitle: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: authTheme.text,
  },
  docHint: {
    marginTop: 2,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 14,
    color: authTheme.textMuted,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    maxWidth: 96,
  },
  preview: {
    width: '100%',
    height: 160,
    borderRadius: 16,
    backgroundColor: authTheme.bgSoft,
  },
  previewEmpty: {
    width: '100%',
    height: 160,
    borderRadius: 16,
    backgroundColor: authTheme.bgSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderStyle: 'dashed',
  },
  rejectReason: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: '#B91C1C',
  },
  uploadHit: {
    marginTop: 2,
  },
  uploadBtn: {
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  uploadText: {
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#FFFFFF',
  },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: authTheme.brand,
  },
  retryText: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: '#FFFFFF',
  },
});
