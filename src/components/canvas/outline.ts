import type { FunctionGraph, IRNode, Span } from '@/lib/ir/types';

export interface OutlineStep {
  id: string;
  step: number;
  kind: IRNode['kind'];
  label: string;
  statements: string[];
  span: Span;
  depth: number;
  loopKind?: string;
  unreachable?: boolean;
  backToStep?: number;
}

/**
 * Nesting depth from the structural id: the path between the function id and
 * the `#role` suffix. `fn#b0` is top level (0), `fn/while@0#cond-b0` sits one
 * level in, `fn/while@0/if@0/then#return-b0` three levels in. Entry/exit are
 * excluded by the caller — depth is purely positional, so a re-parse that
 * renames a label cannot change the nesting.
 */
export function depthOf(id: string): number {
  const hash = id.lastIndexOf('#');
  const head = hash >= 0 ? id.slice(0, hash) : id;
  const slash = head.indexOf('/');
  if (slash < 0) return 0;
  return head.slice(slash + 1).split('/').filter(Boolean).length;
}

/**
 * A text outline of the control-flow structure, derived from the same IR as
 * the diagram. Entry/exit terminals are not steps — the function signature is
 * the heading and returns are the final steps, matching the plan's example.
 * Back edges annotate their source with the target step ("back to step N").
 */
export function buildOutline(graph: FunctionGraph): OutlineStep[] {
  const steps: OutlineStep[] = [];
  const stepOf = new Map<string, number>();
  let n = 0;
  for (const node of graph.nodes) {
    if (node.kind === 'entry' || node.kind === 'exit') continue;
    n += 1;
    stepOf.set(node.id, n);
    steps.push({
      id: node.id,
      step: n,
      kind: node.kind,
      label: node.label,
      statements: node.statements,
      span: node.span,
      depth: depthOf(node.id),
      ...(node.meta?.loopKind ? { loopKind: node.meta.loopKind } : {}),
      ...(node.meta?.unsupported === 'unreachable' ? { unreachable: true } : {}),
    });
  }
  for (const edge of graph.edges) {
    if (edge.kind !== 'back') continue;
    const from = steps.find((s) => s.id === edge.source);
    const target = stepOf.get(edge.target);
    if (from && target !== undefined && from.backToStep === undefined) {
      from.backToStep = target;
    }
  }
  return steps;
}
