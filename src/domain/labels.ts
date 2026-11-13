import { NODE_TYPE_META } from './nodeSchemas';
import type { ClientTemplate, NodeType } from './types';

const DEFAULT_PATTERNS: Partial<Record<NodeType | '*', string>> = {
  pole: 'P-{seq}',
  handhole: 'HH-{seq}',
  vault: 'V-{seq}',
  pedestal: 'PED-{seq}',
  splice_case: 'SC-{seq}',
  riser: 'R-{seq}',
  anchor: 'A-{seq}',
  building_entry: 'BE-{seq}',
  '*': 'N-{seq}',
};

/** Builds a node label from a pattern. Tokens: {seq} {seq3} (zero padded) {type} {TYPE} {job}. */
export function makeLabel(
  type: NodeType,
  seq: number,
  opts: { template?: ClientTemplate | null; jobNumber?: string } = {},
): string {
  const pattern =
    opts.template?.labelPatterns[type] ??
    opts.template?.labelPatterns['*'] ??
    DEFAULT_PATTERNS[type] ??
    DEFAULT_PATTERNS['*']!;
  return pattern
    .replace(/\{seq3\}/g, String(seq).padStart(3, '0'))
    .replace(/\{seq\}/g, String(seq))
    .replace(/\{type\}/g, NODE_TYPE_META[type].label)
    .replace(/\{TYPE\}/g, NODE_TYPE_META[type].short)
    .replace(/\{job\}/g, opts.jobNumber ?? '');
}
