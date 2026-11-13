// Offline maps: pick the map source (provider + key), download areas so the map works with no signal,
// watch progress, pause/resume/delete, see storage use, and read plain-language licensing notes.
// Query params (from DownloadAreaButton): projectId, bbox=w,s,e,n (current map view), download=1.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { confirmAsync, notify } from '@/components/confirm';
import { PageScroll } from '@/components/Page';
import { Button, Card, Chip, Field, SectionTitle, Segmented, T, ToggleRow } from '@/components/ui';
import { getRepository } from '@/data';
import type { MapNode } from '@/domain/types';
import { LineMapView, type LineMapHandle } from '@/map';
import type { AreaStatus, SavedArea } from '@/offline/downloader';
import {
  areaStoreBytes,
  browseCacheBytes,
  clearBrowseCache,
  freeDiskBytes,
} from '@/offline/fileCache';
import { getDownloadManager, OFFLINE_SUPPORTED, startOfflineMaps, useOfflineAreas } from '@/offline/manager';
import {
  canBulkDownload,
  defaultZoomRange,
  effectiveApiKey,
  getProvider,
  PROVIDERS,
  resolveProvider,
  type TileProvider,
} from '@/offline/providers';
import {
  bboxAroundPoints,
  bboxSizeM,
  estimateArea,
  formatBytes,
  isValidBBox,
  type BBox,
} from '@/offline/tileMath';
import { useStore } from '@/state/store';
import { colors, radius, space } from '@/theme';

const PROJECT_BUFFER_M = 150;
const EMPTY_SPANS: never[] = [];
const noop = () => undefined;

type AreaSource = 'project' | 'view' | 'frame';

function parseBBoxParam(v: string | undefined): BBox | null {
  if (!v) return null;
  const parts = v.split(',').map(Number);
  const b = parts.length === 4 ? (parts as BBox) : null;
  return isValidBBox(b) ? b : null;
}

function visibleProviders(): TileProvider[] {
  return PROVIDERS.filter((p) => !p.devOnly || __DEV__);
}

function statusLabel(s: AreaStatus): { text: string; color: string } {
  switch (s) {
    case 'queued':
      return { text: 'Waiting to start', color: colors.textMuted };
    case 'downloading':
      return { text: 'Downloading', color: colors.info };
    case 'paused':
      return { text: 'Paused', color: colors.warning };
    case 'waiting_network':
      return { text: 'Waiting for signal', color: colors.warning };
    case 'complete':
      return { text: 'Ready offline', color: colors.success };
    case 'error':
      return { text: 'Stopped', color: colors.danger };
    case 'deleting':
      return { text: 'Deleting', color: colors.textMuted };
  }
}

