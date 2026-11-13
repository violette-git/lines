// Background watermark queue. Mount it in any screen (capture, map); only one job runs at a time
// across all mounted instances. Jobs start after a short idle delay so they never compete with the
// shutter, and a photo is re-rendered if its node label or project details change later.
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';

import { getPhotoStore } from '@/data';
import { useStore } from '@/state/store';

import { WatermarkRenderer } from './renderer';
import { buildWatermarkJob, type WatermarkJob } from './types';

interface QueueState {
  busy: boolean;
  /** photoId -> signature that is already burned in. */
  done: Record<string, string>;
  /** photoId -> failed attempts. */
  failed: Record<string, number>;
  setBusy(b: boolean): void;
  markDone(id: string, sig: string): void;
  markFailed(id: string): void;
}

const useQueue = create<QueueState>((set) => ({
  busy: false,
  done: {},
  failed: {},
  setBusy: (busy) => set({ busy }),
  markDone: (id, sig) => set((s) => ({ done: { ...s.done, [id]: sig } })),
  markFailed: (id) => set((s) => ({ failed: { ...s.failed, [id]: (s.failed[id] ?? 0) + 1 } })),
}));

const MAX_ATTEMPTS = 2;
const IDLE_DELAY_MS = 1200;

export function useWatermarkEnabled(): boolean {
  return useStore((s) => {
    const p = s.projects.find((x) => x.id === s.activeProjectId);
    const t = p?.templateId ? s.templates.find((x) => x.id === p.templateId) : null;
    return s.settings.watermarkPhotos || t?.watermarkPhotos === true;
  });
}

export function WatermarkQueue() {
  const enabled = useWatermarkEnabled();
  const photos = useStore((s) => s.photos);
  const nodes = useStore((s) => s.nodes);
  const project = useStore((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null);
  const units = useStore((s) => s.settings.units);
  const setPhotoWatermark = useStore((s) => s.setPhotoWatermark);
  const busy = useQueue((s) => s.busy);
  const done = useQueue((s) => s.done);
  const failed = useQueue((s) => s.failed);
  const [job, setJob] = useState<WatermarkJob | null>(null);

  const next = useMemo<WatermarkJob | null>(() => {
    if (!enabled || !project) return null;
    for (const photo of photos) {
      if ((failed[photo.id] ?? 0) >= MAX_ATTEMPTS) continue;
      const node = nodes.find((n) => n.id === photo.nodeId);
      if (!node) continue;
      const j = buildWatermarkJob(photo, node, project, units);
      const burned = done[photo.id];
      if (photo.watermarkedUri && burned === undefined) continue; // from a previous session: trust it
      if (photo.watermarkedUri && burned === j.signature) continue;
      if (!photo.watermarkedUri && burned === j.signature) continue;
      return j;
    }
    return null;
  }, [enabled, project, photos, nodes, units, done, failed]);

  // Adopt previously watermarked photos so they are not re-rendered on every app start.
  useEffect(() => {
    if (!project) return;
    const st = useQueue.getState();
    for (const photo of photos) {
      if (photo.watermarkedUri && st.done[photo.id] === undefined) {
        const node = nodes.find((n) => n.id === photo.nodeId);
        if (node) st.markDone(photo.id, buildWatermarkJob(photo, node, project, units).signature);
      }
    }
    // Only on first sight of a photo list for the project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, photos.length]);

  useEffect(() => {
    if (job || busy || !next) return;
    const t = setTimeout(() => {
      if (useQueue.getState().busy) return;
      useQueue.getState().setBusy(true);
      setJob(next);
    }, IDLE_DELAY_MS);
    return () => clearTimeout(t);
  }, [job, busy, next]);

  // Release the global lock if this screen unmounts mid-job; another queue picks it up.
  const jobRef = useRef<WatermarkJob | null>(null);
  jobRef.current = job;
  useEffect(() => {
    return () => {
      if (jobRef.current) useQueue.getState().setBusy(false);
    };
  }, []);

  if (!job) return null;

  return (
    <WatermarkRenderer
      key={`${job.photoId}:${job.signature}`}
      job={job}
      onDone={async (uri) => {
        const q = useQueue.getState();
        if (uri) {
          const prev = useStore.getState().photos.find((p) => p.id === job.photoId)?.watermarkedUri;
          try {
            await setPhotoWatermark(job.photoId, uri);
            q.markDone(job.photoId, job.signature);
            if (prev && prev !== uri) getPhotoStore().remove(prev).catch(() => {});
          } catch {
            q.markFailed(job.photoId);
          }
        } else {
          q.markFailed(job.photoId);
        }
        q.setBusy(false);
        setJob(null);
      }}
    />
  );
}
