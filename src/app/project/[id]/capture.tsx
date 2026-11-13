// Capture: the speed loop. Shoot, the node lands on the map with an averaged GPS fix, confirm the
// label (or just shoot again), repeat. GPS sampling starts the moment this screen opens.
import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCanEdit } from '@/backend/authStore';
import { Button, Card, T } from '@/components/ui';
import { NODE_TYPE_META } from '@/domain/nodeSchemas';
import type { GeoFix, MapNode, NodeType } from '@/domain/types';
import { ConfirmCard, type CaptureDraft } from '@/features/capture/ConfirmCard';
import { GpsChip } from '@/features/capture/GpsChip';
import { pickFromLibrary } from '@/features/capture/pickPhoto';
import { shrinkPhoto } from '@/features/capture/processPhoto';
import { TypeChips } from '@/features/capture/TypeChips';
import { useRollingGps } from '@/features/capture/useRollingGps';
import { getPhotoStore } from '@/data';
import { errorMessage } from '@/features/common/confirm';
import { captureHaptic, errorHaptic, successHaptic, tapHaptic, warningHaptic } from '@/features/common/haptics';
import { useMapUiBus } from '@/features/common/mapUiBus';
import { useToast } from '@/features/common/Toast';
import { changeTypePatch } from '@/features/node-editor/changeType';
import { WatermarkQueue } from '@/features/watermark/WatermarkQueue';
import { getQuickFix } from '@/geo/gpsSampler';
import { FixQualityChip } from '@/gps/FixQualityChip';
import { useFixGate } from '@/gps/useFixGate';
import { useStore } from '@/state/store';
import { colors, radius, space } from '@/theme';

type CameraSupport = 'checking' | 'yes' | 'no';

interface Confirming {
  nodeId: string;
  photoUri: string | null;
  savedInMs: number | null;
}

