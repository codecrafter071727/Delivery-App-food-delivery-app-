import * as ImagePicker from 'expo-image-picker';
import {
  Camera,
  ImageIcon,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { authTheme } from '@/constants/auth-theme';
import { fonts } from '@/constants/typography';
import { getApiErrorMessage } from '@/lib/errors';
import {
  RESTAURANT_PHOTO,
  type RestaurantDetail,
  type RestaurantGalleryImage,
} from '@/lib/restaurant/settings-types';

type UploadFile = {
  uri: string;
  fileName: string;
  mimeType: string;
};

type Props = {
  detail: RestaurantDetail;
  busy: boolean;
  onUploadLogo: (file: UploadFile) => Promise<unknown> | void;
  onUploadCover: (file: UploadFile) => Promise<unknown> | void;
  onUploadGallery: (files: UploadFile[]) => Promise<unknown> | void;
  onDeleteImage: (image: RestaurantGalleryImage) => Promise<unknown> | void;
};

function mimeFromAsset(asset: ImagePicker.ImagePickerAsset) {
  const mime = (asset.mimeType || '').toLowerCase();
  if (mime) return mime;
  const name = (asset.fileName || asset.uri).toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function validateAssets(assets: ImagePicker.ImagePickerAsset[]) {
  const allowed = new Set<string>(RESTAURANT_PHOTO.mimeTypes);
  for (const asset of assets) {
    const mime = mimeFromAsset(asset);
    if (mime.includes('heic') || mime.includes('heif')) {
      throw new Error('Use JPEG, PNG, or WebP. HEIC photos are not accepted.');
    }
    if (!allowed.has(mime) && !mime.startsWith('image/jpeg')) {
      throw new Error('Only JPEG, PNG, and WebP photos are allowed.');
    }
    if (asset.fileSize && asset.fileSize > RESTAURANT_PHOTO.maxBytes) {
      throw new Error('Each photo must be under 5 MB.');
    }
  }
}

function toUpload(asset: ImagePicker.ImagePickerAsset): UploadFile {
  const mime = mimeFromAsset(asset);
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return {
    uri: asset.uri,
    fileName: asset.fileName || `photo-${Date.now()}.${ext}`,
    mimeType: mime.startsWith('image/') ? mime : 'image/jpeg',
  };
}

async function requestLibrary() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      'Photo access needed',
      'Allow photo library access so you can upload cover and gallery photos.'
    );
    return false;
  }
  return true;
}

async function requestCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      'Camera needed',
      'Allow camera access to shoot a cover or gallery photo.'
    );
    return false;
  }
  return true;
}

