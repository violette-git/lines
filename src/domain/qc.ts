// Export quality checks. Pure: uses only fields on the bundle (no geo math).
import type { ExportBundle, QcIssue } from './contracts';
import { NODE_SCHEMAS } from './nodeSchemas';
import type { FieldValue, MapNode } from './types';

/** GPS fixes with a worse (larger) accuracy radius than this are flagged. */
export const QC_MAX_GPS_ACCURACY_M = 10;
/** Typical maximum aerial span; longer ones usually mean a missed pole. */
export const QC_MAX_AERIAL_SPAN_FT = 600;

function blank(v: FieldValue | undefined): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (typeof v === 'number' && !Number.isFinite(v));
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Runs every QC rule over the bundle. Errors come first, then warnings; within each, issues are
 * ordered by node capture sequence, then span order.
 *
 * Note: anchors are exempt from the orphan rule because a guy anchor is tied to its pole by a guy
 * wire, not a cable span, so flagging every anchor would be noise.
 */
export function runQc(bundle: ExportBundle): QcIssue[] {
  const issues: (QcIssue & { order: number })[] = [];
  const nodes = [...bundle.nodes].sort((a, b) => a.seq - b.seq);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeOrder = new Map(nodes.map((n, i) => [n.id, i]));
  const photoCount = new Map<string, number>();
  for (const p of bundle.photos) photoCount.set(p.nodeId, (photoCount.get(p.nodeId) ?? 0) + 1);
  const spanned = new Set<string>();
  for (const s of bundle.spans) {
    spanned.add(s.fromNodeId);
    spanned.add(s.toNodeId);
  }

  const name = (n: MapNode) => n.label || `#${n.seq}`;
  const addNode = (n: MapNode, severity: QcIssue['severity'], message: string) =>
    issues.push({ severity, nodeId: n.id, message: `${name(n)}: ${message}`, order: nodeOrder.get(n.id) ?? 0 });

  for (const n of nodes) {
    // 1. Template required fields.
    const required = bundle.template?.requiredFields?.[n.type] ?? [];
    const missing = required.filter((k) => blank(n.fields?.[k]));
    if (missing.length) {
      const defs = NODE_SCHEMAS[n.type] ?? [];
      const labels = missing.map((k) => defs.find((d) => d.key === k)?.label ?? k);
      addNode(n, 'error', `missing required field${missing.length > 1 ? 's' : ''}: ${labels.join(', ')}`);
    }

    // 2. No photos.
    if (!photoCount.get(n.id)) addNode(n, 'warning', 'no photo');

    // 3. Unreviewed AI values.
    if (n.status !== 'reviewed') {
      const ai = Object.values(n.aiMeta ?? {}).filter((m) => m && m.source === 'ai');
      const est = ai.filter((m) => m.isEstimate).length;
      if (ai.length) {
        addNode(
          n,
          'warning',
          `${ai.length} AI-filled value${ai.length > 1 ? 's' : ''} not reviewed` +
            (est ? ` (${est} visual estimate${est > 1 ? 's' : ''})` : ''),
        );
      }
    }

    // 4. Possible duplicate.
    if (n.possibleDuplicateOf) {
      const other = byId.get(n.possibleDuplicateOf);
      addNode(n, 'warning', `possible duplicate of ${other ? name(other) : 'a deleted node'}`);
    }

    // 5. GPS accuracy.
    const acc = finite(n.position?.accuracyM);
    if (acc !== null && acc > QC_MAX_GPS_ACCURACY_M) {
      addNode(n, 'warning', `GPS accuracy ${Math.round(acc * 10) / 10} m is worse than ${QC_MAX_GPS_ACCURACY_M} m`);
    }
    if (finite(n.position?.lat) === null || finite(n.position?.lng) === null) {
      addNode(n, 'error', 'no valid position');
    }

    // 7. Orphans.
    if (nodes.length > 1 && n.type !== 'anchor' && !spanned.has(n.id)) {
      addNode(n, 'warning', 'not connected to any span');
    }

    // 8. AI failed.
    if (n.status === 'ai_failed') addNode(n, 'warning', 'AI analysis failed; fields need manual entry');
  }

  // 6. Spans.
  bundle.spans.forEach((s, i) => {
    const order = nodes.length + i;
    const a = byId.get(s.fromNodeId);
    const b = byId.get(s.toNodeId);
    const label = `Span ${a ? name(a) : '?'} to ${b ? name(b) : '?'}`;
    const add = (severity: QcIssue['severity'], message: string) =>
      issues.push({ severity, spanId: s.id, message: `${label}: ${message}`, order });
    if (!a || !b) {
      add('error', 'references a node that no longer exists');
      return;
    }
    const straight = finite(s.straightFt) ?? 0;
    const total = finite(s.totalFt) ?? 0;
    const override = finite(s.lengthOverrideFt);
    if (total <= 0 || (straight <= 0 && override === null)) {
      add('warning', 'zero length (both ends at the same position?)');
    }
    const distance = straight > 0 ? straight : override ?? 0;
    if (s.kind === 'aerial' && distance > QC_MAX_AERIAL_SPAN_FT) {
      add('warning', `aerial span ${Math.round(distance)} ft exceeds the typical ${QC_MAX_AERIAL_SPAN_FT} ft maximum (missed pole?)`);
    }
  });

  return issues
    .sort((x, y) => (x.severity === y.severity ? 0 : x.severity === 'error' ? -1 : 1) || x.order - y.order)
    .map(({ order: _order, ...rest }) => rest);
}
