/**
 * IR -> positions.
 *
 * ELK, not dagre: a control-flow graph is full of back edges, and ELK's layered
 * algorithm routes them properly instead of tangling them.
 */

import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';
import type { LaidOutGraph, PositionedNode, RoutedEdge } from './types';

const CHAR_W = 7.4; // Geist Mono at 13px, measured
const LINE_H = 20;
const PAD_X = 28;
const PAD_Y = 20;
const MIN_W = 140;
const MAX_W = 420;

/**
 * elk.bundled.js is a SYNCHRONOUS GWT-compiled solver: it blocks the thread, so a
 * Promise.race against setTimeout can never fire — the timer callback cannot run
 * until layout has already resolved. Bound the work by graph size instead.
 *
 * Measured (elkjs 0.12.0): 400 nodes ~0.7s | 600 ~1.4s | 800 ~2.4s | 1000 ~3.3s
 *                          1500 ~7.8s | 3000 -> RangeError: max call stack
 * 600 keeps the worst case near ~1.5s, inside the spec §11 budget, and stays well
 * clear of the stack-overflow cliff. Do NOT raise this to 1500.
 */
export const MAX_LAYOUT_NODES = 600;

/**
 * Node box size. Branch and switch nodes get extra width because they render as
 * diamonds — the text sits in the narrow middle band.
 */
export function nodeSize(node: IRNode): { width: number; height: number } {
  const longest = node.statements.reduce((m, s) => Math.max(m, s.length), node.label.length);
  const diamond = node.kind === 'branch' || node.kind === 'switch';
  const raw = longest * CHAR_W + PAD_X * (diamond ? 2.2 : 1);
  // Diamonds get their own floor. Clamping both kinds to the same MIN_W would make
  // a short condition render the same width as a short statement, and the rotated
  // square would then clip its own text.
  const floor = diamond ? Math.round(MIN_W * 1.35) : MIN_W;
  const width = Math.min(MAX_W, Math.max(floor, Math.round(raw)));
  const lines = Math.max(1, node.statements.length);
  const height = Math.round(lines * LINE_H + PAD_Y * (diamond ? 1.8 : 1));
  return { width, height };
}

/**
 * Construct ELK with a `document` in scope.
 *
 * elk.bundled.js inlines elk-worker.min.js, which decides AT EVALUATION TIME
 * whether it is itself a worker script:
 *
 *     if (typeof document === 'undefined' && typeof self !== 'undefined') {
 *       self.onmessage = dispatch;            // become the solver
 *     } else if (typeof module !== 'undefined' && module.exports) {
 *       module.exports = { default: j, Worker: j };   // export the fake Worker
 *     }
 *
 * Inside our parse worker both conditions of the first branch hold, so it never
 * reaches the export branch and `require('./elk-worker.min.js').Worker` is
 * undefined — `new ELK()` then dies with "_Worker is not a constructor" and the
 * canvas hangs on its skeleton forever.
 *
 * Browserify evaluates that inner module LAZILY, on the `require` inside the
 * ELKNode constructor, so the shim only has to span construction. It is removed
 * immediately: nothing afterwards wants a fake `document`, and leaving one in a
 * worker's global scope would mislead any other library that feature-detects.
 *
 * Not `elkjs/lib/elk-api.js` + a nested worker: that spawns a second worker per
 * parse and needs a separately served script URL, which Turbopack does not give
 * us for a file inside node_modules. Verified both paths in a real worker.
 */
function createElk(): InstanceType<typeof ELK> {
  const g = globalThis as { document?: unknown; self?: unknown };
  const needsShim = typeof g.document === 'undefined' && typeof g.self !== 'undefined';
  if (!needsShim) return new ELK();

  g.document = {};
  try {
    return new ELK();
  } finally {
    delete g.document;
  }
}

const elk = createElk();

const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '48',
  'elk.spacing.nodeNode': '32',
  'elk.spacing.edgeNode': '20',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // ELK REVERSES back edges unconditionally in the layered algorithm; this strategy
  // only chooses WHICH edges get reversed, not whether. The reversal is undone below.
  'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.mergeEdges': 'false',
  // No 'elk.hierarchyHandling': verified no-op here (children are leaves, and each
  // function is laid out as its own top-level graph).
};

/** Deterministic vertical stack, for when ELK fails or the graph is too large. */
export function fallbackLayout(g: FunctionGraph): LaidOutGraph {
  let y = 0;
  let maxW = 0;
  const nodes: PositionedNode[] = g.nodes.map((n) => {
    const { width, height } = nodeSize(n);
    const placed = { id: n.id, x: 0, y, width, height };
    y += height + 40;
    maxW = Math.max(maxW, width);
    return placed;
  });
  // Keep every edge id so nothing silently disappears; React Flow will draw its
  // own straight path when points are empty.
  return { nodes, edges: g.edges.map((e) => ({ id: e.id, points: [] })), width: maxW, height: y };
}

export async function layoutFunction(g: FunctionGraph): Promise<LaidOutGraph> {
  // Degrade, never blank (spec §11): an oversized graph skips ELK entirely.
  if (g.nodes.length > MAX_LAYOUT_NODES) return fallbackLayout(g);

  const ids = new Set(g.nodes.map((n) => n.id));
  // Drop dangling edges rather than let ELK reject the whole graph.
  const usable = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));

  const graph: ElkNode = {
    id: g.id,
    layoutOptions: ELK_OPTIONS,
    children: g.nodes.map((n) => ({ id: n.id, ...nodeSize(n) })),
    edges: usable.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  };

  try {
    const laid = await elk.layout(graph);

    const nodes: PositionedNode[] = (laid.children ?? []).map((c) => ({
      id: c.id,
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width ?? MIN_W,
      height: c.height ?? LINE_H,
    }));

    const irSource = new Map(usable.map((e) => [e.id, e.source]));
    const edges: RoutedEdge[] = (laid.edges ?? []).map((e) => {
      const section = e.sections?.[0];
      const raw = section
        ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
        : [];
      const points = raw.map((p) => ({ x: p.x, y: p.y }));
      // Undo ELK's cycle-breaking reversal, so the caller always receives points
      // running IR-source -> IR-target. Without this, a loop's back edge renders
      // with its arrow pointing the wrong way.
      const reversed = e.sources?.[0] !== undefined && e.sources[0] !== irSource.get(e.id);
      return { id: e.id, points: reversed ? points.reverse() : points };
    });

    return { nodes, edges, width: laid.width ?? 0, height: laid.height ?? 0 };
  } catch {
    return fallbackLayout(g);
  }
}

/** Lay out every function in a program, keyed by function id. */
export async function layoutProgram(
  functions: FunctionGraph[],
): Promise<Record<string, LaidOutGraph>> {
  const entries = await Promise.all(
    functions.map(async (f) => [f.id, await layoutFunction(f)] as const),
  );
  return Object.fromEntries(entries);
}
