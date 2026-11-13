// Re-samples GPS for a node (stand at the asset, average N seconds, replace the position).
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from '@/features/common/confirm';
import { successHaptic, errorHaptic } from '@/features/common/haptics';
import type { GeoFix } from '@/domain/types';
import { sampleGps } from '@/geo/gpsSampler';
import { useStore } from '@/state/store';

export interface RecalibrateState {
  running: boolean;
  progress: number;
  samples: number;
  latest: GeoFix | null;
  error: string | null;
  start(nodeId: string): Promise<GeoFix | null>;
  cancel(): void;
}

export function useRecalibrate(): RecalibrateState {
  const seconds = Math.max(3, useStore((s) => s.settings.gpsAverageSeconds) || 4) + 2;
  const recalibrateNode = useStore((s) => s.recalibrateNode);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [samples, setSamples] = useState(0);
  const [latest, setLatest] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(
    async (nodeId: string) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      setRunning(true);
      setProgress(0);
      setSamples(0);
      setLatest(null);
      setError(null);
      const t0 = Date.now();
      const timer = setInterval(() => setProgress(Math.min(0.98, (Date.now() - t0) / (seconds * 1000))), 100);
      try {
        const fix = await sampleGps(
          seconds,
          (f, n) => {
            setLatest(f);
            setSamples(n);
          },
          ctl.signal,
        );
        await recalibrateNode(nodeId, fix);
        setProgress(1);
        successHaptic();
        return fix;
      } catch (e) {
        if (!(e instanceof Error && e.name === 'AbortError')) {
          setError(errorMessage(e));
          errorHaptic();
        }
        return null;
      } finally {
        clearInterval(timer);
        setRunning(false);
        if (abort.current === ctl) abort.current = null;
      }
    },
    [seconds, recalibrateNode],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  return { running, progress, samples, latest, error, start, cancel };
}
