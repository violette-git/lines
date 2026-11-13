// Builds the patch for changing a node's type: keeps fields shared by both schemas, applies the new
// type's template defaults, and relabels when the label is still the auto-generated one.
import { makeLabel } from '@/domain/labels';
import { NODE_SCHEMAS } from '@/domain/nodeSchemas';
import type { ClientTemplate, MapNode, NodeType } from '@/domain/types';

export function changeTypePatch(
  node: MapNode,
  type: NodeType,
  template: ClientTemplate | null,
  jobNumber: string,
): Partial<MapNode> {
  if (type === node.type) return {};
  const keys = new Set(NODE_SCHEMAS[type].map((f) => f.key));
  const fields: MapNode['fields'] = { ...(template?.defaults[type] ?? {}) };
  for (const [k, v] of Object.entries(node.fields)) if (keys.has(k) && v != null) fields[k] = v;
  const aiMeta: MapNode['aiMeta'] = {};
  for (const [k, m] of Object.entries(node.aiMeta)) if (keys.has(k)) aiMeta[k] = m;
  const autoOld = makeLabel(node.type, node.seq, { template, jobNumber });
  const label = node.label === autoOld ? makeLabel(type, node.seq, { template, jobNumber }) : node.label;
  return { type, fields, aiMeta, label };
}
