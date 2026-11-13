import { formatAccuracy, formatDateTimeWithZone, formatLatLng, typeLabel, type Units } from '@/features/common/format';
import type { MapNode, PhotoRef, Project } from '@/domain/types';

export interface WatermarkJob {
  photoId: string;
  uri: string;
  width: number;
  height: number;
  /** Lines burned into the bottom bar, top to bottom. */
  lines: string[];
  /** Identifies the content; a change (label edit) triggers a re-render. */
  signature: string;
}

export interface WatermarkRendererProps {
  job: WatermarkJob;
  /** Called once with the durable watermarked URI, or null on failure. */
  onDone: (uri: string | null) => void;
}

export function buildWatermarkJob(photo: PhotoRef, node: MapNode, project: Project, units: Units): WatermarkJob {
  const fix = photo.fix ?? node.position;
  const head = [node.label, typeLabel(node.type)].filter(Boolean).join('  |  ');
  const proj = [project.name, project.jobNumber ? `Job ${project.jobNumber}` : '', project.client].filter(Boolean).join('  |  ');
  const acc = fix.accuracyM != null ? formatAccuracy(fix.accuracyM, units) : 'accuracy unknown';
  const samples = fix.samples > 1 ? ` (${fix.samples} samples avg)` : '';
  const lines = [
    head,
    `${formatLatLng(fix.lat)}, ${formatLatLng(fix.lng)}   ${acc}${samples}`,
    formatDateTimeWithZone(photo.takenAt || fix.capturedAt),
    proj,
  ].filter((l) => l.trim().length > 0);
  return {
    photoId: photo.id,
    uri: photo.uri,
    width: photo.width,
    height: photo.height,
    lines,
    signature: lines.join('\n'),
  };
}
