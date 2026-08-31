'use server';

import { createServerClient } from '@/lib/supabase/server';
import { reconcile, toPositions, type Override } from '@/lib/layout/overrides';

/**
 * Persist one dragged node position.
 *
 * Upserts on (project_id, node_id) and clears orphaned_at: touching a node is
 * proof it exists again, whatever a previous parse thought.
 */
export async function saveOverride(
  projectId: string,
  nodeId: string,
  x: number,
  y: number,
): Promise<{ ok?: true; error?: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase.from('layout_overrides').upsert(
    {
      project_id: projectId,
      node_id: nodeId,
      x,
      y,
      orphaned_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,node_id' },
  );
  // RLS refuses a project the caller does not own, so an error here is real.
  if (error) return { error: 'Could not save that position.' };
  return { ok: true };
}

/** Persist several positions at once — a multi-select drag is one write. */
export async function saveOverrides(
  projectId: string,
  moves: { nodeId: string; x: number; y: number }[],
): Promise<{ ok?: true; error?: string }> {
  if (moves.length === 0) return { ok: true };

  const supabase = await createServerClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from('layout_overrides').upsert(
    moves.map((m) => ({
      project_id: projectId,
      node_id: m.nodeId,
      x: m.x,
      y: m.y,
      orphaned_at: null,
      updated_at: now,
    })),
    { onConflict: 'project_id,node_id' },
  );
  if (error) return { error: 'Could not save those positions.' };
  return { ok: true };
}

/**
 * Load saved positions and reconcile them against the ids in the current graph.
 *
 * Writes back the two bookkeeping changes reconcile identifies: newly vanished
 * nodes get stamped, reappeared ones get cleared. Both are best-effort — failing
 * to stamp an orphan must not stop the diagram from rendering.
 */
export async function loadOverrides(
  projectId: string,
  liveNodeIds: string[],
): Promise<Record<string, { x: number; y: number }>> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('layout_overrides')
    .select('node_id, x, y, collapsed, orphaned_at')
    .eq('project_id', projectId);
  if (error || !data) return {};

  const saved: Override[] = data.map((r) => ({
    nodeId: r.node_id,
    x: r.x,
    y: r.y,
    collapsed: r.collapsed,
    orphanedAt: r.orphaned_at,
  }));

  const { active, orphaned, revived } = reconcile(saved, new Set(liveNodeIds));

  if (orphaned.length > 0) {
    await supabase
      .from('layout_overrides')
      .update({ orphaned_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .in('node_id', orphaned);
  }

  if (revived.length > 0) {
    await supabase
      .from('layout_overrides')
      .update({ orphaned_at: null })
      .eq('project_id', projectId)
      .in('node_id', revived);
  }

  return toPositions(active);
}
