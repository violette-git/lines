// Tiny cross-screen UI channel:
// - capture "Done" / export QC ask the map to select a node or span when it regains focus
// - the map hands its latest snapshot to the export screen for the PDF cover
import { create } from 'zustand';

export type PendingSelect = { kind: 'node' | 'span'; id: string };

interface MapUiBus {
  pendingSelect: PendingSelect | null;
  mapSnapshot: { projectId: string; dataUrl: string; at: number } | null;
  requestSelectNode(id: string | null): void;
  requestSelect(sel: PendingSelect | null): void;
  consumeSelect(): PendingSelect | null;
  setMapSnapshot(projectId: string, dataUrl: string | null): void;
}

export const useMapUiBus = create<MapUiBus>((set, get) => ({
  pendingSelect: null,
  mapSnapshot: null,
  requestSelectNode(id) {
    set({ pendingSelect: id ? { kind: 'node', id } : null });
  },
  requestSelect(sel) {
    set({ pendingSelect: sel });
  },
  consumeSelect() {
    const sel = get().pendingSelect;
    if (sel) set({ pendingSelect: null });
    return sel;
  },
  setMapSnapshot(projectId, dataUrl) {
    set({ mapSnapshot: dataUrl ? { projectId, dataUrl, at: Date.now() } : null });
  },
}));
