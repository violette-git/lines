// Photo import helpers built on expo-image-picker (works on native and web).
import * as ImagePicker from 'expo-image-picker';

import type { GeoFix } from '@/domain/types';

import { fixFromExif } from './exif';
import { shrinkPhoto, type ProcessedPhoto } from './processPhoto';

export interface PickedPhoto extends ProcessedPhoto {
  /** GPS from the photo's EXIF, if present. */
  exifFix: GeoFix | null;
}

export async function pickFromLibrary(): Promise<PickedPhoto | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    exif: true,
    quality: 1,
    allowsMultipleSelection: false,
  });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const exifFix = fixFromExif((a.exif ?? null) as Record<string, unknown> | null);
  const out = await shrinkPhoto(a.uri, a.width, a.height);
  return { ...out, exifFix };
}

export async function takeWithSystemCamera(): Promise<PickedPhoto | null> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission is off. Enable it in Settings to take photos.');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Camera permission')) throw e;
    // Web: permission API may not exist; the file input still works.
  }
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0];
  const out = await shrinkPhoto(a.uri, a.width, a.height);
  return { ...out, exifFix: null };
}
