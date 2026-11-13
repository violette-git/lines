// Simple vector illustrations for the onboarding slides, built from Views and Ionicons only
// (no image assets, so they stay sharp at any size and weigh nothing).
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, font, radius } from '@/theme';

import { T } from './ui';

const W = 280;
const H = 220;

function Line({ x1, y1, x2, y2, color, width = 4, dashed }: { x1: number; y1: number; x2: number; y2: number; color: string; width?: number; dashed?: boolean }) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      style={{
        position: 'absolute',
        left: (x1 + x2) / 2 - len / 2,
        top: (y1 + y2) / 2 - width / 2,
        width: len,
        height: width,
        borderRadius: width,
        backgroundColor: dashed ? 'transparent' : color,
        borderWidth: dashed ? 1.5 : 0,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderColor: color,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

function Node({ x, y, color, label, size = 30 }: { x: number; y: number; color: string; label: string; size?: number }) {
  return (
    <View style={[styles.node, { left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <T v="caption" color={colors.onAccent} style={{ fontWeight: '800', fontSize: 11 }}>
        {label}
      </T>
    </View>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <View style={styles.frame}>{children}</View>;
}

export function SnapArt() {
  return (
    <Frame>
      {/* Phone */}
      <View style={styles.phone}>
        <View style={styles.viewfinder}>
          <Ionicons name="git-commit" size={70} color={colors.aerial} style={{ transform: [{ rotate: '90deg' }] }} />
          <View style={[styles.corner, { top: 8, left: 8, borderTopWidth: 3, borderLeftWidth: 3 }]} />
          <View style={[styles.corner, { top: 8, right: 8, borderTopWidth: 3, borderRightWidth: 3 }]} />
          <View style={[styles.corner, { bottom: 8, left: 8, borderBottomWidth: 3, borderLeftWidth: 3 }]} />
          <View style={[styles.corner, { bottom: 8, right: 8, borderBottomWidth: 3, borderRightWidth: 3 }]} />
        </View>
        <View style={styles.shutter}>
          <View style={styles.shutterInner} />
        </View>
      </View>
      {/* GPS fix with accuracy rings */}
      <View style={[styles.ring, { left: 186, top: 26, width: 84, height: 84, borderRadius: 42, opacity: 0.35 }]} />
      <View style={[styles.ring, { left: 201, top: 41, width: 54, height: 54, borderRadius: 27, opacity: 0.7 }]} />
      <View style={[styles.pin, { left: 212, top: 52 }]}>
        <Ionicons name="locate" size={20} color={colors.onAccent} />
      </View>
      <View style={[styles.tag, { left: 176, top: 128 }]}>
        <T v="caption" color={colors.success} style={font.mono}>
          +/- 3 ft
        </T>
      </View>
    </Frame>
  );
}

export function MapArt() {
  const a = { x: 40, y: 160 };
  const b = { x: 120, y: 110 };
  const c = { x: 200, y: 80 };
  const ghost = { x: 236, y: 150 };
  const d = { x: 250, y: 120 };
  return (
    <Frame>
      {/* Grid as a stand-in for imagery */}
      {[40, 80, 120, 160, 200].map((y) => (
        <View key={`h${y}`} style={[styles.grid, { top: y, left: 0, right: 0, height: 1 }]} />
      ))}
      {[56, 112, 168, 224].map((x) => (
        <View key={`v${x}`} style={[styles.grid, { left: x, top: 0, bottom: 0, width: 1 }]} />
      ))}
      <View style={styles.road} />
      <Line {...{ x1: a.x, y1: a.y, x2: b.x, y2: b.y }} color={colors.aerial} />
      <Line {...{ x1: b.x, y1: b.y, x2: c.x, y2: c.y }} color={colors.aerial} />
      <Line {...{ x1: c.x, y1: c.y, x2: ghost.x, y2: ghost.y }} color={colors.textFaint} dashed width={3} />
      <Line {...{ x1: c.x, y1: c.y, x2: d.x, y2: d.y }} color={colors.aerial} />
      <Node x={a.x} y={a.y} color={colors.aerial} label="P1" />
      <Node x={b.x} y={b.y} color={colors.aerial} label="P2" />
      <Node x={c.x} y={c.y} color={colors.aerial} label="P3" />
      <View style={[styles.ghost, { left: ghost.x - 15, top: ghost.y - 15 }]} />
      <Node x={d.x} y={d.y} color={colors.accent} label="P4" size={36} />
      <View style={[styles.drag, { left: d.x - 4, top: d.y + 16 }]}>
        <Ionicons name="hand-left" size={22} color={colors.text} />
      </View>
    </Frame>
  );
}

export function MeasureArt() {
  return (
    <Frame>
      {/* Two poles with a sagging span drawn as three segments */}
      <View style={[styles.pole, { left: 40 }]} />
      <View style={[styles.pole, { left: 232 }]} />
      <View style={[styles.cross, { left: 26 }]} />
      <View style={[styles.cross, { left: 218 }]} />
      <Line x1={44} y1={64} x2={110} y2={88} color={colors.aerial} />
      <Line x1={110} y1={88} x2={170} y2={88} color={colors.aerial} />
      <Line x1={170} y1={88} x2={236} y2={64} color={colors.aerial} />
      {/* Slack coil */}
      <View style={[styles.coil, { left: 222, top: 100 }]} />
      <View style={[styles.coil, { left: 226, top: 104, width: 16, height: 16 }]} />
      <View style={[styles.lengthPill, { left: 78, top: 108 }]}>
        <T v="heading" color={colors.onAccent} style={[font.mono, { fontSize: 18 }]}>
          1,248 ft
        </T>
      </View>
      <View style={[styles.tag, { left: 30, top: 168 }]}>
        <T v="caption" color={colors.text} style={font.mono}>
          2% sag
        </T>
      </View>
      <View style={[styles.tag, { left: 120, top: 168 }]}>
        <T v="caption" color={colors.text} style={font.mono}>
          +40 ft slack
        </T>
      </View>
    </Frame>
  );
}

export function ExportArt() {
  const tiles: { icon: 'globe-outline' | 'grid-outline' | 'document-text-outline' | 'layers-outline'; label: string; color: string }[] = [
    { icon: 'globe-outline', label: 'KMZ', color: colors.success },
    { icon: 'grid-outline', label: 'Excel', color: colors.aerial },
    { icon: 'document-text-outline', label: 'PDF', color: colors.danger },
    { icon: 'layers-outline', label: 'GIS', color: colors.underground },
  ];
  return (
    <Frame>
      <View style={styles.tiles}>
        {tiles.map((t) => (
          <View key={t.label} style={[styles.tile, { borderColor: t.color + '88' }]}>
            <Ionicons name={t.icon} size={34} color={t.color} />
            <T v="label">{t.label}</T>
          </View>
        ))}
      </View>
      <View style={styles.share}>
        <Ionicons name="share-outline" size={22} color={colors.onAccent} />
      </View>
    </Frame>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: W,
    height: H,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  node: { position: 'absolute', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg },
  phone: {
    position: 'absolute',
    left: 36,
    top: 18,
    width: 120,
    height: 184,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
    padding: 8,
    gap: 8,
    alignItems: 'center',
  },
  viewfinder: { width: '100%', flex: 1, borderRadius: 12, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  corner: { position: 'absolute', width: 16, height: 16, borderColor: colors.accent },
  shutter: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent },
  ring: { position: 'absolute', borderWidth: 2, borderColor: colors.success, backgroundColor: colors.success + '14' },
  pin: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tag: {
    position: 'absolute',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grid: { position: 'absolute', backgroundColor: colors.border, opacity: 0.6 },
  road: { position: 'absolute', left: -20, right: -20, top: 132, height: 18, backgroundColor: colors.surfaceRaised, transform: [{ rotate: '-18deg' }] },
  ghost: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.textFaint },
  drag: { position: 'absolute' },
  pole: { position: 'absolute', top: 50, width: 8, height: 150, borderRadius: 3, backgroundColor: '#8A6A44' },
  cross: { position: 'absolute', top: 58, width: 36, height: 6, borderRadius: 3, backgroundColor: '#8A6A44' },
  coil: { position: 'absolute', width: 24, height: 24, borderRadius: 12, borderWidth: 3, borderColor: colors.aerial },
  lengthPill: { position: 'absolute', paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.accent },
  tiles: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', padding: 18, gap: 12, alignContent: 'center', justifyContent: 'center' },
  tile: {
    width: 108,
    height: 80,
    borderRadius: radius.md,
    borderWidth: 1.5,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  share: {
    position: 'absolute',
    right: 14,
    top: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
