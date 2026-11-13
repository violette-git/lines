// Tiny data-loading hook for dashboard pages: runs a loader against the admin API whenever its
// inputs change, ignores stale responses, and exposes reload().
import { useCallback, useEffect, useRef, useState } from 'react';

import { getAdminApi, type AdminApi } from './api';

export interface AdminData<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useAdminData<T>(
  load: ((api: AdminApi) => Promise<T>) | null,
  deps: readonly unknown[],
): AdminData<T> {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: load != null,
  });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const fn = loadRef.current;
    if (!fn) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const api = getAdminApi();
    if (!api) {
      setState({ data: null, error: 'The company backend is not configured for this website.', loading: false });
      return;
    }
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn(api).then(
      (data) => {
        if (my === seq.current) setState({ data, error: null, loading: false });
      },
      (err: unknown) => {
        if (my === seq.current) setState((s) => ({ data: s.data, error: err instanceof Error ? err.message : String(err), loading: false }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, load == null]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