function sizeText(b: BBox): string {
  const { widthM, heightM } = bboxSizeM(b);
  const mi = (m: number) => m / 1609.344;
  return `${mi(widthM).toFixed(2)} x ${mi(heightM).toFixed(2)} mi`;
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={styles.barTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

// ------------------------------------------------------------------ screen

export default function OfflineMapsScreen() {
  const params = useLocalSearchParams<{ projectId?: string; bbox?: string; download?: string }>();
  const snapshot = useOfflineAreas();
  const [showDownload, setShowDownload] = useState(params.download === '1');

  useEffect(() => {
    startOfflineMaps();
  }, []);

  return (
    <PageScroll>
      <Stack.Screen options={{ title: 'Offline maps' }} />
      {!OFFLINE_SUPPORTED ? (
        <Card style={{ gap: space.sm }}>
          <T v="heading">Offline maps are saved in the phone app</T>
          <T color={colors.textMuted}>
            In the browser the map always loads online. Install the Android or iPhone app to save areas for places with no signal.
          </T>
        </Card>
      ) : null}

      <MapSourceSection />

      {OFFLINE_SUPPORTED ? (
        <>
          <SectionTitle>Saved areas</SectionTitle>
          <StorageCard areas={snapshot.areas} />
          {snapshot.areas.length === 0 ? (
            <Card style={{ gap: space.xs }}>
              <T v="heading">No saved areas yet</T>
              <T color={colors.textMuted}>
                Download the area around your job before you head out. The map then works with no signal, including satellite photos if your map source allows it.
              </T>
            </Card>
          ) : (
            <View style={{ gap: space.md }}>
              {snapshot.areas.map((a) => (
                <AreaCard key={a.id} area={a} />
              ))}
            </View>
          )}

          <SectionTitle>Download an area</SectionTitle>
          {showDownload ? (
            <DownloadForm
              projectId={params.projectId ?? null}
              viewBBox={parseBBoxParam(params.bbox)}
              onDone={() => setShowDownload(false)}
            />
          ) : (
            <Button title="Download an area" icon="cloud-download-outline" onPress={() => setShowDownload(true)} />
          )}
        </>
      ) : null}

      <LicensingSection />
    </PageScroll>
  );
}

// ------------------------------------------------------------------ map source

function MapSourceSection() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const [key, setKey] = useState(settings.tileApiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const selected = getProvider(settings.offlineTileProvider);
  const keyNeeded = !!selected?.needsKey;
  const active = resolveProvider(settings.basemap, settings.offlineTileProvider, effectiveApiKey(settings.tileApiKey));

  const save = (patch: Parameters<typeof saveSettings>[0]) => {
    saveSettings(patch).catch((err: unknown) => notify('Could not save setting', err instanceof Error ? err.message : String(err)));
  };

  // One chip per family: MapTiler covers satellite, hybrid and streets with one key.
  const choices: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'Built-in (testing)' },
    { id: 'maptiler-satellite', label: 'MapTiler' },
    ...(__DEV__ ? [{ id: 'test-osm', label: 'Test tiles' }] : []),
  ];
  const selectedFamily = selected?.family ?? null;

  return (
    <>
      <SectionTitle>Map source</SectionTitle>
      <Card style={{ gap: space.md }}>
        <View style={styles.chips}>
          {choices.map((c) => {
            const fam = c.id ? getProvider(c.id)?.family ?? null : null;
            return (
              <Chip
                key={c.label}
                label={c.label}
                selected={fam === selectedFamily}
                onPress={() => save({ offlineTileProvider: c.id })}
              />
            );
          })}
        </View>
        <T v="caption" color={colors.textMuted}>
          {selected
            ? selected.note
            : 'Free Esri satellite photos and OpenStreetMap streets. Good for testing with signal, but they cannot be saved for offline use and are not meant for company-wide use.'}
        </T>
        {keyNeeded ? (
          <Field
            label="MapTiler API key"
            hint="From cloud.maptiler.com (Account, API keys). Restrict the key to this app in MapTiler."
            value={key}
            onChangeText={setKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showKey}
            placeholder="Paste your key"
            onEndEditing={() => save({ tileApiKey: key.trim() || null })}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showKey ? 'Hide key' : 'Show key'}
                onPress={() => setShowKey((v) => !v)}
                style={styles.eye}
              >
                <Ionicons name={showKey ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
              </Pressable>
            }
          />
        ) : null}
        {keyNeeded && key.trim() !== (settings.tileApiKey ?? '') ? (
          <Button title="Save key" compact kind="secondary" onPress={() => save({ tileApiKey: key.trim() || null })} />
        ) : null}
        <T v="caption" color={colors.textFaint}>
          Map now showing: {active ? active.name : 'built-in testing tiles'}
          {active?.allowsOfflineCaching ? ' (saved tiles are used when offline)' : ' (online only)'}
        </T>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ storage + areas

function StorageCard({ areas }: { areas: SavedArea[] }) {
  const [tick, setTick] = useState(0);
  const busy = areas.some((a) => a.status === 'downloading' || a.status === 'deleting');
  // Directory sizes walk the disk: refresh on demand and every few seconds while downloading.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(t);
  }, [busy]);
  const stats = useMemo(
    () => ({ saved: areaStoreBytes(), browse: browseCacheBytes(), free: freeDiskBytes() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, areas.length],
  );

  const clear = async () => {
    const ok = await confirmAsync({
      title: 'Clear browsing cache?',
      message: 'Removes map tiles kept from normal browsing. Saved areas are not touched.',
      confirmLabel: 'Clear',
    });
    if (!ok) return;
    clearBrowseCache();
    setTick((n) => n + 1);
  };

  return (
    <Card style={{ gap: space.sm, marginBottom: space.md }}>
      <View style={styles.rowBetween}>
        <T v="heading">Saved areas use {formatBytes(stats.saved)}</T>
        <T v="caption" color={colors.textMuted}>
          {stats.free != null ? `${formatBytes(stats.free)} free` : ''}
        </T>
      </View>
      <View style={styles.rowBetween}>
        <T v="caption" color={colors.textMuted}>
          Browsing cache: {formatBytes(stats.browse)} (the phone may clear this when space is low)
        </T>
        <Button title="Clear" compact kind="ghost" onPress={() => void clear()} />
      </View>
    </Card>
  );
}

