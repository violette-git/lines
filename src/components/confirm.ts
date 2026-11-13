// Cross-platform confirm and notice dialogs. React Native Web's Alert is a no-op,
// so on web we fall back to the browser's built-in dialogs.
import { Alert, Platform } from 'react-native';

export function confirmAsync(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', destructive } = opts;
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    try {
      return Promise.resolve(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true);
    } catch {
      return Promise.resolve(true);
    }
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(message ? `${title}\n\n${message}` : title);
      }
    } catch {
      // ignore
    }
    return;
  }
  Alert.alert(title, message);
}
