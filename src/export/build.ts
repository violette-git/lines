// Platform-neutral: turns a bundle + format into bytes/text (or HTML for PDF) plus file metadata.
import JSZip from 'jszip';

import type { ExportBundle, ExportFormat } from '@/domain/contracts';
import { runQc } from '@/domain/qc';
import {
  buildCsv,
  buildGeoJSONString,
  buildKmz,
  buildReportHtml,
  buildShapefileZip,
  buildXlsx,
  dateStamp,
  loadReportPhotos,
  slugify,
} from './builders';

export interface FileTypeInfo {
  ext: string;
  mimeType: string;
  /** iOS Uniform Type Identifier. Only set where its preferred extension equals ext. */
  uti?: string;
}

export const FILE_TYPES: Record<ExportFormat, FileTypeInfo> = {
  kmz: { ext: 'kmz', mimeType: 'application/vnd.google-earth.kmz', uti: 'com.google.earth.kmz' },
  // CSV export is two tables (nodes + spans), delivered together in one zip.
  csv: { ext: 'zip', mimeType: 'application/zip', uti: 'public.zip-archive' },
  xlsx: { ext: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', uti: 'org.openxmlformats.spreadsheetml.sheet' },
  pdf: { ext: 'pdf', mimeType: 'application/pdf', uti: 'com.adobe.pdf' },
  // No UTI: public.json would make iOS append ".json" to the ".geojson" name.
  geojson: { ext: 'geojson', mimeType: 'application/geo+json' },
  shapefile: { ext: 'zip', mimeType: 'application/zip', uti: 'public.zip-archive' },
};

/** "<project-name-slug>_<yyyymmdd>" */
export function exportBaseName(bundle: ExportBundle): string {
  return `${slugify(bundle.project.name)}_${dateStamp(bundle.generatedAt)}`;
}

export function exportFileName(bundle: ExportBundle, format: ExportFormat): string {
  const base = exportBaseName(bundle);
  if (format === 'shapefile') return `${base}_shp.zip`;
  if (format === 'csv') return `${base}_csv.zip`;
  return `${base}.${FILE_TYPES[format].ext}`;
}

export interface ExportExtras {
  /** Map snapshot for the PDF cover. When absent the schematic diagram is drawn. */
  mapImageDataUrl?: string | null;
}

export type BuiltExport =
  | { kind: 'file'; fileName: string; type: FileTypeInfo; data: Uint8Array | string }
  | { kind: 'html-pdf'; fileName: string; type: FileTypeInfo; html: string };

export async function buildExport(bundle: ExportBundle, format: ExportFormat, extras: ExportExtras = {}): Promise<BuiltExport> {
  const fileName = exportFileName(bundle, format);
  const type = FILE_TYPES[format];
  switch (format) {
    case 'geojson':
      return { kind: 'file', fileName, type, data: buildGeoJSONString(bundle) };
    case 'kmz':
      return { kind: 'file', fileName, type, data: await buildKmz(bundle) };
    case 'csv': {
      const { nodesCsv, spansCsv } = buildCsv(bundle);
      const base = exportBaseName(bundle);
      const zip = new JSZip();
      zip.file(`${base}_nodes.csv`, nodesCsv);
      zip.file(`${base}_spans.csv`, spansCsv);
      return { kind: 'file', fileName, type, data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) };
    }
    case 'xlsx':
      return { kind: 'file', fileName, type, data: buildXlsx(bundle) };
    case 'shapefile':
      return { kind: 'file', fileName, type, data: await buildShapefileZip(bundle) };
    case 'pdf': {
      const photoDataUrls = await loadReportPhotos(bundle);
      const html = buildReportHtml(bundle, { photoDataUrls, mapImageDataUrl: extras.mapImageDataUrl ?? null, qc: runQc(bundle) });
      return { kind: 'html-pdf', fileName, type, html };
    }
    default: {
      const never: never = format;
      throw new Error(`Unsupported export format: ${String(never)}`);
    }
  }
}
