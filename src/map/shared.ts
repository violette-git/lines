// Glue shared by LineMapView (native WebView) and LineMapView.web (direct DOM).
import { useEffect, useRef } from 'react';

import type { LineMapViewProps } from '@/domain/contracts';

import type { CoreEvent } from './core/mapCore';

/** Imperative handle exposed by both platform LineMapView components via ref. */
export interface LineMapHandle {
  /** JPEG data URL of the current map view (basemap, lines, nodes, labels), or null if unavailable. */
  snapshot(): Promise<string | null>;
}

type Callbacks = Pick<LineMapViewProps, 'onNodePress' | 'onNodeMoved' | 'onSpanPress' | 'onMapPress' | 'onMapLongPress'>;

/** Routes engine events to the LineMapViewProps callbacks. Returns true when handled. */
export function dispatchCoreEvent(ev: CoreEvent, cb: Callbacks, openUrl: (url: string) => void): boolean {
  switch (ev.type) {
    case 'nodePress':
      cb.onNodePress(ev.id);
      return true;
    case 'nodeMoved':
      cb.onNodeMoved(ev.id, { lat: ev.lat, lng: ev.lng });
      return true;
    case 'spanPress':
      cb.onSpanPress(ev.id);
      return true;
    case 'mapPress':
      cb.onMapPress({ lat: ev.lat, lng: ev.lng });
      return true;
    case 'mapLongPress':
      cb.onMapLongPress?.({ lat: ev.lat, lng: ev.lng });
      return true;
    case 'openUrl':
      if (/^https?:\/\//i.test(ev.url)) openUrl(ev.url);
      return true;
    case 'error':
      if (__DEV__) console.warn('[LineMap]', ev.message);
      return true;
    case 'loaded':
      return true;
    default:
      return false;
  }
}

/** Runs `fn` whenever `token` changes after the first render (tokens are "increment to trigger"). */
export function useTokenEffect(token: number, fn: () => void): void {
  const last = useRef(token);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  useEffect(() => {
    if (last.current === token) return;
    last.current = token;
    fnRef.current();
  }, [token]);
}

/** Ref that always holds the latest value (for callbacks used from long-lived listeners). */
export function useLatest<T>(value: T): { readonly current: T } {
  const r = useRef(value);
  useEffect(() => {
    r.current = value;
  });
  return r;
}
