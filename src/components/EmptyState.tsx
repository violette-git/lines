import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/theme';

import { T, type IconName } from './ui';

/** Friendly empty state: glowing icon badge, headline, one line of help and an optional action. */
export function EmptyState({
  icon,
  title,
  body,
  color = colors.accent,
  children,
}: {
  icon: IconName;
  title: string;
  body?: string;
  color?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.halo, { borderColor: color + '33' }]}>
        <View style={[styles.badge, { backgroundColor: color + '1F', borderColor: color + '66' }]}>
          <Ionicons name={icon} size={40} color={color} />
        </View>
      </View>
      <T v="title" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? (
        <T color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 420 }}>
          {body}
        </T>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg, gap: space.md },
  halo: { padding: 10, borderRadius: radius.pill, borderWidth: 1, marginBottom: space.sm },
  badge: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  actions: { marginTop: space.md, gap: space.sm, alignSelf: 'stretch', maxWidth: 360, width: '100%', alignItems: 'stretch' },
});
