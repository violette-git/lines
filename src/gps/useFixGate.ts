// Capture gating: when settings.requireRtkFixed is on and the current fix is not RTK fixed, capture
// should show a warning chip with "Shoot anyway" instead of silently saving a lower-grade point.
import type { GeoFix } from '@/domain/types';
import { useStore } from '@/state/store';

import type { SourceStatus } from './positionSource';
import { evaluateFixGate, type FixGateResult } from './quality';

/**
 * Usage in capture: `const gate = useFixGate(gps.fix, gps.sourceStatus)`.
 * Returns { ok, reason, required }. Always ok when requireRtkFixed is off.
 */
export function useFixGate(fix: GeoFix | null | undefined, sourceStatus?: SourceStatus | null): FixGateResult {
  const requireRtkFixed = useStore((s) => s.settings.requireRtkFixed);
  return evaluateFixGate(fix, requireRtkFixed, sourceStatus);
}
