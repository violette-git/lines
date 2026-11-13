// Node photos: large preview, original/watermarked toggle, thumbnails, set primary, add more.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Segmented, T } from '@/components/ui';
import type { PhotoRef } from '@/domain/types';
import { usePhotoUri } from '@/sync';
import { colors, radius, space } from '@/theme';

export function PhotoStrip({
  photos,
  onAddCamera,
  onAddLibrary,
  onSetPrimary,
  adding,
  readOnly,
}: {
  photos: PhotoRef[];
  onAddCamera: () => void;
  onAddLibrary: () => void;
  onSetPrimary: (photoId: string) => void;
  adding: boolean;
  /** Hides add and set-primary actions (view-only roles). */
  readOnly?: boolean;
}) {
  const sorted = [...photos].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.takenAt.localeCompare(b.takenAt));
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.id ?? null);
  const [view, setView] = useState<'original' | 'watermarked'>('watermarked');
  const selected = sorted.find((p) => p.id === selectedId) ?? sorted[0] ?? null;

  useEffect(() => {
    if (!selectedId && sorted[0]) setSelectedId(sorted[0].id);
  }, [selectedId, sorted]);

  // Company photos from other phones download on demand (usePhotoUri); local ones show at once.
  const hasStamp = !!(selected?.watermarkedUri || selected?.watermarkedPath);
  const shown = usePhotoUri(selected, { watermarked: view === 'watermarked' && hasStamp });
  const uri = shown.uri;
  const aspect = selected && selected.width > 0 && selected.height > 0 ? selected.width / selected.height : 4 / 3;

  return (
    <View style={{ gap: space.sm }}>
      {selected && !uri && shown.loading ? (
        <View style={[styles.preview, styles.empty]}>
          <ActivityIndicator color={colors.accent} />
          <T color={colors.textMuted}>Loading photo...</T>
        </View>
      ) : selected && uri ? (
        <View style={[styles.preview, { aspectRatio: Math.max(0.6, Math.min(1.8, aspect)) }]}>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
          {selected.isPrimary ? (
            <View style={styles.primaryTag}>
              <Ionicons name="star" size={12} color={colors.onAccent} />
              <T v="caption" color={colors.onAccent} style={{ fontWeight: '800' }}>
                Primary
              </T>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.preview, styles.empty]}>
          <Ionicons name="camera-outline" size={36} color={colors.textFaint} />
          <T color={colors.textMuted}>No photo yet</T>
        </View>
      )}

      {selected ? (
        <View style={styles.row}>
          {hasStamp ? (
            <View style={{ flex: 1 }}>
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'watermarked', label: 'Stamped' },
                  { value: 'original', label: 'Original' },
                ]}
              />
            </View>
          ) : (
            <T v="caption" color={colors.textFaint} style={{ flex: 1 }}>
              GPS stamp pending or off
            </T>
          )}
          {!selected.isPrimary && !readOnly ? (
            <Button title="Set primary" icon="star-outline" kind="secondary" compact onPress={() => onSetPrimary(selected.id)} />
          ) : null}
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {sorted.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={p.isPrimary ? 'Primary photo' : 'Photo'}
            onPress={() => setSelectedId(p.id)}
            style={[styles.thumbWrap, p.id === selected?.id && { borderColor: colors.accent }]}
          >
            <Thumb photo={p} />
            {p.isPrimary ? (
              <View style={styles.star}>
                <Ionicons name="star" size={12} color={colors.accent} />
              </View>
            ) : null}
          </Pressable>
        ))}
        {readOnly ? null : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take another photo"
              onPress={onAddCamera}
              disabled={adding}
              style={[styles.thumbWrap, styles.addTile]}
            >
              <Ionicons name="camera" size={24} color={colors.text} />
              <T v="caption">Camera</T>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add photo from library"
              onPress={onAddLibrary}
              disabled={adding}
              style={[styles.thumbWrap, styles.addTile]}
            >
              <Ionicons name="images-outline" size={24} color={colors.text} />
              <T v="caption">Library</T>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Thumb({ photo }: { photo: PhotoRef }) {
  const { uri } = usePhotoUri(photo, { watermarked: true });
  return uri ? <Image source={{ uri }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: colors.surfaceAlt }]} />;
}

const styles = StyleSheet.create({
  preview: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.border,
  },
  empty: { aspectRatio: 16 / 9, alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.surfaceAlt },
  primaryTag: {
    position: 'absolute',
    top: space.sm,
    left: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  thumbWrap: {
    width: 76,
    height: 76,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    overflow: 'hidden',
    backgroundColor: colors.surfaceAlt,
  },
  thumb: { width: '100%', height: '100%' },
  star: { position: 'absolute', top: 4, right: 4, backgroundColor: colors.overlay, borderRadius: 8, padding: 2 },
  addTile: { alignItems: 'center', justifyContent: 'center', gap: 4, borderStyle: 'dashed' },
});
