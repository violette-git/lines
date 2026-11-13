// Native watermark renderer: draws the photo plus a data bar in an off-screen view, then
// captures it with react-native-view-shot to a JPEG and copies it into durable storage.
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Image, PixelRatio, Platform, StyleSheet, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { getPhotoStore } from '@/data';

import type { WatermarkRendererProps } from './types';

/** Logical layout width of the off-screen view on Android; the capture is scaled to the photo's pixels. */
const LAYOUT_W = 540;
const MAX_OUT_W = 2048;
const TIMEOUT_MS = 10000;

export function WatermarkRenderer({ job, onDone }: WatermarkRendererProps) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const finished = useRef(false);
  const [loaded, setLoaded] = useState(false);

  const w = job.width > 0 ? job.width : 1600;
  const h = job.height > 0 ? job.height : 1200;
  const outW = Math.min(w, MAX_OUT_W);
  const outH = Math.round((outW * h) / w);
  // iOS view-shot treats width/height as points rendered at device scale, and renderInContext does
  // not scale the layer into that canvas (the photo would land in a corner of a huge black image).
  // So on iOS lay the view out at outW/scale points and capture it at its natural size instead.
  const layoutW = Platform.OS === 'ios' ? Math.max(1, Math.round(outW / PixelRatio.get())) : LAYOUT_W;
  const layoutH = Math.round((layoutW * h) / w);
  const fs = Math.max(11, Math.round(layoutW * 0.028));

  const finish = (uri: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(uri);
  };

  useEffect(() => {
    const t = setTimeout(() => finish(null), TIMEOUT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    // Two frames so the image is actually painted before capture.
    requestAnimationFrame(() =>
      requestAnimationFrame(async () => {
        if (cancelled) return;
        try {
          const tmp = await captureRef(ref, {
            format: 'jpg',
            quality: 0.85,
            result: 'tmpfile',
            ...(Platform.OS === 'ios' ? { useRenderInContext: true } : { width: outW, height: outH }),
          });
          let durable = tmp;
          try {
            durable = await getPhotoStore().persist(tmp, `${job.photoId}-wm-${Date.now()}`);
          } catch {
            durable = tmp;
          }
          if (!cancelled) finish(durable);
        } catch {
          if (!cancelled) finish(null);
        }
      }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  return (
    <View pointerEvents="none" style={styles.host}>
      <View ref={ref} collapsable={false} style={{ width: layoutW, height: layoutH, backgroundColor: '#000' }}>
        <Image
          source={{ uri: job.uri }}
          style={{ width: layoutW, height: layoutH }}
          resizeMode="cover"
          onLoad={() => setLoaded(true)}
          onError={() => finish(null)}
          fadeDuration={0}
        />
        <View style={[styles.bar, { paddingHorizontal: fs * 0.7, paddingVertical: fs * 0.45 }]}>
          {job.lines.map((line, i) => (
            <Text
              key={i}
              numberOfLines={1}
              style={{
                color: i === 0 ? '#FFB020' : '#FFFFFF',
                fontSize: i === 0 ? fs * 1.1 : fs,
                fontWeight: i === 0 ? '800' : '600',
                lineHeight: fs * 1.35,
                fontVariant: ['tabular-nums'],
              }}
            >
              {line}
            </Text>
          ))}
          <Text style={[styles.brand, { fontSize: fs * 0.75, right: fs * 0.7, top: fs * 0.45 }]}>LineMap Pro</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits behind the screen content (rendered first, zIndex -1) so it is laid out and drawable
  // but never visible.
  host: { position: 'absolute', top: 0, left: 0, zIndex: -1, opacity: 1 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.68)' },
  brand: { position: 'absolute', color: 'rgba(255,255,255,0.7)', fontWeight: '700' },
});
