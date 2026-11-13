// Photo actions the store does not expose yet. Writes through the repository and patches store state.
import { getRepository } from '@/data';
import { useStore } from '@/state/store';

export async function setPrimaryPhoto(nodeId: string, photoId: string): Promise<void> {
  const repo = getRepository();
  const photos = useStore.getState().photos;
  const changed = photos
    .filter((p) => p.nodeId === nodeId)
    .filter((p) => p.isPrimary !== (p.id === photoId))
    .map((p) => ({ ...p, isPrimary: p.id === photoId }));
  for (const p of changed) await repo.upsertPhoto(p);
  const byId = new Map(changed.map((p) => [p.id, p]));
  useStore.setState((s) => ({ photos: s.photos.map((p) => byId.get(p.id) ?? p) }));
}
