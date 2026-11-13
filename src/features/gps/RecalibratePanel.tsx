// "Recalibrate GPS" button that turns into a progress ring while sampling.
import { StyleSheet, View } from 'react-native';

import { Button, T } from '@/components/ui';
import { accuracyColor, formatAccuracy, type Units } from '@/features/common/format';
import { colors, space } from '@/theme';

import { ProgressRing } from './ProgressRing';
import type { RecalibrateState } from './useRecalibrate';

export function RecalibratePanel({
  nodeId,
  recal,
  units,
  onDone,
  compact,
}: {
  nodeId: string;
  recal: RecalibrateState;
  units: Units;
  onDone?: (ok: boolean) => void;
  compact?: boolean;
}) {
  if (!recal.running) {
    return (
      <View style={{ gap: space.xs }}>
        <Button
          title="Recalibrate GPS"
          icon="locate"
          kind="secondary"
          compact={compact}
          onPress={async () => {
            const fix = await recal.start(nodeId);
            onDone?.(fix != null);
          }}
        />
        {recal.error ? (
          <T v="caption" color={colors.warning}>
            {recal.error}
          </T>
        ) : (
          <T v="caption" color={colors.textFaint}>
            Stand at the asset and hold still while it averages.
          </T>
        )}
      </View>
    );
  }
  const acc = recal.latest?.accuracyM ?? null;
  return (
    <View style={styles.row}>
      <ProgressRing progress={recal.progress} size={64}>
        <T v="label">{Math.round(recal.progress * 100)}%</T>
      </ProgressRing>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="heading">Averaging GPS...</T>
        <T v="caption" color={colors.textMuted}>
          {recal.samples} samples{' '}
        </T>
        <T v="caption" color={accuracyColor(acc)}>
          {acc != null ? `Current ${formatAccuracy(acc, units)}` : 'Waiting for signal'}
        </T>
      </View>
      <Button title="Cancel" kind="ghost" compact onPress={recal.cancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
