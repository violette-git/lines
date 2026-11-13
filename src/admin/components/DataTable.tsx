// Data table with a sticky header (the header row stays visible while the body scrolls),
// sortable columns, row hover and an empty state. Columns size by flex with a minimum width;
// the table scrolls sideways on narrow screens instead of squashing.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type DimensionValue } from 'react-native';

import { colors, space } from '@/theme';

import { Txt } from './kit';

export interface Column<R> {
  key: string;
  title: string;
  /** Relative width. */
  flex?: number;
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  render: (row: R) => ReactNode;
}

export function DataTable<R>({
  columns,
  rows,
  rowKey,
  onRowPress,
  sort,
  onSort,
  maxHeight = 560,
  empty,
  rowLabel,
}: {
  columns: Column<R>[];
  rows: R[];
  rowKey: (r: R) => string;
  onRowPress?: (r: R) => void;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (key: string) => void;
  maxHeight?: DimensionValue;
  empty?: ReactNode;
  /** Accessible label for a row (screen readers), e.g. the project name. */
  rowLabel?: (r: R) => string;
}) {
  const minTableWidth = columns.reduce((s, c) => s + (c.minWidth ?? 100), 0);
  const header = (
    <View key="__head" style={[styles.row, styles.head]} accessibilityRole="header">
      {columns.map((c) => {
        const active = sort?.key === c.key;
        const content = (
          <View style={[styles.headCell, c.align === 'right' && { justifyContent: 'flex-end' }]}>
            <Txt v="label" color={active ? colors.text : colors.textFaint}>
              {c.title}
            </Txt>
            {c.sortable && onSort ? (
              <Ionicons
                name={active ? (sort?.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'swap-vertical'}
                size={11}
                color={active ? colors.accent : colors.textFaint}
              />
            ) : null}
          </View>
        );
        return (
          <View key={c.key} style={[styles.cell, { flex: c.flex ?? 1, minWidth: c.minWidth ?? 100 }]}>
            {c.sortable && onSort ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Sort by ${c.title}`} onPress={() => onSort(c.key)} style={{ cursor: 'pointer' }}>
                {content}
              </Pressable>
            ) : (
              content
            )}
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }} showsHorizontalScrollIndicator>
      <View style={{ flex: 1, minWidth: minTableWidth }}>
        <ScrollView style={{ maxHeight }} stickyHeaderIndices={[0]} nestedScrollEnabled>
          {header}
          {rows.length === 0 ? (
            <View>{empty}</View>
          ) : (
            rows.map((r) => <Row key={rowKey(r)} row={r} columns={columns} onPress={onRowPress} label={rowLabel?.(r)} />)
          )}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function Row<R>({ row, columns, onPress, label }: { row: R; columns: Column<R>[]; onPress?: (r: R) => void; label?: string }) {
  const [hover, setHover] = useState(false);
  const cells = columns.map((c) => (
    <View
      key={c.key}
      style={[
        styles.cell,
        { flex: c.flex ?? 1, minWidth: c.minWidth ?? 100 },
        c.align === 'right' && { alignItems: 'flex-end' },
        c.align === 'center' && { alignItems: 'center' },
      ]}
    >
      {c.render(row)}
    </View>
  ));
  if (!onPress) {
    return <View style={[styles.row, styles.bodyRow]}>{cells}</View>;
  }
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => onPress(row)}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.row, styles.bodyRow, { cursor: 'pointer' }, hover && { backgroundColor: colors.surfaceAlt }]}
    >
      {cells}
    </Pressable>
  );
}

/** Two-line cell: primary text plus a faint secondary line. */
export function CellText({ primary, secondary, num }: { primary: ReactNode; secondary?: ReactNode; num?: boolean }) {
  return (
    <View style={{ gap: 1, maxWidth: '100%' }}>
      <Txt v="small" num={num} numberOfLines={1} style={{ fontWeight: '500' }}>
        {primary}
      </Txt>
      {secondary ? (
        <Txt v="micro" color={colors.textFaint} numberOfLines={1} num={num}>
          {secondary}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm },
  head: {
    height: 38,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headCell: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bodyRow: { minHeight: 52, borderBottomWidth: 1, borderBottomColor: colors.border + '99' },
  cell: { paddingHorizontal: space.sm, paddingVertical: 8, justifyContent: 'center' },
});
