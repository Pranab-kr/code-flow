'use client';

import { FlowCanvas } from '@/components/canvas/FlowCanvas';
import type { FunctionGraph } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';
import demo from '@/lib/demo-ir.json';

const baked = demo as unknown as { graph: FunctionGraph; layout: LaidOutGraph };

/**
 * The hero IS the product rendering actual output: the real `FlowCanvas` on a
 * prebaked binary-search IR. No wasm downloads, no fake chrome, nothing to
 * misrepresent. Non-interactive, aria-hidden, with its own text description —
 * the same structure the outline view (Plan 6 Task 3) reads from the same IR.
 */
export function HeroCanvas() {
  return (
    <figure className="hero__map" aria-label="Diagram of binary search, derived from its source">
      <p className="hero__orientation">Source → branches and loops → diagram</p>
      <div className="hero__canvas" aria-hidden="true">
        <FlowCanvas graph={baked.graph} layout={baked.layout} interactive={false} />
      </div>
      <p className="visually-hidden">
        Control flow for binary search, {baked.graph.nodes.length} blocks: set the bounds, loop
        while lo is at most hi, take the midpoint, return it on a match, narrow the bounds
        otherwise, and return negative one when the range is empty.
      </p>
      <figcaption className="hero__caption">
        Binary search, diagrammed from its own source.{' '}
        <a className="hero__caption-link" href="/demo">
          Open the live demo
        </a>{' '}
        to parse as you type.
      </figcaption>
    </figure>
  );
}
