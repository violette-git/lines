// Public API of the export module.
//   exportProject(bundle, format)  builds the file and hands it to the user (share sheet / download).
// Pure builders live in ./builders and can be imported without any platform modules.
import type { ExportBundle, ExportFormat } from '@/domain/contracts';
import { buildExport, type ExportExtras } from './build';
import { deliver } from './deliver';

export * from './builders';
export { buildExport, exportBaseName, exportFileName, FILE_TYPES, type BuiltExport, type ExportExtras, type FileTypeInfo } from './build';
export { runQc } from '@/domain/qc';

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF report',
  kmz: 'Google Earth (KMZ)',
  xlsx: 'Excel workbook',
  csv: 'CSV (nodes + spans)',
  geojson: 'GeoJSON',
  shapefile: 'Shapefile (zip)',
};

/**
 * Builds the export and delivers it.
 * Native: writes to the cache directory and opens the share sheet (PDF via expo-print).
 * Web: triggers a browser download (PDF opens a print window).
 * Returns the file name and, on native, the local file URI.
 */
export async function exportProject(
  bundle: ExportBundle,
  format: ExportFormat,
  extras: ExportExtras = {},
): Promise<{ fileName: string; uri?: string }> {
  const built = await buildExport(bundle, format, extras);
  return deliver(built);
}