export function RestaurantPhotosManager({
  detail,
  busy,
  onUploadLogo,
  onUploadCover,
  onUploadGallery,
  onDeleteImage,
}: Props) {
  const { width } = useWindowDimensions();
  const gallery = detail.images ?? [];
  const remaining = Math.max(0, RESTAURANT_PHOTO.maxGallery - gallery.length);
  const tile = Math.floor((width - 16 * 2 - 14 * 2 - 8 * 2) / 3);
  const [preview, setPreview] = useState<string | null>(null);
  const [localCover, setLocalCover] = useState<string | null>(null);

  const coverUri = localCover || detail.coverUrl;
  const countLabel = useMemo(
    () => `${gallery.length}/${RESTAURANT_PHOTO.maxGallery} photos`,
    [gallery.length]
  );

  const pickCover = (source: 'library' | 'camera') => {
    void (async () => {
      try {
        const ok =
          source === 'camera' ? await requestCamera() : await requestLibrary();
        if (!ok) return;
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.85,
                allowsEditing: true,
                aspect: [16, 9],
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.85,
                allowsMultipleSelection: false,
                allowsEditing: true,
                aspect: [16, 9],
              });
        if (result.canceled || !result.assets[0]) return;
        validateAssets(result.assets);
        const file = toUpload(result.assets[0]);
        setLocalCover(file.uri);
        await onUploadCover(file);
        setLocalCover(null);
      } catch (error) {
        setLocalCover(null);
        Alert.alert(
          'Cover not saved',
          getApiErrorMessage(error, 'Could not upload cover photo')
        );
      }
    })();
  };

  const pickLogo = () => {
    void (async () => {
      try {
        if (!(await requestLibrary())) return;
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          allowsMultipleSelection: false,
          allowsEditing: true,
          aspect: [1, 1],
        });
        if (result.canceled || !result.assets[0]) return;
        validateAssets(result.assets);
        await onUploadLogo(toUpload(result.assets[0]));
      } catch (error) {
        Alert.alert(
          'Logo not saved',
          getApiErrorMessage(error, 'Could not upload logo')
        );
      }
    })();
  };

  const pickGallery = (source: 'library' | 'camera') => {
    void (async () => {
      try {
        if (remaining <= 0) {
          Alert.alert(
            'Gallery full',
            `You can keep up to ${RESTAURANT_PHOTO.maxGallery} outlet photos.`
          );
          return;
        }
        const ok =
          source === 'camera' ? await requestCamera() : await requestLibrary();
        if (!ok) return;
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.85,
              })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.85,
                allowsMultipleSelection: true,
                selectionLimit: remaining,
              });
        if (result.canceled || !result.assets.length) return;
        const assets = result.assets.slice(0, remaining);
        validateAssets(assets);
        await onUploadGallery(assets.map(toUpload));
      } catch (error) {
        Alert.alert(
          'Photos not saved',
          getApiErrorMessage(error, 'Could not upload gallery photos')
        );
      }
    })();
  };

  const askSource = (kind: 'cover' | 'gallery') => {
    Alert.alert(
      kind === 'cover' ? 'Cover photo' : 'Outlet photos',
      'JPEG, PNG or WebP · max 5 MB each',
      [
        {
          text: 'Take photo',
          onPress: () =>
            kind === 'cover' ? pickCover('camera') : pickGallery('camera'),
        },
        {
          text: 'Choose from gallery',
          onPress: () =>
            kind === 'cover' ? pickCover('library') : pickGallery('library'),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const confirmDelete = (image: RestaurantGalleryImage) => {
    Alert.alert(
      'Remove photo?',
      'Customers will no longer see this photo on your restaurant page.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void Promise.resolve(onDeleteImage(image)).catch((error) => {
              Alert.alert(
                'Could not remove photo',
                getApiErrorMessage(error, 'Try again in a moment.')
              );
            });
          },
        },
      ]
    );
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={styles.card}>
        <Text style={styles.kicker}>Customer view</Text>
        <Text style={styles.title}>Cover photo</Text>
        <Text style={styles.hint}>
          This is the first image on search and the restaurant page. Use a wide
          food or storefront shot.
        </Text>

        <Pressable
          disabled={busy}
          onPress={() => askSource('cover')}
          style={styles.coverWrap}
        >
          {coverUri ? (
            <Image source={{ uri: coverUri }} style={styles.coverImage} />
          ) : (
            <View style={styles.coverEmpty}>
              <ImageIcon color={authTheme.textDim} size={28} />
              <Text style={styles.coverEmptyTitle}>Add a cover photo</Text>
              <Text style={styles.coverEmptyHint}>16:9 · JPEG / PNG / WebP</Text>
            </View>
          )}
          <View style={styles.coverScrim} />
          <View style={styles.coverCta}>
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Camera color="#FFFFFF" size={16} />
                <Text style={styles.coverCtaText}>
                  {coverUri ? 'Change cover' : 'Upload cover'}
                </Text>
              </>
            )}
          </View>
        </Pressable>

        <View style={styles.logoRow}>
          <Pressable
            disabled={busy}
            onPress={pickLogo}
            style={styles.logoBtn}
            accessibilityLabel="Change logo"
          >
            {detail.logoUrl ? (
              <Image source={{ uri: detail.logoUrl }} style={styles.logoImage} />
            ) : (
              <View style={styles.logoEmpty}>
                <Plus color={authTheme.brand} size={18} />
              </View>
            )}
            <View style={styles.logoEdit}>
              <Pencil color="#FFFFFF" size={10} />
            </View>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.logoTitle}>{detail.name || 'Your restaurant'}</Text>
            <Text style={styles.hint}>
              Logo sits on the cover, like Swiggy and Zomato. Square crop, max 5 MB.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.galleryHead}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Outlet photos</Text>
            <Text style={styles.hint}>
              Kitchen, packaging, and dining area. Up to {RESTAURANT_PHOTO.maxGallery} photos.
            </Text>
          </View>
          <Text style={styles.count}>{countLabel}</Text>
        </View>

        <View style={styles.grid}>
          {gallery.map((image) => (
            <View key={image.id} style={[styles.tile, { width: tile, height: tile }]}>
              <Pressable onPress={() => setPreview(image.url)} style={StyleSheet.absoluteFill}>
                <Image source={{ uri: image.url }} style={styles.tileImage} />
              </Pressable>
              <Pressable
                onPress={() => confirmDelete(image)}
                disabled={busy}
                style={styles.deleteBtn}
                accessibilityLabel="Remove photo"
              >
                <Trash2 color="#FFFFFF" size={13} />
              </Pressable>
            </View>
          ))}
          {remaining > 0 ? (
            <Pressable
              disabled={busy}
              onPress={() => askSource('gallery')}
              style={[styles.addTile, { width: tile, height: tile }]}
            >
              {busy ? (
                <ActivityIndicator color={authTheme.brand} />
              ) : (
                <>
                  <Plus color={authTheme.brand} size={22} />
                  <Text style={styles.addText}>Add photos</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      </View>

      <Modal
        visible={Boolean(preview)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <Pressable style={styles.previewScrim} onPress={() => setPreview(null)}>
          {preview ? (
            <Image source={{ uri: preview }} style={styles.previewImage} resizeMode="contain" />
          ) : null}
          <Pressable style={styles.previewClose} onPress={() => setPreview(null)}>
            <X color="#FFFFFF" size={18} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: authTheme.cardBorder,
    padding: 14,
    gap: 10,
  },
  kicker: {
    color: authTheme.textMuted,
    fontSize: 11,
    fontFamily: fonts.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    color: authTheme.text,
    fontSize: 18,
    fontFamily: fonts.extraBold,
    letterSpacing: -0.3,
  },
  hint: {
    color: authTheme.textMuted,
    fontSize: 12,
    fontFamily: fonts.medium,
    lineHeight: 17,
  },
  coverWrap: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
  },
  coverImage: { width: '100%', height: '100%' },
  coverEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: authTheme.brandSoft,
  },
  coverEmptyTitle: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  coverEmptyHint: {
    color: authTheme.textMuted,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  coverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.18)',
  },
  coverCta: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15,23,42,0.72)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  coverCtaText: {
    color: '#FFFFFF',
    fontFamily: fonts.bold,
    fontSize: 12,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  logoBtn: {
    width: 64,
    height: 64,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    marginTop: -28,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  logoImage: { width: '100%', height: '100%' },
  logoEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: authTheme.brandSoft,
  },
  logoEdit: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: authTheme.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTitle: {
    color: authTheme.text,
    fontFamily: fonts.bold,
    fontSize: 15,
  },
  galleryHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  count: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 12,
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tile: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
  },
  tileImage: { width: '100%', height: '100%' },
  deleteBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(15,23,42,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(234,75,20,0.35)',
    backgroundColor: authTheme.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addText: {
    color: authTheme.brand,
    fontFamily: fonts.bold,
    fontSize: 11,
  },
  previewScrim: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  previewImage: { width: '100%', height: '80%' },
  previewClose: {
    position: 'absolute',
    top: 48,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
