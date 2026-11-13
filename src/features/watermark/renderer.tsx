// Web watermark renderer: draws onto an HTML canvas (react-native-view-shot needs html2canvas-pro
// on web, which is not installed, so it is never imported here). Produces a JPEG data URL.
// If canvas is unavailable it reports failure and the queue skips the photo.
import { useEffect } from 'react';

import { getPhotoStore } from '@/data';

import type { WatermarkJob, WatermarkRendererProps } from './types';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

async function renderWeb(job: WatermarkJob): Promise<string | null> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  const img = await loadImage(job.uri);
  const w = img.naturalWidth || job.width;
  const h = img.naturalHeight || job.height;
  if (!w || !h) return null;
  const scale = Math.min(1, 2048 / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cw, ch);

  const fs = Math.max(12, Math.round(cw * 0.028));
  const lh = Math.round(fs * 1.35);
  const padX = Math.round(fs * 0.7);
  const padY = Math.round(fs * 0.45);
  const barH = padY * 2 + lh * job.lines.length;
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  ctx.fillRect(0, ch - barH, cw, barH);
  ctx.textBaseline = 'top';
  job.lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 800 : 600} ${i === 0 ? Math.round(fs * 1.1) : fs}px system-ui, -apple-system, Roboto, sans-serif`;
    ctx.fillStyle = i === 0 ? '#FFB020' : '#FFFFFF';
    ctx.fillText(line, padX, ch - barH + padY + i * lh, cw - padX * 2);
  });
  ctx.font = `700 ${Math.round(fs * 0.75)}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textAlign = 'right';
  ctx.fillText('LineMap Pro', cw - padX, ch - barH + padY);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export function WatermarkRenderer({ job, onDone }: WatermarkRendererProps) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const dataUrl = await renderWeb(job);
        if (!dataUrl) return !cancelled && onDone(null);
        let uri = dataUrl;
        try {
          uri = await getPhotoStore().persist(dataUrl, `${job.photoId}-wm`);
        } catch {
          uri = dataUrl;
        }
        if (!cancelled) onDone(uri);
      } catch {
        if (!cancelled) onDone(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.photoId, job.signature]);
  return null;
}