function AreaCard({ area }: { area: SavedArea }) {
  const m = getDownloadManager();
  const p = getProvider(area.providerId);
  const st = statusLabel(area.status);
  const progress = area.totalTiles > 0 ? area.doneTiles / area.totalTiles : 0;
  const running = area.status === 'downloading' || area.status === 'queued' || area.status === 'waiting_network';

  const del = async () => {
    const ok = await confirmAsync({
      title: `Delete "${area.name}"?`,
      message: 'Map tiles only this area uses are removed from the phone. Tiles shared with another saved area stay.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await m.remove(area.id);
  };

  return (
    <Card style={{ gap: space.sm }}>
      <View style={styles.rowBetween}>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="heading" numberOfLines={1}>
            {area.name}
          </T>
          <T v="caption" color={colors.textMuted} numberOfLines={1}>
            {p?.name ?? area.providerId}  |  zoom {area.minZoom} to {area.maxZoom}  |  {sizeText(area.bbox)}
          </T>
        </View>
        <T v="label" color={st.color}>
          {st.text}
        </T>
      </View>
      <ProgressBar value={progress} color={area.status === 'complete' ? colors.success : st.color} />
      <View style={styles.rowBetween}>
        <T v="caption" color={colors.textMuted}>
          {area.doneTiles.toLocaleString('en-US')} of {area.totalTiles.toLocaleString('en-US')} tiles  |  {formatBytes(area.bytes)}
          {area.status !== 'complete' ? ` of about ${formatBytes(area.estimatedBytes)}` : ''}
        </T>
        {area.failedTiles > 0 ? (
          <T v="caption" color={colors.warning}>
            {area.failedTiles} missing
          </T>
        ) : null}
      </View>
      {area.error ? (
        <T v="caption" color={colors.danger}>
          {area.error}
        </T>
      ) : null}
      {area.status === 'waiting_network' ? (
        <T v="caption" color={colors.textMuted}>
          The download continues by itself when the phone has signal again.
        </T>
      ) : null}
      <View style={styles.actions}>
        {running && area.status !== 'waiting_network' ? (
          <Button title="Pause" icon="pause" compact kind="secondary" onPress={() => void m.pause(area.id)} />
        ) : null}
        {area.status === 'paused' || area.status === 'waiting_network' ? (
          <Button title="Resume" icon="play" compact kind="secondary" onPress={() => void m.resume(area.id)} />
        ) : null}
        {area.status === 'error' || (area.status === 'complete' && area.failedTiles > 0) ? (
          <Button title="Retry" icon="refresh" compact kind="secondary" onPress={() => void m.retry(area.id)} />
        ) : null}
        {area.status !== 'deleting' ? (
          <Button title="Delete" icon="trash-outline" compact kind="ghost" onPress={() => void del()} />
        ) : null}
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------ download form

function DownloadForm({ projectId, viewBBox, onDone }: { projectId: string | null; viewBBox: BBox | null; onDone: () => void }) {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const project = useStore((s) => (projectId ? s.projects.find((p) => p.id === projectId) ?? null : null));
  const activeProjectId = useStore((s) => s.activeProjectId);
  const storeNodes = useStore((s) => s.nodes);
  const [nodes, setNodes] = useState<MapNode[]>([]);

  // Project nodes for "project area" and for context on the framing map.
  useEffect(() => {
    if (!projectId) return;
    if (activeProjectId === projectId) {
      setNodes(storeNodes);
      return;
    }
    let alive = true;
    getRepository()
      .listNodes(projectId)
      .then((n) => alive && setNodes(n))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [projectId, activeProjectId, storeNodes]);

  const projectBBox = useMemo(
    () => bboxAroundPoints(nodes.map((n) => ({ lat: n.position.lat, lng: n.position.lng })), PROJECT_BUFFER_M),
    [nodes],
  );

  // Default provider: the current map source if it can be saved, else the first that can.
  const initialProvider = useMemo(() => {
    const cur = resolveProvider(settings.basemap, settings.offlineTileProvider, effectiveApiKey(settings.tileApiKey));
    if (cur?.allowsOfflineCaching) return cur.id;
    return getProvider(settings.offlineTileProvider)?.id ?? 'maptiler-satellite';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [providerId, setProviderId] = useState<string>(initialProvider);
  const provider = getProvider(providerId)!;
  const zr = defaultZoomRange(provider);
  const [maxZoom, setMaxZoom] = useState(zr.maxZoom);
  useEffect(() => setMaxZoom(defaultZoomRange(provider).maxZoom), [provider]);

  const [source, setSource] = useState<AreaSource>(viewBBox ? 'view' : projectId ? 'project' : 'frame');
  const [framed, setFramed] = useState<BBox | null>(null);
  const [name, setName] = useState(project ? project.name : '');
  const [agreed, setAgreed] = useState(false);
  const [starting, setStarting] = useState(false);

  const bbox: BBox | null = source === 'project' ? projectBBox : source === 'view' ? viewBBox : framed;
  const apiKey = effectiveApiKey(settings.tileApiKey);
  const est = useMemo(
    () => (bbox ? estimateArea(bbox, zr.minZoom, maxZoom, provider.avgTileBytes) : null),
    [bbox, zr.minZoom, maxZoom, provider.avgTileBytes],
  );
  const gate = canBulkDownload(provider, { apiKey, tileCount: est?.tiles ?? 0, agreementConfirmed: agreed });
  const showGate = !gate.ok && (gate.code !== 'empty' || !!bbox) && gate.code !== 'needs_agreement';

  const zoomOptions = [17, 18, 19, 20]
    .filter((z) => z <= provider.maxZoom && z >= zr.minZoom)
    .map((z) => ({
      value: String(z),
      label: z === 17 ? 'Standard' : z === 18 ? 'High' : z === 19 ? 'Very high' : 'Max',
    }));

  const start = async () => {
    if (!bbox) return;
    setStarting(true);
    try {
      const area = await getDownloadManager().addArea({
        name: name.trim() || (project ? project.name : `Area ${new Date().toLocaleDateString()}`),
        providerId: provider.id,
        bbox,
        minZoom: zr.minZoom,
        maxZoom,
        projectId,
        agreementConfirmed: agreed,
      });
      // The map shows saved tiles of its current source; switch it if this area uses another family.
      const cur = getProvider(settings.offlineTileProvider);
      if (!cur || cur.family !== provider.family) {
        await saveSettings({ offlineTileProvider: provider.id });
        notify('Download started', `"${area.name}" is downloading. The map now uses ${provider.name} so it can show these tiles offline.`);
      }
      onDone();
    } catch (err) {
      notify('Cannot download this area', err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const sources: Array<{ value: AreaSource; label: string }> = [
    ...(projectId ? [{ value: 'project' as const, label: 'Project area' }] : []),
    ...(viewBBox ? [{ value: 'view' as const, label: 'Map view' }] : []),
    { value: 'frame', label: 'Frame on map' },
  ];

  return (
    <Card style={{ gap: space.md }}>
      <T v="label" color={colors.textMuted}>
        Map source
      </T>
      <View style={styles.chips}>
        {visibleProviders().map((p) => (
          <Chip
            key={p.id}
            label={p.name}
            selected={p.id === providerId}
            icon={p.allowsOfflineCaching ? undefined : 'cloud-offline-outline'}
            onPress={() => setProviderId(p.id)}
          />
        ))}
      </View>
      <T v="caption" color={colors.textMuted}>
        {provider.note}
      </T>

      <Field label="Name" value={name} onChangeText={setName} placeholder="For example: Elm St reroute" />

      <T v="label" color={colors.textMuted}>
        Area
      </T>
      {sources.length > 1 ? <Segmented value={source} onChange={setSource} options={sources} /> : null}
      {source === 'project' ? (
        <T v="caption" color={colors.textMuted}>
          {projectBBox
            ? `Everything this project has mapped, plus about ${Math.round((PROJECT_BUFFER_M * 3.28084) / 50) * 50} ft around it (${sizeText(projectBBox)}).`
            : 'This project has no nodes yet. Use Frame on map instead.'}
        </T>
      ) : null}
      {source === 'view' && viewBBox ? (
        <T v="caption" color={colors.textMuted}>
          The part of the map you were looking at ({sizeText(viewBBox)}).
        </T>
      ) : null}
      {source === 'frame' ? <FramePicker nodes={nodes} framed={framed} onFrame={setFramed} /> : null}

      <T v="label" color={colors.textMuted}>
        Detail (closest zoom saved)
      </T>
      {zoomOptions.length > 0 ? (
        <Segmented value={String(maxZoom)} onChange={(v) => setMaxZoom(Number(v))} options={zoomOptions} />
      ) : null}
      <T v="caption" color={colors.textFaint}>
        Saves zoom {zr.minZoom} to {maxZoom}. Each extra level is about 4 times the tiles. You can still zoom in past it; the picture just gets softer.
      </T>

      {provider.requiresAgreement && provider.allowsOfflineCaching ? (
        <ToggleRow
          label="Our plan allows offline downloads"
          hint={`${provider.name} only allows saving areas if your company's plan or a written agreement covers offline use.`}
          value={agreed}
          onChange={setAgreed}
        />
      ) : null}

      {est && bbox ? (
        <View style={styles.estimate}>
          <T v="heading">
            About {formatBytes(est.bytes)}  |  {est.tiles.toLocaleString('en-US')} tiles
          </T>
          <T v="caption" color={colors.textMuted}>
            Uses data: download on Wi-Fi if you can. The download keeps going in the background while the app is open and picks up where it left off if the app closes.
          </T>
        </View>
      ) : null}

      {showGate && !gate.ok ? (
        <View style={styles.refusal}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <T v="caption" color={colors.text} style={{ flex: 1 }}>
            {gate.reason}
          </T>
        </View>
      ) : null}

      <Button
        title="Start download"
        icon="cloud-download-outline"
        onPress={() => void start()}
        disabled={!bbox || !gate.ok}
        loading={starting}
      />
      <Button title="Cancel" kind="ghost" onPress={onDone} />
    </Card>
  );
}

function FramePicker({ nodes, framed, onFrame }: { nodes: MapNode[]; framed: BBox | null; onFrame: (b: BBox | null) => void }) {
  const settings = useStore((s) => s.settings);
  const mapRef = useRef<LineMapHandle>(null);
  const [fitToken, setFitToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && nodes.length > 0) {
      fitted.current = true;
      setFitToken((n) => n + 1);
    }
  }, [nodes.length]);

  const capture = useCallback(async () => {
    setBusy(true);
    try {
      const v = await mapRef.current?.getView();
      if (v && isValidBBox(v.bounds)) onFrame(v.bounds);
      else notify('Map not ready', 'Wait for the map to load, then try again.');
    } finally {
      setBusy(false);
    }
  }, [onFrame]);

  return (
    <View style={{ gap: space.sm }}>
      <T v="caption" color={colors.textMuted}>
        Move and zoom the map until it shows the area you need, then tap Use this view.
      </T>
      <View style={styles.preview}>
        <LineMapView
          ref={mapRef}
          nodes={nodes}
          spans={EMPTY_SPANS}
          selectedNodeId={null}
          selectedSpanId={null}
          basemap={settings.basemap}
          globalIconScale={settings.globalIconScale}
          editMode="select"
          units={settings.units}
          userLocation={null}
          showAccuracy={false}
          fitToken={fitToken}
          centerOnUserToken={0}
          onNodePress={noop}
          onNodeMoved={noop}
          onSpanPress={noop}
          onMapPress={noop}
        />
        <View pointerEvents="none" style={styles.frameOutline} />
      </View>
      <View style={styles.rowBetween}>
        <T v="caption" color={framed ? colors.success : colors.textFaint}>
          {framed ? `Area set: ${sizeText(framed)}` : 'No area set yet'}
        </T>
        <Button title="Use this view" icon="scan-outline" compact kind="secondary" loading={busy} onPress={() => void capture()} />
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ licensing

function LicensingSection() {
  return (
    <>
      <SectionTitle>About map sources</SectionTitle>
      <Card style={{ gap: space.md }}>
        <T color={colors.textMuted}>
          Map pictures (tiles) belong to the company that makes them, and each one has rules about saving them on a phone. LineMap Pro only offers offline downloads for sources whose rules allow it.
        </T>
        {visibleProviders().map((p) => (
          <View key={p.id} style={{ gap: 2 }}>
            <View style={styles.rowBetween}>
              <T v="heading" style={{ flex: 1 }}>
                {p.name}
              </T>
              <T v="caption" color={p.allowsOfflineCaching ? colors.success : colors.textMuted}>
                {p.allowsOfflineCaching ? (p.requiresAgreement ? 'Offline with plan' : 'Offline (limited)') : 'Online only'}
              </T>
            </View>
            <T v="caption" color={colors.textMuted}>
              {p.note}
            </T>
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(p.termsUrl).catch(() => undefined)}>
              <T v="caption" color={colors.info}>
                Read the terms
              </T>
            </Pressable>
          </View>
        ))}
        {Platform.OS !== 'web' ? (
          <T v="caption" color={colors.textFaint}>
            Tiles you look at while online are also kept for a while in a browsing cache, so recently viewed places often still show offline. Download an area to be sure.
          </T>
        ) : null}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  eye: { padding: space.sm },
  preview: {
    height: 280,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  frameOutline: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    borderStyle: 'dashed',
  },
  estimate: { gap: 4, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  refusal: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: 'rgba(255,93,93,0.08)',
  },
});
