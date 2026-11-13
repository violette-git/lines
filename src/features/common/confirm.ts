// Cross-platform confirm dialog. react-native-web's Alert.alert is a no-op, so web uses window.confirm.
import { Alert, Platform } from 'react-native';

export function confirmAsync(
  title: string,
  message: string,
  opts: { confirmText?: string; cancelText?: string; destructive?: boolean } = {},
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const w = globalThis as { confirm?: (msg: string) => boolean };
    return Promise.resolve(w.confirm ? w.confirm(`${title}\n\n${message}`) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: opts.cancelText ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: opts.confirmText ?? 'OK',
          style: opts.destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Something went wrong';
}
