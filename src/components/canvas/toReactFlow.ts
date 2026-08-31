import type { Edge, Node } from '@xyflow/react';
import type { EdgeKind, FunctionGraph, IRNode, Span } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

export interface IRNodeData extends Record<string, unknown> {
  kind: IRNode['kind'];
  label: string;
  statements: string[];
  span: Span;
  loopKind?: string;
  unsupported?: string;
}

export interface IREdgeData extends Record<string, unknown> {
  kind: EdgeKind;
}

export type RFNode = Node<IRNodeData, 'ir'>;
export type RFEdge = Edge<IREdgeData>;

/**
 * Edge styling goes through className, NOT a data attribute.
 *
 * React Flow v12 does not reflect `edge.data` onto the DOM, so a selector like
 * `.react-flow__edge[data-kind="back"]` never matches and every edge would render
 * identically — silently defeating the rule that meaning is never carried by
 * colour alone. `edge.className` IS applied to the edge's <g> element.
 */
function edgeClass(kind: EdgeKind): string {
  return `cf-edge cf-edge-${kind}`;
}

/** Built-in types only, so no edgeTypes map is needed and none can go unregistered. */
function edgeType(kind: EdgeKind): 'default' | 'smoothstep' {
  // Back edges curve, so a loop reads as a loop at a glance.
  return kind === 'back' ? 'default' : 'smoothstep';
}

export function toReactFlow(
  g: FunctionGraph,
  layout: LaidOutGraph,
  overrides: Record<string, { x: number; y: number }> = {},
): { nodes: RFNode[]; edges: RFEdge[] } {
  const placed = new Map(layout.nodes.map((n) => [n.id, n]));

  const nodes: RFNode[] = g.nodes.flatMap((n) => {
    const pos = placed.get(n.id);
    // Degrade rather than throw: a node with no layout entry is skipped.
    if (!pos) return [];
    const override = overrides[n.id];
    return [
      {
        id: n.id,
        type: 'ir' as const,
        position: override ?? { x: pos.x, y: pos.y },
        width: pos.width,
        height: pos.height,
        data: {
          kind: n.kind,
          label: n.label,
          statements: n.statements,
          span: n.span,
          ...(n.meta?.loopKind ? { loopKind: n.meta.loopKind } : {}),
          ...(n.meta?.unsupported ? { unsupported: n.meta.unsupported } : {}),
        },
      },
    ];
  });

  const known = new Set(nodes.map((n) => n.id));
  const edges: RFEdge[] = g.edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: edgeType(e.kind),
      className: edgeClass(e.kind),
      // Motion budget is spent on node-settle; edges never animate.
      animated: false,
      ...(e.label ? { label: e.label } : {}),
      data: { kind: e.kind },
    }));

  return { nodes, edges };
}
