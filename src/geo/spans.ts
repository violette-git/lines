import type { MapNode, Span, SpanWithLength } from '@/domain/types';

import { distanceM, metersToFeet } from './distance';

/** Billable footage for a span given its straight-line length. */
export function spanTotalFt(span: Pick<Span, 'lengthOverrideFt' | 'sagPct' | 'slackFt'>, straightFt: number): number {
  if (span.lengthOverrideFt != null && Number.isFinite(span.lengthOverrideFt)) return span.lengthOverrideFt;
  const sag = Number.isFinite(span.sagPct) ? span.sagPct : 0;
  const slack = Number.isFinite(span.slackFt) ? span.slackFt : 0;
  return straightFt * (1 + sag / 100) + slack;
}

/**
 * Adds straight-line and total footage to each span. Spans whose endpoint nodes are missing are
 * skipped (they are orphans, e.g. mid-delete).
 */
export function computeSpanLengths(spans: Span[], nodes: MapNode[]): SpanWithLength[] {
  const byId = new Map<string, MapNode>();
  for (const n of nodes) byId.set(n.id, n);
  const out: SpanWithLength[] = [];
  for (const s of spans) {
    const a = byId.get(s.fromNodeId);
    const b = byId.get(s.toNodeId);
    if (!a || !b) continue;
    const straightFt = metersToFeet(distanceM(a.position, b.position));
    out.push({ ...s, straightFt, totalFt: spanTotalFt(s, straightFt) });
  }
  return out;
}

/**
 * Nearest other node of the same type within radiusM of `node`, or null. The node itself
 * (same id) is never returned.
 */
export function findPossibleDuplicate(node: MapNode, others: MapNode[], radiusM: number): MapNode | null {
  if (!(radiusM > 0)) return null;
  let best: MapNode | null = null;
  let bestD = Infinity;
  for (const o of others) {
    if (o.id === node.id || o.type !== node.type) continue;
    const d = distanceM(node.position, o.position);
    if (d <= radiusM && d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best;
}
