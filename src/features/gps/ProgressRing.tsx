// Progress ring made of segments (no SVG dependency). progress 0..1.
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { colors } from '@/theme';

export function ProgressRing({
  progress,
  size = 64,
  segments = 24,
  color = colors.accent,
  children,
}: {
  progress: number;
  size?: number;
  segments?: number;
  color?: string;
  children?: ReactNode;
}) {
  const p = Math.max(0, Math.min(1, progress));
  const lit = Math.round(p * segments);
  const segW = Math.max(3, size * 0.07);
  const segH = Math.max(6, size * 0.16);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {Array.from({ length: segments }, (_, i) => {
        const deg = (360 / segments) * i;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: size,
              height: size,
              alignItems: 'center',
              transform: [{ rotate: `${deg}deg` }],
            }}
          >
            <View
              style={{
                width: segW,
                height: segH,
                borderRadius: segW / 2,
                backgroundColor: i < lit ? color : colors.border,
              }}
            />
          </View>
        );
      })}
      {children}
    </View>
  );
}
