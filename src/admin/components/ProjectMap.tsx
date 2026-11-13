// Read-only map for the dashboard: the shared LineMap engine in Select mode (click a node or span
// to inspect it; nothing can be moved or connected from the office).
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { Basemap, MapNode, Span } from '@/domain/types';
import { computeSpanLengths } from '@/geo';
import { LineMapView } from '@/map';
import { colors, radius } from '@/theme';

import { Txt } from './kit';

export function ProjectMap({
  nodes,
  spans,
  height = 420,
  selectedNodeId = null,
  onNodePress,
  onSpanPress,
  onBackgroundPress,
  fitKey,
}: {
  nodes: MapNode[];
  spans: Span[];
  height?: number;
  selectedNodeId?: string | null;
  onNodePress?: (id: string) => void;
  onSpanPress?: (id: string) => void;
  onBackgroundPress?: () => void;
  /** Change to re-fit the camera (e.g. when the project filter changes). */
  fitKey?: string;
}) {
  const [basemap, setBasemap] = useState<Basemap>('hybrid');
  const [fitToken, setFitToken] = useState(1);
  const withLengths = useMemo(() => computeSpanLengths(spans, nodes), [spans, nodes]);

  useEffect(() => {
    // Fit after the data arrives or the filter changes.
    setFitToken((t) => t + 1);
  }, [fitKey, nodes.length]);

  return (
    <View style={[styles.wrap, { height }]}>
      <LineMapView
        nodes={nodes}
        spans={withLengths}
        selectedNodeId={selectedNodeId}
        selectedSpanId={null}
        basemap={basemap}
        globalIconScale={0.85}
        editMode="select"
        units="imperial"
        userLocation={null}
        showAccuracy={false}
        fitToken={fitToken}
        centerOnUserToken={0}
        onNodePress={(id) => onNodePress?.(id)}
        onNodeMoved={() => {}}
        onSpanPress={(id) => onSpanPress?.(id)}
        onMapPress={() => onBackgroundPress?.()}
      />
      <View style={styles.controls} pointerEvents="box-none">
        {(['hybrid', 'satellite', 'streets'] as Basemap[]).map((b) => (
          <Pressable
            key={b}
            onPress={() => setBasemap(b)}
            accessibilityRole="button"
            accessibilityState={{ selected: basemap === b }}
            style={[styles.chip, basemap === b && styles.chipOn]}
          >
            <Txt v="micro" color={basemap === b ? colors.onAccent : colors.text} style={{ textTransform: 'capitalize', fontWeight: '600' }}>
              {b}
            </Txt>
          </Pressable>
        ))}
        <Pressable onPress={() => setFitToken((t) => t + 1)} accessibilityRole="button" accessibilityLabel="Fit map to all nodes" style={styles.chip}>
          <Ionicons name="scan-outline" size={13} color={colors.text} />
        </Pressable>
      </View>
      {nodes.length === 0 ? (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <Txt v="small" color={colors.textMuted}>
            No nodes mapped yet
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', overflow: 'hidden', backgroundColor: colors.bg },
  controls: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 4 },
  chip: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(11,15,20,0.82)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    cursor: 'pointer',
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  emptyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
