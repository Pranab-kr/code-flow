'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { RFNode } from './toReactFlow';

/**
 * Node meaning is carried by SHAPE and LABEL, never by colour alone: a diamond is
 * a decision in grayscale export, in a slide deck, and to a colourblind viewer.
 */
export function IRNodeView({ data, selected }: NodeProps<RFNode>) {
  const { kind, label, statements, loopKind, unsupported } = data;
  const isDecision = kind === 'branch' || kind === 'switch';
  const shown = statements.length > 0 ? statements : [label];

  return (
    <div
      className="cf-node"
      data-kind={kind}
      data-selected={selected ? 'true' : undefined}
      data-unreachable={unsupported === 'unreachable' ? 'true' : undefined}
      role="group"
      aria-label={
        unsupported === 'unreachable'
          ? `Unreachable ${kind}: ${label}`
          : `${kind}: ${label}`
      }
    >
      <Handle type="target" position={Position.Top} />

      {isDecision && <span className="cf-node__diamond" aria-hidden="true" />}

      <div className="cf-node__body">
        <span className="cf-node__kind">
          {kind === 'loop-header' && <>{loopKind ?? 'loop'} ↻</>}
          {kind === 'return' && 'return'}
          {kind === 'throw' && 'throw'}
          {isDecision && (kind === 'switch' ? 'switch' : 'if')}
          {unsupported === 'unreachable' && (
            <span className="cf-node__warn" title="This code cannot be reached">
              {' '}
              ⚠ unreachable
            </span>
          )}
        </span>
        <ul className="cf-node__stmts">
          {shown.slice(0, 6).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
          {shown.length > 6 && (
            <li className="cf-node__more">+{shown.length - 6} more</li>
          )}
        </ul>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
