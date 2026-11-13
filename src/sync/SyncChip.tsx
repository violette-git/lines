// Small cloud chip for the map header and the projects home: shows whether company data is
// synced, syncing, waiting, offline or stuck. Tap to sync now (and retry anything refused).
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, font, radius, space } from '@/theme';

import { syncNow, useSyncStatus, type SyncUiState } from './status';

type IconName = 'cloud-done-outline' | 'cloud-upload-outline' | 'cloud-offline-outline' | 'sync-outline' | 'alert-circle-outline';

export interface ChipView {
  icon: IconName;
  color: string;
  /** Short text on the chip. */
  text: string;
  /** Full sentence for screen readers. */
  label: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure mapping from sync status to what the chip shows (null = hide the chip). */
export function chipView(s: Pick<SyncUiState, 'phase' | 'pendingChanges' | 'pendingPhotos' | 'error' | 'rejected' | 'waitingForWifi' | 'activeOrgId'>): ChipView | null {
  if (s.phase === 'disabled' || !s.activeOrgId) return null;
  const waiting = s.pendingChanges + s.pendingPhotos;
  if (s.phase === 'offline') {
    return {
      icon: 'cloud-offline-outline',
      color: colors.textMuted,
      text: waiting ? `Offline, ${waiting} waiting` : 'Offline',
      label: waiting ? `Offline. ${plural(waiting, 'change')} will sync when you are back online.` : 'Offline. Everything is saved on this phone.',
    };
  }
  if (s.phase === 'pushing' || s.phase === 'pulling') {
    return { icon: 'sync-outline', color: colors.info, text: 'Syncing...', label: 'Syncing with your company.' };
  }
  if (s.phase === 'uploading_photos') {
    return {
      icon: 'cloud-upload-outline',
      color: colors.info,
      text: s.pendingPhotos ? `Photos ${s.pendingPhotos}` : 'Photos...',
      label: `Uploading photos, ${plural(s.pendingPhotos, 'photo')} left.`,
    };
  }
  if (s.phase === 'error') {
    return {
      icon: 'alert-circle-outline',
      color: colors.danger,
      text: 'Tap to retry',
      label: `${s.error ?? 'Sync problem.'} Tap to try again.`,
    };
  }
  if (s.rejected > 0) {
    return {
      icon: 'alert-circle-outline',
      color: colors.warning,
      text: `${s.rejected} not saved`,
      label: `${plural(s.rejected, 'change')} not accepted by your company account. Tap to try again.`,
    };
  }
  if (s.waitingForWifi && s.pendingPhotos > 0) {
    return {
      icon: 'cloud-upload-outline',
      color: colors.warning,
      text: `${s.pendingPhotos} on Wi-Fi`,
      label: `${plural(s.pendingPhotos, 'photo')} will upload on Wi-Fi. Change this in Settings.`,
    };
  }
  if (waiting > 0) {
    return {
      icon: 'cloud-upload-outline',
      color: colors.accent,
      text: `${waiting} pending`,
      label: `${plural(waiting, 'change')} waiting to sync. Tap to sync now.`,
    };
  }
  return { icon: 'cloud-done-outline', color: colors.success, text: 'Synced', label: 'All changes are synced.' };
}

export function SyncChip({ compact = false }: { compact?: boolean }) {
  const status = useSyncStatus();
  const view = chipView(status);
  if (!view) return null;
  return (
    <Pressable
      onPress={() => void syncNow()}
      accessibilityRole="button"
      accessibilityLabel={view.label}
      hitSlop={8}
      style={({ pressed }) => [styles.chip, { borderColor: view.color }, pressed && styles.pressed]}
    >
      <Ionicons name={view.icon} size={18} color={view.color} />
      {compact ? null : (
        <Text style={[font.label, { color: view.color }]} numberOfLines={1}>
          {view.text}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    minHeight: 40,
    minWidth: 40,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 2,
    backgroundColor: colors.overlay,
  },
  pressed: { opacity: 0.7 },
});