export default function CaptureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const toast = useToast({ top: insets.top + 120 });

  const project = useStore((s) => s.projects.find((p) => p.id === id) ?? null);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const nodes = useStore((s) => s.nodes);
  const lastNodeId = useStore((s) => s.lastNodeId);
  const settings = useStore((s) => s.settings);
  const templates = useStore((s) => s.templates);
  const captureNode = useStore((s) => s.captureNode);
  const updateNode = useStore((s) => s.updateNode);
  const deleteNode = useStore((s) => s.deleteNode);
  const updateProject = useStore((s) => s.updateProject);

  // Make sure the project is open (deep link straight into capture).
  useEffect(() => {
    if (!id) return;
    const st = useStore.getState();
    (async () => {
      if (!st.ready) await st.init();
      if (useStore.getState().activeProjectId !== id) await useStore.getState().openProject(id);
    })().catch(() => {});
  }, [id]);

  // Viewers cannot capture; local projects (no orgId) always can.
  const canEdit = useCanEdit(project ? project.orgId ?? null : null);

  const gps = useRollingGps(settings.gpsAverageSeconds || 4, canEdit);
  // "Require RTK fixed" (GPS receiver settings): warn before saving a lower-grade point.
  const gate = useFixGate(gps.fix, gps.sourceStatus);
  const allowOnce = useRef(false);

  // Type: remembers the last captured type in this project (derived from the newest node).
  const lastType = useMemo<NodeType | null>(() => {
    if (activeProjectId !== id || nodes.length === 0) return null;
    return nodes.reduce((a, b) => (b.seq > a.seq ? b : a)).type;
  }, [nodes, activeProjectId, id]);
  const [type, setType] = useState<NodeType | null>(null);
  const effectiveType: NodeType = type ?? lastType ?? (project?.workType === 'underground' ? 'handhole' : 'pole');

  const lastNode = lastNodeId ? nodes.find((n) => n.id === lastNodeId) ?? null : null;
  const template = project?.templateId ? templates.find((t) => t.id === project.templateId) ?? null : null;

  // Camera availability and permission.
  const [permission, requestPermission] = useCameraPermissions();
  const [support, setSupport] = useState<CameraSupport>('checking');
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    let alive = true;
    CameraView.isAvailableAsync()
      .then((ok) => alive && setSupport(ok ? 'yes' : 'no'))
      .catch(() => alive && setSupport(Platform.OS === 'web' ? 'no' : 'yes'));
    return () => {
      alive = false;
    };
  }, []);

  // Ask automatically once per visit. Without the guard a denial that still allows asking again
  // (Android) produces a new permission object, re-runs this effect and re-prompts in a loop.
  const autoAsked = useRef(false);
  useEffect(() => {
    if (autoAsked.current || !canEdit) return;
    if (support === 'yes' && permission && !permission.granted && permission.canAskAgain) {
      autoAsked.current = true;
      void requestPermission();
    }
  }, [support, permission, requestPermission, canEdit]);

  // Capture state.
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [draft, setDraft] = useState<CaptureDraft>({ label: '', notes: '' });
  const [sessionCount, setSessionCount] = useState(0);
  const flash = useRef(new Animated.Value(0)).current;
  const confirmNode: MapNode | null = confirming ? nodes.find((n) => n.id === confirming.nodeId) ?? null : null;

  /** Writes label/notes edits from the confirm card. */
  const commitDraft = useCallback(async () => {
    if (!confirming) return;
    const n = useStore.getState().nodes.find((x) => x.id === confirming.nodeId);
    if (!n) return;
    const label = draft.label.trim() || n.label;
    if (label !== n.label || draft.notes !== n.notes) await updateNode(n.id, { label, notes: draft.notes });
  }, [confirming, draft, updateNode]);

  const flashShutter = () => {
    flash.setValue(0.85);
    Animated.timing(flash, { toValue: 0, duration: 220, useNativeDriver: true }).start();
  };

  const resolveFix = async (): Promise<GeoFix | null> => gps.getFixNow() ?? (await getQuickFix());

  const afterCreate = (node: MapNode, photoUri: string | null, t0: number) => {
    const ms = Math.round(Date.now() - t0);
    successHaptic();
    setSessionCount((c) => c + 1);
    setConfirming({ nodeId: node.id, photoUri, savedInMs: ms });
    setDraft({ label: node.label, notes: node.notes });
    if (node.possibleDuplicateOf) {
      const other = useStore.getState().nodes.find((n) => n.id === node.possibleDuplicateOf);
      warningHaptic();
      toast.show(`Looks like the same ${NODE_TYPE_META[node.type].label.toLowerCase()} as ${other?.label ?? 'an existing node'}.`, {
        kind: 'warning',
        actionLabel: 'Delete this one',
        onAction: () => {
          void deleteNode(node.id);
          setConfirming(null);
        },
      });
    }
  };

  /**
   * Fix gate: when RTK fixed is required and the fix is not, warn instead of saving. "Shoot anyway"
   * lets the next attempt through once. Returns true when the capture should stop here.
   */
  const blockedByFixGate = (retry: () => void): boolean => {
    if (!gate.ok && !allowOnce.current) {
      warningHaptic();
      toast.show(gate.reason ?? 'Waiting for RTK FIX.', {
        kind: 'warning',
        actionLabel: 'Shoot anyway',
        onAction: () => {
          allowOnce.current = true;
          retry();
        },
      });
      return true;
    }
    allowOnce.current = false;
    return false;
  };

  const shutter = async () => {
    if (busyRef.current) return;
    if (!project) return;
    if (blockedByFixGate(() => void shutter())) return;
    busyRef.current = true;
    setBusy(true);
    captureHaptic();
    flashShutter();
    const t0 = Date.now();
    try {
      // Position is taken at the instant of the shutter, from the rolling average.
      const fixAtShutter = gps.getFixNow();
      if (confirming) await commitDraft();
      setConfirming(null);
      const cam = cameraRef.current;
      if (!cam) throw new Error('Camera is not ready yet.');
      const pic = await cam.takePictureAsync({ quality: 0.7, exif: false });
      const fix = fixAtShutter ?? (await getQuickFix());
      if (!fix) {
        errorHaptic();
        toast.show('No GPS fix yet. Step into the open for a moment, then shoot again.', { kind: 'error' });
        return;
      }
      const photo = await shrinkPhoto(pic.uri, pic.width, pic.height);
      // The full-size camera original is no longer needed once the shrunk copy exists; deleting it
      // keeps a long day of shooting from piling up gigabytes in the cache directory.
      if (photo.uri !== pic.uri) void getPhotoStore().remove(pic.uri).catch(() => undefined);
      const node = await captureNode({
        type: effectiveType,
        fix,
        photoUri: photo.uri,
        photoWidth: photo.width,
        photoHeight: photo.height,
      });
      afterCreate(node, photo.uri, t0);
    } catch (e) {
      errorHaptic();
      toast.show(`Could not save that shot: ${errorMessage(e)}`, { kind: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const importPhoto = async () => {
    if (busyRef.current || !project) return;
    // Lock before opening the picker so a double tap (or the shutter) can't start a second capture.
    busyRef.current = true;
    try {
      const picked = await pickFromLibrary();
      if (!picked) return;
      setBusy(true);
      const t0 = Date.now();
      if (confirming) await commitDraft();
      setConfirming(null);
      const fix = picked.exifFix ?? (await resolveFix());
      if (!fix) {
        toast.show('That photo has no GPS and we have no fix yet. Try again once GPS is ready.', { kind: 'error' });
        return;
      }
      const node = await captureNode({
        type: effectiveType,
        fix,
        photoUri: picked.uri,
        photoWidth: picked.width,
        photoHeight: picked.height,
      });
      afterCreate(node, picked.uri, t0);
      if (!picked.exifFix) toast.show('Photo had no GPS, so your current location was used.', { kind: 'info' });
    } catch (e) {
      toast.show(`Import failed: ${errorMessage(e)}`, { kind: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const captureWithoutPhoto = async () => {
    if (busyRef.current || !project) return;
    if (blockedByFixGate(() => void captureWithoutPhoto())) return;
    busyRef.current = true;
    setBusy(true);
    const t0 = Date.now();
    try {
      if (confirming) await commitDraft();
      setConfirming(null);
      const fix = await resolveFix();
      if (!fix) {
        toast.show('No location available. Allow location access, or drop a pin on the map instead.', { kind: 'error' });
        return;
      }
      const node = await captureNode({ type: effectiveType, fix });
      afterCreate(node, null, t0);
    } catch (e) {
      toast.show(`Could not save: ${errorMessage(e)}`, { kind: 'error' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onNext = async () => {
    tapHaptic();
    await commitDraft();
    setConfirming(null);
  };

  const onDone = async () => {
    await commitDraft();
    if (confirming) useMapUiBus.getState().requestSelectNode(confirming.nodeId);
    setConfirming(null);
    close();
  };

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/project/${id}` as never);
  };

  const onRetake = async () => {
    if (!confirming) return;
    warningHaptic();
    await deleteNode(confirming.nodeId);
    setSessionCount((c) => Math.max(0, c - 1));
    setConfirming(null);
  };

  const onChangeType = async (t: NodeType) => {
    if (!confirmNode || !project) return;
    const patch = changeTypePatch(confirmNode, t, template, project.jobNumber);
    await updateNode(confirmNode.id, patch);
    if (patch.label) setDraft((d) => ({ ...d, label: patch.label ?? d.label }));
    setType(t);
  };

  const units = settings.units;
  const cameraUsable = support === 'yes' && permission?.granted;
  const showFixQuality = gps.source === 'external_tcp' || (gps.fix?.fixQuality != null && gps.fix.fixQuality !== 'gps');

  if (project && !canEdit) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
        <View style={[styles.noCam, { paddingTop: insets.top + 120 }]}>
          <Card style={{ gap: space.md, maxWidth: 480, width: '100%' }}>
            <Ionicons name="eye-outline" size={36} color={colors.textMuted} />
            <T v="title">View only</T>
            <T color={colors.textMuted}>
              Your role in this company can look at {project.name} but not add nodes. Ask a manager or admin to change your role if you need to capture.
            </T>
            <Button title="Back to map" icon="map-outline" onPress={close} />
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }} />
      <WatermarkQueue />

      {cameraUsable ? (
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          enableTorch={torch}
          animateShutter={false}
          onCameraReady={() => setReady(true)}
          onMountError={() => setSupport('no')}
        />
      ) : (
        <NoCamera
          support={support}
          permission={permission}
          onRequest={() => void requestPermission()}
          onImport={importPhoto}
          onUseLocation={captureWithoutPhoto}
          busy={busy}
          topInset={insets.top}
        />
      )}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', opacity: flash }]} />

      {/* Top overlay */}
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={styles.topRow}>
          <RoundBtn icon="close" label="Close camera" onPress={close} />
          {showFixQuality ? (
            <FixQualityChip fix={gps.fix} units={units} sourceStatus={gps.sourceStatus} />
          ) : (
            <GpsChip status={gps.status} accuracyM={gps.fix?.accuracyM} samples={gps.sampleCount} units={units} />
          )}
          <View style={{ flex: 1 }} />
          {cameraUsable ? (
            <RoundBtn
              icon={torch ? 'flashlight' : 'flashlight-outline'}
              label={torch ? 'Torch off' : 'Torch on'}
              active={torch}
              onPress={() => setTorch((v) => !v)}
            />
          ) : null}
        </View>
        <View style={{ marginTop: space.sm }}>
          <TypeChips value={effectiveType} onChange={setType} />
        </View>
        {project ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={project.walkMode ? 'Turn walk mode off' : 'Turn walk mode on'}
            onPress={() => {
              tapHaptic();
              void updateProject(project.id, { walkMode: !project.walkMode });
            }}
            style={[styles.walk, { borderColor: project.walkMode ? colors.accent : colors.borderStrong }]}
          >
            <Ionicons name="walk" size={16} color={project.walkMode ? colors.accent : colors.textMuted} />
            <T v="label" color={project.walkMode ? colors.text : colors.textMuted}>
              {project.walkMode
                ? lastNode
                  ? `Walk mode: connects to ${lastNode.label}`
                  : 'Walk mode: first node starts the line'
                : 'Walk mode off'}
            </T>
          </Pressable>
        ) : null}
      </View>

      {/* Bottom: confirm card + controls */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.bottom, { paddingBottom: insets.bottom + space.md }]}
        pointerEvents="box-none"
      >
        {confirming && confirmNode ? (
          <View style={{ paddingHorizontal: space.md, marginBottom: space.md }}>
            <ConfirmCard
              node={confirmNode}
              photoUri={confirming.photoUri}
              draft={draft}
              onDraft={setDraft}
              savedInMs={confirming.savedInMs}
              units={units}
              onNext={onNext}
              onDone={onDone}
              onRetake={onRetake}
              onChangeType={onChangeType}
            />
          </View>
        ) : null}
        <View style={styles.controls}>
          <SideBtn icon="images-outline" label="Import" onPress={importPhoto} />
          {cameraUsable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Take photo and capture node"
              disabled={!ready}
              onPress={shutter}
              style={({ pressed }) => [styles.shutterOuter, { opacity: ready ? 1 : 0.5, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
            >
              <View style={[styles.shutterInner, { backgroundColor: NODE_TYPE_META[effectiveType].color }]}>
                {busy ? <ActivityIndicator color={colors.onAccent} size="large" /> : <Ionicons name="camera" size={38} color={colors.onAccent} />}
              </View>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Capture node at current location"
              onPress={captureWithoutPhoto}
              style={({ pressed }) => [styles.shutterOuter, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
            >
              <View style={[styles.shutterInner, { backgroundColor: NODE_TYPE_META[effectiveType].color }]}>
                {busy ? <ActivityIndicator color={colors.onAccent} size="large" /> : <Ionicons name="locate" size={36} color={colors.onAccent} />}
              </View>
            </Pressable>
          )}
          <SideBtn icon="map" label={sessionCount > 0 ? `Done (${sessionCount})` : 'Map'} onPress={confirming ? onDone : close} />
        </View>
      </KeyboardAvoidingView>

      {toast.node}
    </View>
  );
}

function RoundBtn({
  icon,
  label,
  onPress,
  active,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: active ? colors.accent : colors.overlay, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <Ionicons name={icon} size={24} color={active ? colors.onAccent : colors.text} />
    </Pressable>
  );
}

function SideBtn({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.side, { opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={styles.sideIcon}>
        <Ionicons name={icon} size={26} color={colors.text} />
      </View>
      <T v="caption" color={colors.text}>
        {label}
      </T>
    </Pressable>
  );
}

function NoCamera({
  support,
  permission,
  onRequest,
  onImport,
  onUseLocation,
  busy,
  topInset,
}: {
  support: CameraSupport;
  permission: ReturnType<typeof useCameraPermissions>[0];
  onRequest: () => void;
  onImport: () => void;
  onUseLocation: () => void;
  busy: boolean;
  topInset: number;
}) {
  if (support === 'checking' || (support === 'yes' && !permission)) {
    return (
      <View style={[styles.noCam, { paddingTop: topInset + 160 }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  const denied = support === 'yes' && permission && !permission.granted;
  return (
    <View style={[styles.noCam, { paddingTop: topInset + 170 }]}>
      <Card style={{ gap: space.md, maxWidth: 480, width: '100%' }}>
        <Ionicons name={denied ? 'camera-outline' : 'phone-portrait-outline'} size={36} color={colors.accent} />
        <T v="title">{denied ? 'Camera access needed' : 'Camera not available here'}</T>
        <T color={colors.textMuted}>
          {denied
            ? 'LineMap Pro uses the camera to photograph each pole or handhole and drop it on the map with its GPS position. Photos stay on this device.'
            : 'You can still import a photo (its GPS is used when present) or capture a node at your current location.'}
        </T>
        {denied ? (
          permission?.canAskAgain ? (
            <Button title="Allow camera" icon="camera" onPress={onRequest} />
          ) : (
            <Button title="Open Settings" icon="settings-outline" onPress={() => void Linking.openSettings()} />
          )
        ) : null}
        <Button title="Import photo" icon="images-outline" kind="secondary" onPress={onImport} disabled={busy} />
        <Button title="Use current location (no photo)" icon="locate" kind="secondary" onPress={onUseLocation} loading={busy} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', left: 0, right: 0, top: 0 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  round: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  walk: {
    alignSelf: 'flex-start',
    marginLeft: space.md,
    marginTop: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.overlay,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: space.lg,
  },
  shutterOuter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  shutterInner: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  side: { alignItems: 'center', gap: 4, minWidth: 72 },
  sideIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  noCam: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, alignItems: 'center', padding: space.lg },
});
