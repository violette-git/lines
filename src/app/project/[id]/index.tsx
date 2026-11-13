// Project map: full-bleed map, live tally, tool rail, mode switch, big capture button, node/span
// sheets, connect mode, drop-pin, and align-to-imagery.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { canManageProjects, useAuth, useCanEdit, useCanManageProjects } from '@/backend/authStore';
import { IconButton, Segmented, T } from '@/components/ui';
import type { MapEditMode } from '@/domain/contracts';
import type { GeoFix, LatLng, MapNode, NodeType, SpanKind } from '@/domain/types';
import { confirmAsync, errorMessage } from '@/features/common/confirm';
import { captureHaptic, successHaptic, tapHaptic } from '@/features/common/haptics';
import { useMapUiBus } from '@/features/common/mapUiBus';
import { useToast } from '@/features/common/Toast';
import { ensureAiConsent } from '@/features/consent/AiConsentDialog';
import { friendlyAiError } from '@/features/map-screen/aiStatus';
import { NodeSheet } from '@/features/map-screen/NodeSheet';
import {
  ConnectBar,
  defaultSpanKind,
  DropPinSheet,
  MoreMenu,
  PromptCard,
  type MenuItem,
} from '@/features/map-screen/overlays';
import { SpanSheet } from '@/features/map-screen/SpanSheet';
import { TallyStrip } from '@/features/map-screen/TallyStrip';
import { nextBasemap, ToolRail } from '@/features/map-screen/ToolRail';
import type { SheetSnap } from '@/features/sheets/BottomSheet';
import { WatermarkQueue } from '@/features/watermark/WatermarkQueue';
import { degreeDelta, distanceM, formatLength, metersToFeet } from '@/geo';
import { getQuickFix, watchQuickFix } from '@/geo/gpsSampler';
import { FixQualityChip } from '@/gps/FixQualityChip';
import { LineMapView, type LineMapHandle } from '@/map';
import { offlineMapsMenuItem } from '@/offline/DownloadAreaButton';
import { computeTally, selectSpansWithLength, useStore } from '@/state/store';
import { SyncChip } from '@/sync';
import { colors, radius, shadow, space } from '@/theme';

type Selection = { kind: 'node'; id: string } | { kind: 'span'; id: string } | null;

interface ConnectState {
  fromId: string | null;
  toId: string | null;
  kind: SpanKind;
  chained: boolean;
}

interface AlignPending {
  nodeId: string;
  from: LatLng;
  to: LatLng;
}

const EMPTY_CONNECT: ConnectState = { fromId: null, toId: null, kind: 'aerial', chained: false };

