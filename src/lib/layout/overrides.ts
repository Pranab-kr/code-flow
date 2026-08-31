/**
 * Reconciling saved node positions against a freshly derived graph.
 *
 * The diagram is a derived view, so every parse produces a new graph. This module
 * decides what happens to the positions a user dragged: which still apply, which
 * refer to nodes that have vanished, and which have come back.
 *
 * Portable on purpose — no React, no database. The persistence layer calls it.
 */

export interface Override {
  /** Stable structural node id (spec §6). */
  nodeId: string;
  x: number;
  y: number;
  collapsed: boolean;
  /** ISO timestamp set when the node stopped appearing in the graph. */
  orphanedAt: string | null;
}

export interface Reconciled {
  /** Overrides that apply to the current graph. */
  active: Override[];
  /** Node ids to stamp `orphaned_at` on — newly vanished. */
  orphaned: string[];
  /** Node ids whose `orphaned_at` should be cleared — reappeared. */
  revived: string[];
}

/** How long an orphaned override is kept before a scheduled job removes it. */
export const ORPHAN_RETENTION_DAYS = 30;

/**
 * Match saved positions against the node ids in the current graph.
 *
 * A vanished node is MARKED, never deleted. A transient syntax error can make a
 * node disappear for a single parse, and deleting on disappearance would throw
 * away arrangement work because someone typed a stray brace. An already-orphaned
 * node is not re-stamped, or its retention clock would restart on every parse and
 * it would never age out.
 */
export function reconcile(saved: Override[], liveIds: Set<string>): Reconciled {
  const active: Override[] = [];
  const orphaned: string[] = [];
  const revived: string[] = [];

  for (const o of saved) {
    if (liveIds.has(o.nodeId)) {
      active.push(o);
      // Its node is back, so the saved position is still the user's intent.
      if (o.orphanedAt) revived.push(o.nodeId);
    } else if (!o.orphanedAt) {
      orphaned.push(o.nodeId);
    }
  }

  return { active, orphaned, revived };
}

/** Reduce overrides to the position map the canvas consumes. */
export function toPositions(
  overrides: Override[],
): Record<string, { x: number; y: number }> {
  return Object.fromEntries(overrides.map((o) => [o.nodeId, { x: o.x, y: o.y }]));
}
