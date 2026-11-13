// The user's map source settings for the live map (settings.offlineTileProvider / tileApiKey).
// Kept free of file-system imports so the web map can use it.
import { useStore } from '@/state/store';

export function useTileSettings(): { providerId: string | null; apiKey: string | null } {
  const providerId = useStore((s) => s.settings.offlineTileProvider ?? null);
  const apiKey = useStore((s) => s.settings.tileApiKey ?? null);
  return { providerId, apiKey };
}