export default function ProjectMapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast({ bottom: insets.bottom + 150 });

  const project = useStore((s) => s.projects.find((p) => p.id === id) ?? null);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const rawNodes = useStore((s) => s.nodes);
  const rawSpans = useStore((s) => s.spans);
  const photos = useStore((s) => s.photos);
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const lastNodeId = useStore((s) => s.lastNodeId);
  const aiErrors = useStore((s) => s.aiErrors);
  const {
    saveSettings,
    captureNode,
    moveNode,
    recalibrateNode,
    shiftAllNodes,
    addSpan,
    updateProject,
    runPendingAi,
  } = useStore.getState();

  // Only show data that belongs to this project (avoids a flash of the previous project).
  const isActive = activeProjectId === id;
  const nodes = isActive ? rawNodes : EMPTY_NODES;
  const spanList = isActive ? rawSpans : EMPTY_SPANS;
  const spans = useMemo(() => selectSpansWithLength({ spans: spanList, nodes }), [spanList, nodes]);
  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const tally = useMemo(() => computeTally(nodes, spans, project), [nodes, spans, project]);
  const template = project?.templateId ? templates.find((t) => t.id === project.templateId) ?? null : null;
  // Roles: a project with no orgId lives only on this phone and is always editable.
  const orgId = project?.orgId ?? null;
  const canEdit = useCanEdit(orgId);
  const canManage = useCanManageProjects(orgId);
  // "Move to company": local project, signed in with an active company, manager or above there.
  const activeOrg = useAuth((s) => (s.session && s.activeOrgId ? s.orgs.find((o) => o.id === s.activeOrgId) ?? null : null));
  const canMoveToCompany = !!project && !project.orgId && !!activeOrg && canManageProjects(activeOrg.role);

  const [loading, setLoading] = useState(!isActive);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      try {
        const st = useStore.getState();
        if (!st.ready) await st.init();
        await useStore.getState().openProject(id);
      } catch (e) {
        toast.show(`Could not open project: ${errorMessage(e)}`, { kind: 'error' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Live "you are here".
  const [userLocation, setUserLocation] = useState<GeoFix | null>(null);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    watchQuickFix((f) => setUserLocation(f)).then((s) => {
      if (cancelled) s?.();
      else stop = s;
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  // View state.
  const [mode, setMode] = useState<MapEditMode>('select');
  const [selection, setSelection] = useState<Selection>(null);
  const [snap, setSnap] = useState<SheetSnap>('peek');
  const [connect, setConnect] = useState<ConnectState>(EMPTY_CONNECT);
  const [alignActive, setAlignActive] = useState(false);
  const [alignPending, setAlignPending] = useState<AlignPending | null>(null);
  const [dropAt, setDropAt] = useState<LatLng | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAccuracy, setShowAccuracy] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [centerToken, setCenterToken] = useState(0);
  const fittedFor = useRef<string | null>(null);
  const mapRef = useRef<LineMapHandle>(null);

  // Fit to the project's nodes once when it opens.
  useEffect(() => {
    if (isActive && nodes.length > 0 && fittedFor.current !== id) {
      fittedFor.current = id ?? null;
      setFitToken((t) => t + 1);
    }
  }, [isActive, nodes.length, id]);

  // Capture "Done" asks us to select the node it just made.
  useFocusEffect(
    useCallback(() => {
      const sel = useMapUiBus.getState().consumeSelect();
      if (sel) {
        setMode('select');
        setConnect(EMPTY_CONNECT);
        setSelection({ kind: sel.kind, id: sel.id });
        setSnap('peek');
      }
    }, []),
  );

  // Drop selection if the selected item disappears.
  useEffect(() => {
    if (selection?.kind === 'node' && !nodesById.has(selection.id)) setSelection(null);
    if (selection?.kind === 'span' && !spans.some((s) => s.id === selection.id)) setSelection(null);
  }, [selection, nodesById, spans]);

  const setEditMode = (m: MapEditMode) => {
    tapHaptic();
    setMode(m);
    setConnect(EMPTY_CONNECT);
    if (m !== 'move') {
      setAlignActive(false);
      setAlignPending(null);
    }
    if (m === 'connect') {
      const startId = selection?.kind === 'node' ? selection.id : null;
      setConnect({ ...EMPTY_CONNECT, fromId: startId });
      setSelection(null);
    }
  };

  // Viewers only look: drop back to Select if the role changes while editing.
  useEffect(() => {
    if (canEdit) return;
    setMode('select');
    setConnect(EMPTY_CONNECT);
    setAlignActive(false);
    setAlignPending(null);
    setDropAt(null);
  }, [canEdit]);

  // Map callbacks read the latest state through a ref (the map may keep the first callbacks).
  const live = useRef({ mode, connect, alignActive, nodesById, template, canEdit });
  live.current = { mode, connect, alignActive, nodesById, template, canEdit };

  const onNodePress = useCallback((nodeId: string) => {
    const s = live.current;
    if (s.mode === 'connect') {
      tapHaptic();
      const c = s.connect;
      if (!c.fromId) {
        setConnect({ ...c, fromId: nodeId, toId: null });
      } else if (nodeId === c.fromId) {
        setConnect({ ...c, toId: null });
      } else {
        const kind = defaultSpanKind(s.nodesById.get(c.fromId), s.nodesById.get(nodeId), s.template);
        setConnect({ ...c, toId: nodeId, kind });
      }
      return;
    }
    tapHaptic();
    setSelection({ kind: 'node', id: nodeId });
    setSnap('peek');
  }, []);

  const onSpanPress = useCallback((spanId: string) => {
    if (live.current.mode === 'connect') return;
    tapHaptic();
    setSelection({ kind: 'span', id: spanId });
    setSnap('peek');
  }, []);

  const onMapPress = useCallback(() => {
    if (live.current.mode === 'connect') return;
    setSelection(null);
  }, []);

  const onMapLongPress = useCallback((at: LatLng) => {
    if (live.current.mode === 'connect' || !live.current.canEdit) return;
    captureHaptic();
    setDropAt(at);
  }, []);

  const onNodeMoved = useCallback(
    (nodeId: string, to: LatLng) => {
      const s = live.current;
      const n = s.nodesById.get(nodeId);
      if (!n || !s.canEdit) return;
      if (s.alignActive) {
        setAlignPending({ nodeId, from: { lat: n.position.lat, lng: n.position.lng }, to });
        return;
      }
      const prev = n.position;
      void moveNode(nodeId, to).then(() => {
        tapHaptic();
        toast.show(`Moved ${n.label}.`, {
          kind: 'info',
          actionLabel: 'Undo',
          onAction: () => void recalibrateNode(nodeId, prev),
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const doConnect = async () => {
    const c = connect;
    if (!c.fromId || !c.toId) return;
    const span = await addSpan(c.fromId, c.toId, c.kind);
    if (!span) {
      toast.show('Those two are already connected.', { kind: 'info' });
      setConnect({ ...c, toId: null });
      return;
    }
    successHaptic();
    // Chain: the second node becomes the start of the next span.
    setConnect({ fromId: c.toId, toId: null, kind: c.kind, chained: true });
  };

  const dropPin = async (type: NodeType) => {
    const at = dropAt;
    setDropAt(null);
    if (!at || !project) return;
    try {
      const fix: GeoFix = {
        lat: at.lat,
        lng: at.lng,
        accuracyM: null,
        altitudeM: null,
        samples: 0,
        capturedAt: new Date().toISOString(),
        source: 'manual',
      };
      const node = await captureNode({ type, fix });
      successHaptic();
      setMode('select');
      setSelection({ kind: 'node', id: node.id });
      setSnap('peek');
    } catch (e) {
      toast.show(`Could not drop the pin: ${errorMessage(e)}`, { kind: 'error' });
    }
  };

  const locate = async () => {
    if (!userLocation) {
      const f = await getQuickFix();
      if (!f) {
        toast.show('Location is off. Allow location access to center on yourself.', { kind: 'warning' });
        return;
      }
      setUserLocation(f);
    }
    setCenterToken((t) => t + 1);
  };

  const startAlign = () => {
    setSelection(null);
    setConnect(EMPTY_CONNECT);
    setMode('move');
    setAlignActive(true);
    setAlignPending(null);
  };

  /** Navigate to export; the map snapshot (PDF cover) is grabbed in the background. */
  const openExport = () => {
    const pid = id;
    if (pid) {
      mapRef.current
        ?.snapshot()
        .then((url) => useMapUiBus.getState().setMapSnapshot(pid, url))
        .catch(() => {});
    }
    router.push(`/project/${id}/export` as never);
  };

  const pendingAi = tally.aiPending;
  const failedIds = Object.keys(aiErrors).filter((k) => nodesById.get(k)?.status === 'ai_failed');

  const editItems: MenuItem[] = canManage
    ? [{ icon: 'create-outline', label: 'Edit project', hint: 'Name, client, job #, rates, template', onPress: () => router.push(`/project/${id}/edit` as never) }]
    : [];
  const fieldItems: MenuItem[] = canEdit
    ? [
        { icon: 'move-outline', label: 'Align all to imagery', hint: 'Drag one node onto the photo, shift the rest', onPress: startAlign },
        {
          icon: 'sparkles-outline',
          label: pendingAi + failedIds.length > 0 ? `Run pending AI (${pendingAi + failedIds.length})` : 'Run pending AI',
          hint: settings.aiMode === 'off' ? 'AI is off in Settings' : 'Fill fields from photos for unfinished nodes',
          onPress: () => {
            if (settings.aiMode === 'off') {
              toast.show('AI is turned off. Turn it on in Settings first.', { kind: 'info' });
              return;
            }
            void (async () => {
              if (!(await ensureAiConsent())) return;
              toast.show('Running AI on pending nodes...', { kind: 'info' });
              void runPendingAi();
            })();
          },
        },
      ]
    : [];
  const moveToCompany = async () => {
    if (!project || !activeOrg) return;
    const ok = await confirmAsync(
      `Move to ${activeOrg.name}?`,
      `"${project.name}" will be shared with your company. Teammates in ${activeOrg.name} will see it and, depending on their role, can edit it. Its nodes, spans and photos upload when you have signal. This cannot be undone from the phone.`,
      { confirmText: 'Move to company' },
    );
    if (!ok) return;
    try {
      await useStore.getState().moveProjectToActiveOrg(project.id);
      successHaptic();
      toast.show(`Moved to ${activeOrg.name}. It will sync shortly.`, { kind: 'success' });
    } catch (e) {
      toast.show(`Could not move the project: ${errorMessage(e)}`, { kind: 'error' });
    }
  };
  const companyItems: MenuItem[] = canMoveToCompany
    ? [{ icon: 'business-outline', label: 'Move to company', hint: `Share this project with ${activeOrg?.name ?? 'your company'}`, onPress: () => void moveToCompany() }]
    : [];
  const menuItems: MenuItem[] = [
    ...editItems,
    ...companyItems,
    ...fieldItems,
    { icon: 'radio-button-on-outline', label: 'Accuracy circles', active: showAccuracy, onPress: () => setShowAccuracy((v) => !v) },
    ...(id ? [offlineMapsMenuItem(id, mapRef)] : []),
    { icon: 'share-outline', label: 'Export', onPress: openExport },
  ];
  const showFixChip = settings.gpsSource === 'external_tcp' || (userLocation?.fixQuality != null && userLocation.fixQuality !== 'gps');

  const selectedNode = selection?.kind === 'node' ? nodesById.get(selection.id) ?? null : null;
  const selectedSpan = selection?.kind === 'span' ? spans.find((s) => s.id === selection.id) ?? null : null;
  const selectedPhoto = selectedNode
    ? photos.find((p) => p.nodeId === selectedNode.id && p.isPrimary) ?? photos.find((p) => p.nodeId === selectedNode.id) ?? null
    : null;
  const lastNode = lastNodeId ? nodesById.get(lastNodeId) ?? null : null;
  const sheetOpen = selection != null;
  const units = settings.units;

  const alignDistance = alignPending ? distanceM(alignPending.from, alignPending.to) : 0;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <WatermarkQueue />

      <LineMapView
        ref={mapRef}
        nodes={nodes}
        spans={spans}
        selectedNodeId={mode === 'connect' ? connect.toId ?? connect.fromId : selection?.kind === 'node' ? selection.id : null}
        selectedSpanId={selection?.kind === 'span' ? selection.id : null}
        basemap={settings.basemap}
        globalIconScale={settings.globalIconScale}
        editMode={mode}
        units={units}
        userLocation={userLocation}
        showAccuracy={showAccuracy}
        fitToken={fitToken}
        centerOnUserToken={centerToken}
        onNodePress={onNodePress}
        onNodeMoved={onNodeMoved}
        onSpanPress={onSpanPress}
        onMapPress={onMapPress}
        onMapLongPress={onMapLongPress}
      />

      {/* Top overlay */}
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={styles.topRow}>
          <IconButton
            icon="chevron-back"
            label="Back to projects"
            size={48}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as never))}
            style={styles.glass}
          />
          <Pressable
            accessibilityRole={canManage ? 'button' : 'header'}
            accessibilityLabel={canManage ? 'Edit project details' : project?.name ?? 'Project'}
            disabled={!canManage}
            onPress={() => router.push(`/project/${id}/edit` as never)}
            style={[styles.titleBox, styles.glass]}
          >
            <T v="heading" numberOfLines={1}>
              {project?.name ?? 'Project'}
            </T>
            <T v="caption" color={colors.textMuted} numberOfLines={1}>
              {[project?.client, project?.jobNumber ? `Job ${project.jobNumber}` : ''].filter(Boolean).join('  |  ') ||
                (canManage ? 'Tap to add client and job #' : 'No client or job # yet')}
            </T>
          </Pressable>
          {project?.orgId ? <SyncChip compact /> : null}
          <IconButton icon="share-outline" label="Export" size={48} onPress={openExport} style={styles.glass} />
          <IconButton icon="ellipsis-vertical" label="More" size={48} onPress={() => setMenuOpen(true)} style={styles.glass} />
        </View>

        <View style={{ marginTop: space.sm }}>
          <TallyStrip tally={tally} units={units} />
        </View>

        <View style={styles.banners} pointerEvents="box-none">
          {project ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: project.walkMode, disabled: !canEdit }}
              accessibilityLabel="Walk mode"
              disabled={!canEdit}
              onPress={() => {
                tapHaptic();
                void updateProject(project.id, { walkMode: !project.walkMode });
              }}
              style={[styles.banner, { borderColor: project.walkMode ? colors.accent : colors.border }]}
            >
              <Ionicons name="walk" size={16} color={project.walkMode ? colors.accent : colors.textMuted} />
              <T v="label" color={project.walkMode ? colors.text : colors.textMuted} numberOfLines={1}>
                {project.walkMode ? (lastNode ? `Walk mode on: next connects to ${lastNode.label}` : 'Walk mode on') : 'Walk mode off'}
              </T>
            </Pressable>
          ) : null}
          {showFixChip ? <FixQualityChip fix={userLocation} units={units} compact /> : null}
          {!canEdit && project ? (
            <View style={[styles.banner, { borderColor: colors.borderStrong }]} accessibilityLabel="View only. Your role in this company can look but not change this project.">
              <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
              <T v="label" color={colors.textMuted}>
                View only
              </T>
            </View>
          ) : null}
          {pendingAi > 0 ? (
            <View style={[styles.banner, { borderColor: colors.info }]}>
              <ActivityIndicator size="small" color={colors.info} />
              <T v="label">AI reading {pendingAi} photo{pendingAi === 1 ? '' : 's'}</T>
            </View>
          ) : null}
          {failedIds.length > 0 && canEdit ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void (async () => {
                  if (await ensureAiConsent()) void runPendingAi();
                })();
              }}
              style={[styles.banner, { borderColor: colors.warning }]}
            >
              <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
              <T v="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                {failedIds.length === 1
                  ? friendlyAiError(aiErrors[failedIds[0]])
                  : `AI could not finish ${failedIds.length} nodes.`}
              </T>
              <T v="label" color={colors.accent}>
                Retry
              </T>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Right tool rail */}
      {!sheetOpen || snap === 'peek' ? (
        <View style={[styles.rail, { top: insets.top + 196 }]} pointerEvents="box-none">
          <ToolRail
            basemap={settings.basemap}
            onBasemap={() => void saveSettings({ basemap: nextBasemap(settings.basemap) })}
            iconScale={settings.globalIconScale}
            onIconScale={(v) => void saveSettings({ globalIconScale: v })}
            onLocate={locate}
            onFit={() => setFitToken((t) => t + 1)}
            locating={userLocation != null}
          />
        </View>
      ) : null}

      {/* Bottom controls */}
      {!sheetOpen ? (
        <View style={[styles.bottom, { paddingBottom: insets.bottom + space.md }]} pointerEvents="box-none">
          {mode === 'connect' ? (
            <View style={styles.floatCard}>
              <ConnectBar
                from={connect.fromId ? nodesById.get(connect.fromId) ?? null : null}
                to={connect.toId ? nodesById.get(connect.toId) ?? null : null}
                kind={connect.kind}
                onKind={(k) => setConnect((c) => ({ ...c, kind: k }))}
                onConnect={doConnect}
                onCancel={() => {
                  if (connect.toId) setConnect((c) => ({ ...c, toId: null }));
                  else setEditMode('select');
                }}
                chained={connect.chained}
              />
            </View>
          ) : null}

          {alignActive && !alignPending ? (
            <View style={styles.floatCard}>
              <PromptCard
                icon="move-outline"
                title="Align to imagery"
                body="Drag one node onto where it really is in the satellite photo (a pole base, a lid). You can then shift everything by the same amount."
                actions={[{ label: 'Cancel', kind: 'ghost', onPress: () => setEditMode('select') }]}
              />
            </View>
          ) : null}

          {alignPending ? (
            <View style={styles.floatCard}>
              <PromptCard
                icon="git-compare-outline"
                title={`Shift all ${nodes.length} nodes by the same amount?`}
                body={`${nodesById.get(alignPending.nodeId)?.label ?? 'Node'} moved ${formatLength(metersToFeet(alignDistance), units)}. Shifting all keeps footage the same and lines everything up with the imagery.`}
                actions={[
                  {
                    label: 'Shift all',
                    kind: 'primary',
                    onPress: async () => {
                      const d = degreeDelta(alignPending.from, alignPending.to);
                      setAlignPending(null);
                      await shiftAllNodes(d.dLat, d.dLng);
                      successHaptic();
                      toast.show(`Shifted ${nodes.length} nodes.`, { kind: 'success' });
                      setEditMode('select');
                    },
                  },
                  {
                    label: 'Only this node',
                    onPress: async () => {
                      const p = alignPending;
                      setAlignPending(null);
                      await moveNode(p.nodeId, p.to);
                      setEditMode('select');
                    },
                  },
                  { label: 'Cancel', kind: 'ghost', onPress: () => setAlignPending(null) },
                ]}
              />
            </View>
          ) : null}

          {mode === 'move' && !alignActive ? (
            <View style={[styles.hint, styles.glass]}>
              <Ionicons name="hand-left-outline" size={16} color={colors.accent} />
              <T v="label">Drag a node to move it</T>
            </View>
          ) : null}

          {canEdit ? (
            <View style={styles.controls}>
              <View style={[styles.segWrap, styles.glass]}>
                <Segmented<MapEditMode>
                  value={mode}
                  onChange={setEditMode}
                  options={[
                    { value: 'select', label: 'Select', icon: 'hand-left-outline' },
                    { value: 'move', label: 'Move', icon: 'move-outline' },
                    { value: 'connect', label: 'Connect', icon: 'git-commit-outline' },
                  ]}
                />
                <T v="caption" color={colors.textFaint} style={{ textAlign: 'center', marginTop: 4 }}>
                  Long-press the map to drop a pin
                </T>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Capture: take photo and add node"
                onPress={() => {
                  captureHaptic();
                  router.push(`/project/${id}/capture` as never);
                }}
                style={({ pressed }) => [styles.capture, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
              >
                <Ionicons name="camera" size={40} color={colors.onAccent} />
              </Pressable>
            </View>
          ) : (
            <View style={[styles.hint, styles.glass]}>
              <Ionicons name="eye-outline" size={16} color={colors.textMuted} />
              <T v="label" color={colors.textMuted}>
                View only: tap a node or span to see its details
              </T>
            </View>
          )}
        </View>
      ) : null}

      <NodeSheet
        node={selectedNode}
        photo={selectedPhoto}
        spans={spans}
        nodesById={nodesById}
        units={units}
        snap={snap}
        onSnapChange={setSnap}
        readOnly={!canEdit}
        onClose={() => setSelection(null)}
        onEdit={(nodeId) => router.push(`/project/${id}/node/${nodeId}` as never)}
        onConnectFrom={(nodeId) => {
          setSelection(null);
          setMode('connect');
          setConnect({ ...EMPTY_CONNECT, fromId: nodeId });
        }}
        onSelectSpan={(spanId) => setSelection({ kind: 'span', id: spanId })}
        onSelectNode={(nodeId) => setSelection({ kind: 'node', id: nodeId })}
        onDeleted={() => setSelection(null)}
      />
      <SpanSheet
        span={selectedSpan}
        readOnly={!canEdit}
        nodesById={nodesById}
        units={units}
        snap={snap}
        onSnapChange={setSnap}
        onClose={() => setSelection(null)}
        onSelectNode={(nodeId) => setSelection({ kind: 'node', id: nodeId })}
      />

      <DropPinSheet
        visible={dropAt != null}
        initialType={lastNode?.type ?? 'pole'}
        onPick={dropPin}
        onCancel={() => setDropAt(null)}
      />
      <MoreMenu visible={menuOpen} items={menuItems} onClose={() => setMenuOpen(false)} />

      {loading && !isActive ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : null}
      {!loading && !project ? (
        <View style={styles.loading}>
          <T v="title">Project not found</T>
          <T color={colors.textMuted}>It may have been deleted.</T>
        </View>
      ) : null}

      {toast.node}
    </View>
  );
}

const EMPTY_NODES: MapNode[] = [];
const EMPTY_SPANS: ReturnType<typeof useStore.getState>['spans'] = [];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  glass: { backgroundColor: colors.overlay, borderColor: colors.border, borderWidth: 1 },
  titleBox: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: radius.md, paddingHorizontal: space.md, justifyContent: 'center' },
  banners: { marginTop: space.sm, gap: space.xs, alignItems: 'flex-start', paddingRight: 64 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.overlay,
    maxWidth: '100%',
  },
  rail: { position: 'absolute', right: space.md },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, gap: space.sm },
  floatCard: { maxWidth: 560, width: '100%', alignSelf: 'center' },
  hint: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 36,
    borderRadius: radius.pill,
  },
  controls: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  segWrap: { flex: 1, borderRadius: radius.lg, padding: space.sm },
  capture: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
    ...shadow.card,
  },
  loading: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,15,20,0.6)',
    gap: space.sm,
  },
});
