// Converts LineMapViewProps into the serializable CoreState the shared map engine consumes.
import { useMemo } from 'react';

import type { LineMapViewProps } from '@/domain/contracts';
import { NODE_TYPE_META } from '@/domain/nodeSchemas';
import type { MapNode, SpanWithLength } from '@/domain/types';

import { getBasemap, type BasemapOptions } from './basemaps';
import type { CoreNode, CoreSpan, CoreState } from './core/mapCore';

export type CoreStateInput = Pick<
  LineMapViewProps,
  | 'nodes'
  | 'spans'
  | 'selectedNodeId'
  | 'selectedSpanId'
  | 'basemap'
  | 'globalIconScale'
  | 'editMode'
  | 'units'
  | 'userLocation'
  | 'showAccuracy'
>;

export function toCoreNode(n: MapNode): CoreNode {
  const meta = NODE_TYPE_META[n.type] ?? NODE_TYPE_META.custom;
  return {
    id: n.id,
    lat: n.position.lat,
    lng: n.position.lng,
    type: n.type,
    label: n.label ?? '',
    color: meta.color,
    short: meta.short,
    scale: Number.isFinite(n.iconScale) ? n.iconScale : 1,
    status: n.status,
    dup: !!n.possibleDuplicateOf,
    accuracyM: n.position.accuracyM,
  };
}

export function toCoreSpan(s: SpanWithLength): CoreSpan {
  return {
    id: s.id,
    from: s.fromNodeId,
    to: s.toNodeId,
    kind: s.kind,
    sagPct: s.sagPct,
    slackFt: s.slackFt,
    overrideFt: s.lengthOverrideFt,
    totalFt: s.totalFt,
  };
}

export function buildCoreState(p: CoreStateInput, tiles?: BasemapOptions): CoreState {
  return {
    nodes: p.nodes.map(toCoreNode),
    spans: p.spans.map(toCoreSpan),
    selectedNodeId: p.selectedNodeId,
    selectedSpanId: p.selectedSpanId,
    basemap: getBasemap(p.basemap, tiles),
    globalIconScale: p.globalIconScale,
    editMode: p.editMode,
    units: p.units,
    user: p.userLocation
      ? { lat: p.userLocation.lat, lng: p.userLocation.lng, accuracyM: p.userLocation.accuracyM }
      : null,
    showAccuracy: p.showAccuracy,
  };
}

/** Memoized CoreState; recomputed only when a rendering-relevant prop changes identity. */
export function useCoreState(p: CoreStateInput, tiles?: BasemapOptions): CoreState {
  const {
    nodes,
    spans,
    selectedNodeId,
    selectedSpanId,
    basemap,
    globalIconScale,
    editMode,
    units,
    userLocation,
    showAccuracy,
  } = p;
  const providerId = tiles?.providerId ?? null;
  const apiKey = tiles?.apiKey ?? null;
  const useTileProtocol = !!tiles?.useTileProtocol;
  return useMemo(
    () =>
      buildCoreState({
        nodes,
        spans,
        selectedNodeId,
        selectedSpanId,
        basemap,
        globalIconScale,
        editMode,
        units,
        userLocation,
        showAccuracy,
      }, { providerId, apiKey, useTileProtocol }),
    [
      nodes,
      spans,
      selectedNodeId,
      selectedSpanId,
      basemap,
      globalIconScale,
      editMode,
      units,
      userLocation,
      showAccuracy,
      providerId,
      apiKey,
      useTileProtocol,
    ],
  );
}
