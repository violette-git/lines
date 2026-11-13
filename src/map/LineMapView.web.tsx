// Web preview: runs the shared engine directly in the page with the npm maplibre-gl build.
import * as maplibregl from 'maplibre-gl';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { LineMapViewProps } from '@/domain/contracts';

import { createLineMap, installInlineWorker, type LineMapController } from './core/mapCore';
import { useCoreState } from './coreState';
import { MAPLIBRE_CSS } from './generated/maplibreCss';
import { MAPLIBRE_WORKER_JS } from './generated/maplibreWorker';
import { dispatchCoreEvent, useLatest, useTokenEffect, type LineMapHandle } from './shared';

const CSS_ID = 'maplibre-gl-css';

function ensureMaplibreCss(): void {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  const el = document.createElement('style');
  el.id = CSS_ID;
  el.textContent = MAPLIBRE_CSS;
  document.head.appendChild(el);
}

function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

const hostStyle = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const;

export const LineMapView = forwardRef<LineMapHandle, LineMapViewProps>(function LineMapView(props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const ctlRef = useRef<LineMapController | null>(null);
  const propsRef = useLatest(props);
  const coreState = useCoreState(props);
  const stateRef = useLatest(coreState);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    ensureMaplibreCss();
    // Worker comes from inline source: the npm worker file is not served by Metro.
    installInlineWorker(maplibregl, MAPLIBRE_WORKER_JS);
    const ctl = createLineMap(
      host,
      maplibregl,
      (ev) => {
        dispatchCoreEvent(ev, propsRef.current, openUrl);
      },
      { showZoomButtons: true },
    );
    ctlRef.current = ctl;
    ctl.setState(stateRef.current);
    return () => {
      ctl.destroy();
      ctlRef.current = null;
    };
  }, [propsRef, stateRef]);

  useEffect(() => {
    ctlRef.current?.setState(coreState);
  }, [coreState]);

  useTokenEffect(props.fitToken, () => ctlRef.current?.fit(true));
  useTokenEffect(props.centerOnUserToken, () => {
    const u = propsRef.current.userLocation;
    if (u) ctlRef.current?.centerOn(u.lat, u.lng);
  });

  useImperativeHandle(
    ref,
    () => ({
      snapshot: () => (ctlRef.current ? ctlRef.current.snapshot() : Promise.resolve(null)),
    }),
    [],
  );

  return (
    <View style={styles.root}>
      <div ref={hostRef} style={hostStyle} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#0B0F14' },
});
