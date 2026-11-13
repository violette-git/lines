// Native (Android/iOS): the shared engine runs inside react-native-webview from a fully inlined
// HTML document (maplibre JS/CSS/worker + compiled mapCore), so the map UI loads with no signal.
// RN -> page: injectJavaScript(window.__lmReceive({type:'state'|'fit'|'center'|'snapshot'|'view'|'tiles'|'reloadTiles', ...}))
// page -> RN: window.ReactNativeWebView.postMessage(JSON.stringify(event))
// Basemap tiles of providers that allow offline caching load through the "lmtile://" protocol: the page
// posts batched {type:'tileReq'} messages and src/offline/tileHost.ts answers from the phone's tile
// cache (saved areas, browsing cache) or the network. An "Offline" badge shows when there is no signal.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type Ref,
} from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import type { LineMapViewProps } from '@/domain/contracts';
import { currentApiKey, nativeTileHostIO, startOfflineMaps } from '@/offline/manager';
import { useOnline } from '@/offline/network';
import { effectiveApiKey, resolveProvider } from '@/offline/providers';
import { TileHost, type TileReplyOut } from '@/offline/tileHost';
import { useTileSettings } from '@/offline/tileSettings';

import type { CoreEvent, CoreView, TileRequestMessage } from './core/mapCore';
import { useCoreState } from './coreState';
import { MAP_HTML } from './generated/mapHtml';
import { dispatchCoreEvent, useLatest, useTokenEffect, type LineMapHandle } from './shared';

type WebViewProps = ComponentProps<typeof WebView>;
type WebViewMessage = Parameters<NonNullable<WebViewProps['onMessage']>>[0];
type ShouldStartLoad = Parameters<NonNullable<WebViewProps['onShouldStartLoadWithRequest']>>[0];

/** The subset of the WebView instance methods used here (the package types the ref as unknown). */
interface WebViewInstance {
  injectJavaScript(script: string): void;
}

const WebViewWithRef = WebView as unknown as ComponentType<WebViewProps & { ref?: Ref<WebViewInstance> }>;

/** Gives the inline document a stable https origin (Blob worker + CORS tiles + untainted snapshots). Never fetched. */
const BASE_URL = 'https://linemap.local/';
const SOURCE = { html: MAP_HTML, baseUrl: BASE_URL };
const ORIGIN_WHITELIST = ['*'];
const SNAPSHOT_TIMEOUT_MS = 10000;
const VIEW_TIMEOUT_MS = 3000;

type PageMessage =
  | CoreEvent
  | { type: 'ready' }
  | { type: 'snapshot'; reqId: number; data: string | null }
  | { type: 'view'; reqId: number; view: CoreView | null }
  | TileRequestMessage;
type HostMessage =
  | { type: 'state'; state: unknown }
  | { type: 'fit'; animate?: boolean }
  | { type: 'center'; lat: number; lng: number; zoom?: number }
  | { type: 'snapshot'; reqId: number }
  | { type: 'view'; reqId: number }
  | { type: 'tiles'; items: TileReplyOut[] }
  | { type: 'reloadTiles' };

function toScript(msg: HostMessage): string {
  const json = JSON.stringify(msg).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `window.__lmReceive&&window.__lmReceive(${json});true;`;
}

function openUrl(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}

