// Reads a GPS position out of the EXIF object returned by expo-image-picker.
// iOS nests GPS under "{GPS}" (Latitude, LatitudeRef...), Android flattens it (GPSLatitude, GPSLatitudeRef),
// and values may be decimal numbers, rational strings ("33/1,30/1,1234/100") or [d, m, s] arrays.
import type { GeoFix } from '@/domain/types';

type Exif = Record<string, unknown>;

function rational(v: string): number {
  const [n, d] = v.split('/').map((x) => Number(x.trim()));
  if (!Number.isFinite(n)) return NaN;
  return d && Number.isFinite(d) ? n / d : n;
}

function toDegrees(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) {
    const [d = 0, m = 0, s = 0] = v.map((x) => (typeof x === 'number' ? x : rational(String(x))));
    const r = d + m / 60 + s / 3600;
    return Number.isFinite(r) ? r : null;
  }
  if (typeof v === 'string') {
    if (v.includes(',')) return toDegrees(v.split(','));
    const r = v.includes('/') ? rational(v) : Number(v);
    return Number.isFinite(r) ? r : null;
  }
  return null;
}

function pick(exif: Exif, keys: string[]): unknown {
  const gps = (exif['{GPS}'] ?? exif.GPS) as Exif | undefined;
  for (const k of keys) {
    if (exif[k] != null) return exif[k];
    if (gps && gps[k] != null) return gps[k];
  }
  return undefined;
}

function parseExifDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // "2026:11:12 14:03:22"
  const m = v.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function fixFromExif(exif: Exif | null | undefined): GeoFix | null {
  if (!exif) return null;
  let lat = toDegrees(pick(exif, ['GPSLatitude', 'Latitude']));
  let lng = toDegrees(pick(exif, ['GPSLongitude', 'Longitude']));
  if (lat == null || lng == null) return null;
  const latRef = String(pick(exif, ['GPSLatitudeRef', 'LatitudeRef']) ?? 'N').toUpperCase();
  const lngRef = String(pick(exif, ['GPSLongitudeRef', 'LongitudeRef']) ?? 'E').toUpperCase();
  if (latRef.startsWith('S') && lat > 0) lat = -lat;
  if (lngRef.startsWith('W') && lng > 0) lng = -lng;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;

  const accRaw = toDegrees(pick(exif, ['GPSHPositioningError', 'HPositioningError']));
  const altRaw = toDegrees(pick(exif, ['GPSAltitude', 'Altitude']));
  const altRef = Number(pick(exif, ['GPSAltitudeRef', 'AltitudeRef']) ?? 0);
  const taken =
    parseExifDate(pick(exif, ['DateTimeOriginal', 'DateTime'])) ?? new Date().toISOString();

  return {
    lat,
    lng,
    accuracyM: accRaw != null && accRaw > 0 ? accRaw : null,
    altitudeM: altRaw != null ? (altRef === 1 ? -altRaw : altRaw) : null,
    samples: 1,
    capturedAt: taken,
    source: 'external',
  };
}
