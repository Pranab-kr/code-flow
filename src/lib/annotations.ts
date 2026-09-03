/**
 * Sticky notes on the canvas (spec §8, Plan 4 Task 4).
 *
 * Tier-1 edits: layout/annotation, no effect on source. A note is never
 * re-derived from a parse — it survives every re-parse by construction, because
 * `toReactFlow` emits it from this list rather than from the graph.
 *
 * `nodeId` anchors a note to an IR node (nullable: free-floating allowed).
 * Anchored notes move with their node; free-floating ones keep their own
 * position. Positions are absolute canvas coordinates, matching the
 * `annotations` table (`project_id`, `node_id`, `body`, `x`, `y`).
 */

export interface Annotation {
  id: string;
  /** IR node id this note is anchored to, or null for free-floating. */
  nodeId: string | null;
  body: string;
  x: number;
  y: number;
}

/** Default footprint for a new note, reused by canvas + export bounds. */
export const ANNOTATION_WIDTH = 180;
export const ANNOTATION_HEIGHT = 100;

export const MAX_ANNOTATION_BODY = 5000;

/**
 * Shift every note anchored to `nodeId` by (`dx`, `dy`).
 *
 * Pure: returns a new array, touching only anchored notes. Free-floating
 * notes keep their position. This is what "anchored notes move with their
 * node" means — the drag handler computes the delta from the node's old to
 * its new position and applies it here.
 */
export function shiftAnchored(
  annotations: Annotation[],
  nodeId: string,
  dx: number,
  dy: number,
): Annotation[] {
  if (dx === 0 && dy === 0) return annotations;
  let touched = false;
  const next = annotations.map((a) => {
    if (a.nodeId !== nodeId) return a;
    touched = true;
    return { ...a, x: a.x + dx, y: a.y + dy };
  });
  return touched ? next : annotations;
}

/** Notes anchored to a node that no longer exists still render — degrade, never blank. */
export function anchoredTo(annotations: Annotation[], nodeId: string): Annotation[] {
  return annotations.filter((a) => a.nodeId === nodeId);
}
