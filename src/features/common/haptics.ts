// Haptics that never throw (web and some Android devices have no haptic engine).
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

export function tapHaptic() {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}

export function captureHaptic() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
}

export function successHaptic() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function warningHaptic() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

export function errorHaptic() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
