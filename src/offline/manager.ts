// Native singletons: the download manager and the tile host I/O, wired to expo-file-system, NetInfo
// and the user's tile settings. Screens and the map import from here; pure logic lives in
// downloader.ts and tileHost.ts.
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { useStore } from '@/state/store';

import { DownloadManager, type OfflineSnapshot } from './downloader';
import {
  areaTileSize,
  downloadTile,
  fetchToBrowseCache,
  freeDiskBytes,
  readIndexJson,
  readTileBase64,
  removeAreaTile,
  writeIndexJson,
} from './fileCache';
import { isOnline, onOnlineChange, startNetworkWatch } from './network';
import { effectiveApiKey } from './providers';
import type { TileHostIO } from './tileHost';

/** True where tiles can be stored (Android/iOS). The web build keeps plain online tiles. */
export const OFFLINE_SUPPORTED = Platform.OS === 'android' || Platform.OS === 'ios';

export function currentApiKey(): string | null {
  return effectiveApiKey(useStore.getState().settings.tileApiKey) || null;
}

let manager: DownloadManager | null = null;

export function getDownloadManager(): DownloadManager {
  if (!manager) {
    manager = new DownloadManager({
      io: {
        areaTileSize,
        downloadAreaTile: (p, t, url, signal) => downloadTile('area', p, t, url, signal),
        removeAreaTile,
        loadIndex: readIndexJson,
        saveIndex: writeIndexJson,
        freeBytes: freeDiskBytes,
      },
      isOnline,
      getApiKey: currentApiKey,
    });
    onOnlineChange((on) => manager?.setOnline(on));
  }
  return manager;
}

/**
 * Loads saved areas and resumes unfinished downloads. Call once at startup (root layout) and from any
 * screen that needs offline maps; repeated calls are free.
 */
export function startOfflineMaps(): void {
  if (!OFFLINE_SUPPORTED) return;
  startNetworkWatch();
  void getDownloadManager().init();
}

const EMPTY: OfflineSnapshot = { ready: true, areas: [], activeId: null };
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY;

/** React hook with the saved areas and download progress. */
export function useOfflineAreas(): OfflineSnapshot {
  const m = OFFLINE_SUPPORTED ? getDownloadManager() : null;
  return useSyncExternalStore(m ? m.subscribe : noopSubscribe, m ? m.getSnapshot : emptySnapshot, emptySnapshot);
}

/** File-backed I/O for the WebView tile host. */
export const nativeTileHostIO: TileHostIO = {
  read: readTileBase64,
  fetch: fetchToBrowseCache,
};

export { useTileSettings } from './tileSettings';