export const LineMapView = forwardRef<LineMapHandle, LineMapViewProps>(function LineMapView(props, ref) {
  const webRef = useRef<WebViewInstance | null>(null);
  const readyRef = useRef(false);
  const lastSentState = useRef<unknown>(null);
  const snapshotWaiters = useRef(new Map<number, (data: string | null) => void>());
  const snapshotSeq = useRef(0);
  const [instance, setInstance] = useState(0);
  const viewWaiters = useRef(new Map<number, (v: CoreView | null) => void>());
  const propsRef = useLatest(props);
  const tileSettings = useTileSettings();
  const coreState = useCoreState(props, { ...tileSettings, useTileProtocol: true });
  const stateRef = useLatest(coreState);
  const online = useOnline();
  const [servedOffline, setServedOffline] = useState<'none' | 'cache' | 'miss'>('none');
  const onlineRef = useLatest(online);
  const cachedProvider = resolveProvider(props.basemap, tileSettings.providerId, effectiveApiKey(tileSettings.apiKey));
  const cachedSource = !!cachedProvider && cachedProvider.allowsOfflineCaching;

  const send = useCallback((msg: HostMessage): boolean => {
    const w = webRef.current;
    if (!w || !readyRef.current) return false;
    w.injectJavaScript(toScript(msg));
    return true;
  }, []);

  // Resume any unfinished offline downloads once a map is on screen.
  useEffect(() => {
    startOfflineMaps();
  }, []);

  // Native tile cache bridge (one host per mounted map).
  const hostRef = useRef<TileHost | null>(null);
  if (!hostRef.current) {
    hostRef.current = new TileHost({
      io: nativeTileHostIO,
      isOnline: () => onlineRef.current,
      getApiKey: currentApiKey,
      send: (items) => {
        send({ type: 'tiles', items });
      },
      onServe: (source) => {
        if (onlineRef.current) return;
        if (source === 'disk' || source === 'memory') setServedOffline('cache');
        else if (source === 'miss') setServedOffline((v) => (v === 'cache' ? v : 'miss'));
      },
    });
  }
  useEffect(() => {
    const host = hostRef.current;
    return () => host?.reset();
  }, []);

  // Back online: retry tiles that failed while offline. Going offline: reset the badge detail.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) send({ type: 'reloadTiles' });
    if (!online) setServedOffline('none');
    wasOnline.current = online;
  }, [online, send]);

  const pushState = useCallback(() => {
    const s = stateRef.current;
    if (s === lastSentState.current) return;
    if (send({ type: 'state', state: s })) lastSentState.current = s;
  }, [send, stateRef]);

  useEffect(() => {
    pushState();
  }, [coreState, pushState]);

  useTokenEffect(props.fitToken, () => {
    send({ type: 'fit', animate: true });
  });
  useTokenEffect(props.centerOnUserToken, () => {
    const u = propsRef.current.userLocation;
    if (u) send({ type: 'center', lat: u.lat, lng: u.lng });
  });

  const failSnapshots = useCallback(() => {
    snapshotWaiters.current.forEach((resolve) => resolve(null));
    snapshotWaiters.current.clear();
    viewWaiters.current.forEach((resolve) => resolve(null));
    viewWaiters.current.clear();
  }, []);

  useEffect(() => failSnapshots, [failSnapshots]);

  useImperativeHandle(
    ref,
    () => ({
      snapshot: () =>
        new Promise<string | null>((resolve) => {
          const reqId = ++snapshotSeq.current;
          const timer = setTimeout(() => {
            snapshotWaiters.current.delete(reqId);
            resolve(null);
          }, SNAPSHOT_TIMEOUT_MS);
          snapshotWaiters.current.set(reqId, (data) => {
            clearTimeout(timer);
            snapshotWaiters.current.delete(reqId);
            resolve(data);
          });
          if (!send({ type: 'snapshot', reqId })) snapshotWaiters.current.get(reqId)?.(null);
        }),
      getView: () =>
        new Promise<CoreView | null>((resolve) => {
          const reqId = ++snapshotSeq.current;
          const timer = setTimeout(() => {
            viewWaiters.current.delete(reqId);
            resolve(null);
          }, VIEW_TIMEOUT_MS);
          viewWaiters.current.set(reqId, (v) => {
            clearTimeout(timer);
            viewWaiters.current.delete(reqId);
            resolve(v);
          });
          if (!send({ type: 'view', reqId })) viewWaiters.current.get(reqId)?.(null);
        }),
    }),
    [send],
  );

  const onMessage = useCallback(
    (e: WebViewMessage) => {
      let msg: PageMessage;
      try {
        msg = JSON.parse(e.nativeEvent.data) as PageMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ready') {
        readyRef.current = true;
        lastSentState.current = null;
        pushState();
        return;
      }
      if (msg.type === 'tileReq') {
        const host = hostRef.current;
        if (host) {
          host.cancel(Array.isArray(msg.cancel) ? msg.cancel : null);
          host.request(Array.isArray(msg.reqs) ? msg.reqs : null);
        }
        return;
      }
      if (msg.type === 'snapshot' && 'reqId' in msg) {
        snapshotWaiters.current.get(msg.reqId)?.(typeof msg.data === 'string' ? msg.data : null);
        return;
      }
      if (msg.type === 'view' && 'reqId' in msg) {
        viewWaiters.current.get(msg.reqId)?.(msg.view && Array.isArray(msg.view.bounds) ? msg.view : null);
        return;
      }
      dispatchCoreEvent(msg as CoreEvent, propsRef.current, openUrl);
    },
    [propsRef, pushState],
  );

  // A dead web content process cannot be reused: remount the WebView (state is re-sent on 'ready').
  const remount = useCallback(() => {
    readyRef.current = false;
    lastSentState.current = null;
    hostRef.current?.reset();
    failSnapshots();
    setInstance((n) => n + 1);
  }, [failSnapshots]);

  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoad) => {
    const url = req.url || '';
    if (url.startsWith(BASE_URL) || /^(about|data|blob):/i.test(url)) return true;
    if (/^https?:\/\//i.test(url) && req.isTopFrame !== false) openUrl(url);
    return false;
  }, []);

  // The page posts 'ready' synchronously while the document parses. If the native side ever misses
  // that message, nothing would be sent to the map, so re-announce once loading has finished.
  const onLoadEnd = useCallback(() => {
    if (readyRef.current) return;
    webRef.current?.injectJavaScript(
      "if(window.__lmController&&window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify({type:'ready'}));}true;",
    );
  }, []);

  const setWebRef = useCallback((w: WebViewInstance | null) => {
    webRef.current = w;
  }, []);

  return (
    <View style={styles.root}>
      <WebViewWithRef
        key={instance}
        ref={setWebRef}
        source={SOURCE}
        originWhitelist={ORIGIN_WHITELIST}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={onLoadEnd}
        onContentProcessDidTerminate={remount}
        onRenderProcessGone={remount}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        androidLayerType="hardware"
        webviewDebuggingEnabled={__DEV__}
        style={styles.web}
        containerStyle={styles.web}
      />
      {!online ? <OfflineBadge detail={offlineDetail(servedOffline, cachedSource)} /> : null}
    </View>
  );
});

function offlineDetail(served: 'none' | 'cache' | 'miss', cachedSource: boolean): string {
  if (!cachedSource) return 'Offline: imagery needs signal';
  if (served === 'cache') return 'Offline: saved map';
  if (served === 'miss') return 'Offline: no saved map here';
  return 'Offline';
}

function OfflineBadge({ detail }: { detail: string }) {
  return (
    <View style={styles.badge} pointerEvents="none" accessibilityRole="text" accessibilityLabel={detail}>
      <View style={styles.badgeDot} />
      <Text style={styles.badgeText} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#0B0F14' },
  web: { flex: 1, backgroundColor: '#0B0F14' },
  // Sits just above the compass and scale bar (bottom-left, 170 px up; see mapCore CORE_CSS).
  badge: {
    position: 'absolute',
    left: 10,
    bottom: 232,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(11,15,20,0.88)',
    borderWidth: 1,
    borderColor: '#FFCC4D',
    maxWidth: 240,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFCC4D' },
  badgeText: { color: '#F2F5F8', fontSize: 12, fontWeight: '700' },
});
