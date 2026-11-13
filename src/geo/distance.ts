// Geodesic math on the WGS84 ellipsoid. Pure functions, no platform dependencies.
import type { LatLng } from '@/domain/types';

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = (1 - WGS84_F) * WGS84_A;
/** IUGG mean Earth radius, used by the spherical formulas. */
export const EARTH_MEAN_RADIUS_M = 6371008.8;

export const FEET_PER_METER = 1 / 0.3048;
export const FEET_PER_MILE = 5280;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function metersToFeet(m: number): number {
  return m / 0.3048;
}

export function feetToMeters(ft: number): number {
  return ft * 0.3048;
}

/** Great-circle distance on a sphere of mean Earth radius, meters. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Vincenty inverse formula on WGS84, meters. Returns null when the iteration does not converge
 * (nearly antipodal points).
 */
export function vincentyM(a: LatLng, b: LatLng): number | null {
  const L = toRad(b.lng - a.lng);
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(toRad(a.lat)));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(toRad(b.lat)));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let iterations = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cosSqAlpha = 0;
  let cos2SigmaM = 0;
  let lambdaPrev: number;

  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) return 0; // coincident points
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    // Equatorial line: cosSqAlpha = 0
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0;
    const C = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    lambdaPrev = lambda;
    lambda =
      L +
      (1 - C) *
        WGS84_F *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    iterations++;
  } while (Math.abs(lambda - lambdaPrev) > 1e-12 && iterations < 200);

  if (iterations >= 200 || !Number.isFinite(lambda)) return null;

  const uSq = (cosSqAlpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const s = WGS84_B * A * (sigma - deltaSigma);
  return Number.isFinite(s) ? s : null;
}

/** Ellipsoidal distance in meters (Vincenty), falling back to haversine if Vincenty fails. */
export function distanceM(a: LatLng, b: LatLng): number {
  if (a.lat === b.lat && a.lng === b.lng) return 0;
  const v = vincentyM(a, b);
  return v ?? haversineM(a, b);
}

/** Initial great-circle bearing from a to b, degrees clockwise from true north, 0..360. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dL = toRad(b.lng - a.lng);
  const y = Math.sin(dL) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dL);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle midpoint. */
export function midpoint(a: LatLng, b: LatLng): LatLng {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const l1 = toRad(a.lng);
  const dL = toRad(b.lng - a.lng);
  const bx = Math.cos(phi2) * Math.cos(dL);
  const by = Math.cos(phi2) * Math.sin(dL);
  const phi = Math.atan2(Math.sin(phi1) + Math.sin(phi2), Math.sqrt((Math.cos(phi1) + bx) ** 2 + by * by));
  const lam = l1 + Math.atan2(by, Math.cos(phi1) + bx);
  return { lat: toDeg(phi), lng: ((toDeg(lam) + 540) % 360) - 180 };
}

/** Shift a point by degree deltas (used for "shift all nodes" calibration). */
export function offsetPosition(p: LatLng, dLat: number, dLng: number): LatLng {
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

/** Meters per degree of latitude and longitude at a given latitude (WGS84 series). */
export function metersPerDegree(lat: number): { lat: number; lng: number } {
  const phi = toRad(lat);
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi),
    lng: 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

/** Shift a point by meters north and east (local tangent plane; accurate for short distances). */
export function offsetMeters(p: LatLng, northM: number, eastM: number): LatLng {
  const m = metersPerDegree(p.lat);
  return { lat: p.lat + northM / m.lat, lng: p.lng + eastM / m.lng };
}

/** Point at distance along a bearing (local tangent plane; fine for distances under a few km). */
export function destinationPoint(p: LatLng, bearing: number, distM: number): LatLng {
  const b = toRad(bearing);
  return offsetMeters(p, distM * Math.cos(b), distM * Math.sin(b));
}

/** Degree deltas that move `from` onto `to` (for shiftAllNodes). */
export function degreeDelta(from: LatLng, to: LatLng): { dLat: number; dLng: number } {
  return { dLat: to.lat - from.lat, dLng: to.lng - from.lng };
}

export function boundsOf(
  points: LatLng[],
): { minLat: number; minLng: number; maxLat: number; maxLng: number } | null {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (minLat === Infinity) return null;
  return { minLat, minLng, maxLat, maxLng };
}
