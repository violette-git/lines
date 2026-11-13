import type { MapNode } from '@/domain/types';

/** Summary of AI-filled fields on a node (the store keeps per-field meta, not the model's prose). */
export function aiSummary(node: MapNode): { filled: number; avgConfidence: number | null; estimates: number; lowConfidence: string[] } {
  const metas = Object.entries(node.aiMeta).filter(([, m]) => m.source === 'ai');
  if (metas.length === 0) return { filled: 0, avgConfidence: null, estimates: 0, lowConfidence: [] };
  const avg = metas.reduce((a, [, m]) => a + m.confidence, 0) / metas.length;
  return {
    filled: metas.length,
    avgConfidence: avg,
    estimates: metas.filter(([, m]) => m.isEstimate).length,
    lowConfidence: metas.filter(([, m]) => m.confidence < 0.55).map(([k]) => k),
  };
}

/** Turns raw AI client errors into something a crew member can act on. */
export function friendlyAiError(msg: string | undefined): string {
  if (!msg) return 'AI could not finish this one.';
  const m = msg.toLowerCase();
  if (m.includes('network') || m.includes('fetch') || m.includes('offline') || m.includes('timed out') || m.includes('timeout'))
    return 'No connection right now. It will retry when you run pending AI.';
  if (m.includes('401') || m.includes('api key') || m.includes('unauthorized') || m.includes('auth'))
    return 'The AI key was not accepted. Check it in Settings.';
  if (m.includes('429') || m.includes('rate') || m.includes('overloaded') || m.includes('529'))
    return 'AI is busy right now. Try again in a minute.';
  if (m.includes('photo data is missing')) return 'The photo for this node is missing, so AI cannot read it.';
  return `AI could not finish: ${msg}`;
}
