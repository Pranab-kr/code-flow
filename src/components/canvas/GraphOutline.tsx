'use client';

import { useMemo } from 'react';
import type { FunctionGraph } from '@/lib/ir/types';
import { buildOutline } from './outline';

interface Props {
  graph: FunctionGraph;
  selectedId?: string | null;
  onSelect?: (startLine: number, nodeId: string) => void;
}

function kindCaption(kind: string, loopKind?: string): string {
  switch (kind) {
    case 'loop-header':
      return `${loopKind ?? 'loop'} loop`;
    case 'branch':
      return 'if';
    case 'switch':
      return 'switch';
    case 'return':
      return 'return';
    case 'throw':
      return 'throw';
    case 'call-site':
      return 'call';
    default:
      return 'step';
  }
}

/**
 * A text outline of the control-flow structure — a first-class view, not a
 * fallback. Derived from the same IR as the diagram, so the two cannot
 * disagree. Native buttons give keyboard users Tab + Enter for free, which is
 * the accessible path the canvas (React Flow, arrow-key traversal) cannot
 * promise; activating a step jumps the editor to its line like a node click.
 */
export function GraphOutline({ graph, selectedId, onSelect }: Props) {
  const steps = useMemo(() => buildOutline(graph), [graph]);

  return (
    <nav
      className="cf-outline"
      aria-label={`Control flow outline for ${graph.name}, ${steps.length} nodes`}
    >
      <p className="cf-outline__heading" aria-hidden="true">
        {graph.name}
        <span className="cf-outline__count">
          {steps.length} {steps.length === 1 ? 'node' : 'nodes'}
        </span>
      </p>
      <ol className="cf-outline__list">
        {steps.map((s) => (
          <li
            key={s.id}
            className="cf-outline__item"
            data-depth={s.depth}
            style={{ ['--outline-depth' as string]: s.depth }}
          >
            <button
              type="button"
              className="cf-outline__step"
              aria-current={selectedId === s.id ? 'true' : undefined}
              onClick={() => onSelect?.(s.span.startLine, s.id)}
            >
              <span className="cf-outline__num">{s.step}.</span>{' '}
              <span className="cf-outline__kind">{kindCaption(s.kind, s.loopKind)}</span>{' '}
              <span className="cf-outline__label">{s.label}</span>{' '}
              <span className="cf-outline__line">line {s.span.startLine}</span>
              {s.unreachable && <span className="cf-outline__warn"> ⚠ unreachable</span>}
              {s.backToStep !== undefined && (
                <span className="cf-outline__back"> ↻ back to step {s.backToStep}</span>
              )}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
