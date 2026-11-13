// Connectivity for the tile cache and downloader (NetInfo singleton). "Online" means connected and not
// known to be unreachable: captive or flaky networks still try, and failures fall back to the cache.
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';

let online = true;
let started = false;
const listeners = new Set<(online: boolean) => void>();

export function isOnlineState(s: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>): boolean {
  return s.isConnected !== false && s.isInternetReachable !== false;
}

function set(next: boolean): void {
  if (next === online) return;
  online = next;
  listeners.forEach((l) => l(next));
}

/** Starts listening once; later calls are no-ops. */
export function startNetworkWatch(): void {
  if (started) return;
  started = true;
  try {
    NetInfo.addEventListener((s) => set(isOnlineState(s)));
    NetInfo.fetch()
      .then((s) => set(isOnlineState(s)))
      .catch(() => undefined);
  } catch {
    // NetInfo unavailable (tests, unsupported platform): assume online.
  }
}

export function isOnline(): boolean {
  return online;
}

export function onOnlineChange(fn: (online: boolean) => void): () => void {
  startNetworkWatch();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function subscribe(cb: () => void): () => void {
  return onOnlineChange(() => cb());
}

/** React hook: true while the phone has a usable connection. */
export function useOnline(): boolean {
  startNetworkWatch();
  return useSyncExternalStore(subscribe, isOnline, isOnline);
}
