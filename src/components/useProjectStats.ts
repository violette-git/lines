// Lightweight per-project stats for the Projects home screen.
// The store only keeps nodes/spans for the active project, so for every other project we read
// nodes and spans straight from the repository, compute lengths, and cache the result keyed by
// project.updatedAt. The active project is always computed from live store state.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getRepository } from '@/data';
import type { MapNode, Project, Span, SpanWithLength } from '@/domain/types';
import { computeSpanLengths } from '@/geo';
import { computeTally, useStore, type Tally } from '@/state/store';

import { startOfWeekMs } from './format';

export interface WeekStats {
  totalFt: number;
  nodes: number;
  earnings: number | null;
}

export interface ProjectStats {
  tally: Tally;
  week: WeekStats;
}

interface CacheEntry {
  key: string;
  stats: ProjectStats;
}

// Module-level cache survives remounts of the home screen.
const cache = new Map<string, CacheEntry>();

function computeStats(project: Project, nodes: MapNode[], spans: SpanWithLength[], weekStart: number): ProjectStats {
  const tally = computeTally(nodes, spans, project);
  const inWeek = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= weekStart;
  };
  const weekNodes = nodes.filter((n) => inWeek(n.createdAt)).length;
  const weekFt = spans.filter((s) => inWeek(s.createdAt)).reduce((sum, s) => sum + s.totalFt, 0);
  const hasRate = project.ratePerFoot != null || project.ratePerNode != null;
  const earnings = hasRate ? (project.ratePerFoot ?? 0) * weekFt + (project.ratePerNode ?? 0) * weekNodes : null;
  return { tally, week: { totalFt: weekFt, nodes: weekNodes, earnings } };
}

async function loadStats(project: Project, weekStart: number): Promise<ProjectStats> {
  const repo = getRepository();
  const [nodes, spans]: [MapNode[], Span[]] = await Promise.all([repo.listNodes(project.id), repo.listSpans(project.id)]);
  return computeStats(project, nodes, computeSpanLengths(spans, nodes), weekStart);
}

export function useProjectStats(projects: Project[]): {
  stats: Record<string, ProjectStats>;
  loading: boolean;
  refresh: () => void;
} {
  const ready = useStore((s) => s.ready);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const liveNodes = useStore((s) => s.nodes);
  const liveSpans = useStore((s) => s.spans);

  const [stats, setStats] = useState<Record<string, ProjectStats>>(() => {
    const init: Record<string, ProjectStats> = {};
    for (const p of projects) {
      const c = cache.get(p.id);
      if (c) init[p.id] = c.stats;
    }
    return init;
  });
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  const run = useCallback(async () => {
    if (!ready) return;
    const weekStart = startOfWeekMs();
    const list = projectsRef.current;
    const todo = list.filter((p) => {
      if (p.id === activeProjectId) return false; // computed live below
      const c = cache.get(p.id);
      return !c || c.key !== `${p.updatedAt}|${weekStart}`;
    });
    if (todo.length) setLoading(true);
    await Promise.all(
      todo.map(async (p) => {
        try {
          const s = await loadStats(p, weekStart);
          cache.set(p.id, { key: `${p.updatedAt}|${weekStart}`, stats: s });
        } catch {
          // Leave the card without stats rather than failing the whole screen.
        }
      }),
    );
    const next: Record<string, ProjectStats> = {};
    for (const p of list) {
      const c = cache.get(p.id);
      if (c) next[p.id] = c.stats;
    }
    setStats(next);
    setLoading(false);
  }, [ready, activeProjectId]);

  // Refresh whenever the screen regains focus (coming back from a project, capture, etc.).
  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run]),
  );

  // Also refresh when the project list itself changes (create, delete, status change).
  const listKey = projects.map((p) => `${p.id}:${p.updatedAt}`).join(',');
  useEffect(() => {
    void run();
  }, [listKey, tick, run]);

  // The active project is computed from live store state so edits show instantly.
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const merged = useMemo(() => {
    if (!activeProject) return stats;
    const live = liveNodes.filter((n) => n.projectId === activeProject.id);
    if (live.length === 0 && liveSpans.length === 0 && stats[activeProject.id]) return stats;
    const withLen = computeSpanLengths(
      liveSpans.filter((s) => s.projectId === activeProject.id),
      live,
    );
    const s = computeStats(activeProject, live, withLen, startOfWeekMs());
    return { ...stats, [activeProject.id]: s };
  }, [stats, activeProject, liveNodes, liveSpans]);

  const refresh = useCallback(() => {
    cache.clear();
    setTick((t) => t + 1);
  }, []);

  return { stats: merged, loading, refresh };
}
