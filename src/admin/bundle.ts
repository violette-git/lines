// Turns a server project (ProjectData) into the Phase 1 ExportBundle so the dashboard reuses the
// exact same QC rules and export builders as the phone.
import type { ExportBundle, QcIssue } from '@/domain/contracts';
import { runQc } from '@/domain/qc';
import type { PhotoRef } from '@/domain/types';
import { computeSpanLengths } from '@/geo';

import type { ProjectData } from './types';

/** Fetches an http(s) or data: URL and returns base64 without the data: prefix. */
export async function urlToBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    if (comma < 0) return null;
    const meta = url.slice(0, comma);
    const body = url.slice(comma + 1);
    if (meta.endsWith(';base64')) return body;
    // Text payloads (e.g. SVG) are not usable as photos in exports.
    return null;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(bin);
  } catch {
    return null;
  }
}

export function toExportBundle(d: ProjectData, generatedAt: string = new Date().toISOString()): ExportBundle {
  return {
    project: d.project,
    nodes: d.nodes,
    spans: computeSpanLengths(d.spans, d.nodes),
    photos: d.photos,
    template: d.template,
    generatedAt,
    loadPhotoBase64: (p: PhotoRef) => urlToBase64(p.watermarkedUri || p.uri),
  };
}

export function qcFor(d: ProjectData): QcIssue[] {
  return runQc(toExportBundle(d));
}
