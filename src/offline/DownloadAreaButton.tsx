// Entry points into the offline maps screen for the project map.
//  - <DownloadAreaButton projectId mapRef? />: a glass icon button for the map overlay.
//  - offlineMapsMenuItem(projectId, mapRef?): an item for the map screen's "More" menu
//    (structurally matches MenuItem in src/features/map-screen/overlays.tsx).
// With a mapRef, the current map view is passed along so "Current map view" is offered as the area.
import { router } from 'expo-router';
import type { RefObject } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { IconButton, type IconName } from '@/components/ui';
import type { LineMapHandle } from '@/map';

async function openDownload(projectId: string, mapRef?: RefObject<LineMapHandle | null>): Promise<void> {
  let bbox = '';
  try {
    const view = mapRef?.current ? await mapRef.current.getView() : null;
    if (view) bbox = view.bounds.map((v) => v.toFixed(6)).join(',');
  } catch {
    bbox = '';
  }
  const q = [`projectId=${encodeURIComponent(projectId)}`, 'download=1'];
  if (bbox) q.push(`bbox=${encodeURIComponent(bbox)}`);
  router.push(`/offline-maps?${q.join('&')}` as never);
}

export function DownloadAreaButton({
  projectId,
  mapRef,
  size = 48,
  style,
}: {
  projectId: string;
  mapRef?: RefObject<LineMapHandle | null>;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <IconButton
      icon="cloud-download-outline"
      label="Download this area for offline use"
      size={size}
      style={style}
      onPress={() => void openDownload(projectId, mapRef)}
    />
  );
}

export function offlineMapsMenuItem(
  projectId: string,
  mapRef?: RefObject<LineMapHandle | null>,
): { icon: IconName; label: string; hint: string; onPress: () => void } {
  return {
    icon: 'cloud-download-outline',
    label: 'Download this area',
    hint: 'Save map tiles so the map works with no signal',
    onPress: () => void openDownload(projectId, mapRef),
  };
}
