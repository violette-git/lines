// Lightweight charts drawn with plain views (no chart library): stacked weekly columns, monthly
// columns with a reference line, and horizontal bar lists. Thin marks, rounded data ends, a 2px
// gap between stacked segments, recessive grid, hover tooltips, legend for two series.
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/theme';

import { Txt } from './kit';

/** Rounds an axis maximum up to a "nice" number (1, 2, 2.5, 5 x 10^n). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function compactNumber(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1000) return `${parseFloat((n / 1000).toFixed(a >= 100_000 ? 0 : 1))}k`;
  return String(Math.round(n));
}

export interface LegendItem {
  label: string;
  color: string;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' }}>
      {items.map((i) => (
        <View key={i.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: i.color }} />
          <Txt v="micro" color={colors.textMuted}>
            {i.label}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function Gridlines({ max, height, format }: { max: number; height: number; format: (n: number) => string }) {
  const ticks = [0, 0.5, 1];
  return (
    <>
      {ticks.map((t) => (
        <View key={t} style={[styles.grid, { bottom: t * height }]} pointerEvents="none">
          <Txt v="micro" color={colors.textFaint} style={styles.tick} num>
            {format(max * t)}
          </Txt>
        </View>
      ))}
    </>
  );
}

function Tooltip({ children }: { children: ReactNode }) {
  return (
    <View style={styles.tooltip} pointerEvents="none">
      {children}
    </View>
  );
}

export interface StackDatum {
  label: string;
  values: number[];
}

/** Columns with stacked segments (e.g. aerial + underground footage per week). */
export function StackedColumns({
  data,
  series,
  height = 200,
  format = compactNumber,
  tooltipFormat = (n: number) => String(Math.round(n)),
  unit = '',
}: {
  data: StackDatum[];
  series: LegendItem[];
  height?: number;
  format?: (n: number) => string;
  tooltipFormat?: (n: number) => string;
  unit?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.values.reduce((s, v) => s + v, 0))));
  return (
    <View style={{ gap: space.md }}>
      <View style={{ height: height + 22, paddingLeft: 40 }}>
        <View style={{ height, position: 'relative' }}>
          <Gridlines max={max} height={height} format={format} />
          <View style={[StyleSheet.absoluteFill, styles.colRow]}>
            {data.map((d, i) => {
              const total = d.values.reduce((s, v) => s + v, 0);
              return (
                <Pressable
                  key={d.label}
                  onHoverIn={() => setHover(i)}
                  onHoverOut={() => setHover((h) => (h === i ? null : h))}
                  onPress={() => setHover((h) => (h === i ? null : i))}
                  accessibilityLabel={`${d.label}: ${series.map((s, k) => `${s.label} ${tooltipFormat(d.values[k] ?? 0)}${unit}`).join(', ')}`}
                  style={[styles.colHit, hover === i && { backgroundColor: colors.surfaceAlt + '88' }]}
                >
                  <View style={[styles.col, { height: total > 0 ? Math.max(3, (total / max) * height) : 0 }]}>
                    {d.values.map((v, k) => {
                      if (!(v > 0)) return null;
                      const isTop = d.values.slice(k + 1).every((x) => !(x > 0));
                      return (
                        <View
                          key={k}
                          style={{
                            flex: v,
                            backgroundColor: series[k]?.color ?? colors.accent,
                            borderTopLeftRadius: isTop ? 4 : 0,
                            borderTopRightRadius: isTop ? 4 : 0,
                            marginTop: k > 0 ? 0 : 0,
                            marginBottom: k > 0 ? 2 : 0,
                          }}
                        />
                      );
                    }).reverse()}
                  </View>
                  {hover === i ? (
                    <Tooltip>
                      <Txt v="micro" color={colors.textMuted}>
                        {d.label}
                      </Txt>
                      {series.map((s, k) => (
                        <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: s.color }} />
                          <Txt v="micro" num>
                            {s.label}: {tooltipFormat(d.values[k] ?? 0)}
                            {unit}
                          </Txt>
                        </View>
                      ))}
                      <Txt v="micro" num style={{ fontWeight: '700' }}>
                        Total: {tooltipFormat(total)}
                        {unit}
                      </Txt>
                    </Tooltip>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={[styles.colRow, { height: 22, alignItems: 'flex-end' }]}>
          {data.map((d) => (
            <View key={d.label} style={{ flex: 1, alignItems: 'center' }}>
              <Txt v="micro" color={colors.textFaint} numberOfLines={1}>
                {d.label}
              </Txt>
            </View>
          ))}
        </View>
      </View>
      {series.length > 1 ? <Legend items={series} /> : null}
    </View>
  );
}

/** Single-series columns with an optional dashed reference line (e.g. monthly quota). */
export function Columns({
  data,
  height = 180,
  color = colors.accent,
  reference,
  format = compactNumber,
  tooltip,
}: {
  data: { label: string; value: number; highlight?: boolean }[];
  height?: number;
  color?: string;
  reference?: { value: number; label: string };
  format?: (n: number) => string;
  tooltip?: (d: { label: string; value: number }) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(reference?.value ?? 0, ...data.map((d) => d.value)) * 1.05);
  return (
    <View style={{ height: height + 22, paddingLeft: 40 }}>
      <View style={{ height, position: 'relative' }}>
        <Gridlines max={max} height={height} format={format} />
        {reference ? (
          <View style={[styles.refLine, { bottom: (reference.value / max) * height }]} pointerEvents="none">
            <Txt v="micro" color={colors.textMuted} style={styles.refLabel}>
              {reference.label}
            </Txt>
          </View>
        ) : null}
        <View style={[StyleSheet.absoluteFill, styles.colRow]}>
          {data.map((d, i) => (
            <Pressable
              key={d.label}
              onHoverIn={() => setHover(i)}
              onHoverOut={() => setHover((h) => (h === i ? null : h))}
              onPress={() => setHover((h) => (h === i ? null : i))}
              accessibilityLabel={tooltip ? tooltip(d) : `${d.label}: ${d.value}`}
              style={[styles.colHit, hover === i && { backgroundColor: colors.surfaceAlt + '88' }]}
            >
              <View
                style={[
                  styles.col,
                  {
                    height: d.value > 0 ? Math.max(3, (d.value / max) * height) : 0,
                    backgroundColor: d.highlight ? color : color + '8C',
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                  },
                ]}
              />
              {hover === i ? (
                <Tooltip>
                  <Txt v="micro" num>
                    {tooltip ? tooltip(d) : `${d.label}: ${d.value}`}
                  </Txt>
                </Tooltip>
              ) : null}
            </Pressable>
          ))}
        </View>
      </View>
      <View style={[styles.colRow, { height: 22, alignItems: 'flex-end' }]}>
        {data.map((d) => (
          <View key={d.label} style={{ flex: 1, alignItems: 'center' }}>
            <Txt v="micro" color={d.highlight ? colors.text : colors.textFaint} numberOfLines={1}>
              {d.label}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Ranked horizontal bars with the value at the end (e.g. AI photos per tech). */
export function BarList({
  items,
  color = colors.accent,
  format = (n: number) => String(Math.round(n)),
  secondary,
}: {
  items: { key: string; label: string; value: number; leading?: ReactNode }[];
  color?: string;
  format?: (n: number) => string;
  secondary?: (key: string) => string | null;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <View style={{ gap: 12 }}>
      {items.map((i) => (
        <View key={i.key} style={{ gap: 6 }} accessibilityLabel={`${i.label}: ${format(i.value)}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {i.leading}
            <Txt v="small" style={{ flex: 1, fontWeight: '500' }} numberOfLines={1}>
              {i.label}
            </Txt>
            {secondary?.(i.key) ? (
              <Txt v="micro" color={colors.textFaint} num>
                {secondary(i.key)}
              </Txt>
            ) : null}
            <Txt v="small" num style={{ fontWeight: '600', minWidth: 56, textAlign: 'right' }}>
              {format(i.value)}
            </Txt>
          </View>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised }}>
            <View style={{ width: `${(i.value / max) * 100}%`, height: 6, borderRadius: 3, backgroundColor: color }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { position: 'absolute', left: -40, right: 0, height: 1, backgroundColor: colors.border + '88' },
  tick: { position: 'absolute', left: 0, width: 34, textAlign: 'right', top: -8 },
  colRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  colHit: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', borderRadius: radius.sm, cursor: 'pointer' },
  col: { width: '62%', maxWidth: 44, flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' },
  tooltip: {
    position: 'absolute',
    bottom: '100%',
    zIndex: 20,
    minWidth: 150,
    gap: 3,
    padding: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    marginBottom: 6,
  },
  refLine: { position: 'absolute', left: 0, right: 0, height: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.textMuted },
  refLabel: { position: 'absolute', right: 0, top: -18 },
});
