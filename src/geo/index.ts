// Pure geo helpers. GPS sampling (expo-location) lives in ./gpsSampler and is NOT re-exported here
// so that importing '@/geo' stays free of native modules.
export {
  EARTH_MEAN_RADIUS_M,
  FEET_PER_METER,
  FEET_PER_MILE,
  bearingDeg,
  boundsOf,
  degreeDelta,
  destinationPoint,
  distanceM,
  feetToMeters,
  haversineM,
  metersPerDegree,
  metersToFeet,
  midpoint,
  offsetMeters,
  offsetPosition,
  vincentyM,
} from './distance';
export { computeSpanLengths, findPossibleDuplicate, spanTotalFt } from './spans';
export { averageFixes } from './averaging';
export { formatLength, groupThousands } from './format';
