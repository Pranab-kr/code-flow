/**
 * @vitest-environment node
 *
 * Regression: layout must construct inside a WEB WORKER, not just on the main
 * thread and not just in Node.
 *
 * elkjs's inlined elk-worker.min.js decides at EVALUATION time whether it is
 * itself a worker script, via `typeof document === 'undefined' && typeof self
 * !== 'undefined'`. In our parse worker both hold, so it installs itself as a
 * message handler instead of exporting the fake `Worker` class — leaving
 * `require('./elk-worker.min.js').Worker` undefined, and `new ELK()` throws
 * "_Worker is not a constructor".
 *
 * jsdom defines `document`, so the unit suite could never see this. Node
 * defines neither `document` nor `self`, so the Inngest job could not either.
 * This test recreates the worker's global shape: no `document`, but a `self`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FunctionGraph } from '@/lib/ir/types';

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.self;
});

describe('layout in a web-worker global scope', () => {
  it('constructs ELK when document is absent and self is present', async () => {
    expect(typeof g.document).toBe('undefined');
    g.self = globalThis;

    // Fresh module registry: `const elk = new ELK()` runs at module scope, and
    // the failure happens there, so a cached module would hide it.
    vi.resetModules();
    const mod = await import('./elk');

    const graph: FunctionGraph = {
      id: 'f()',
      name: 'f',
      params: [],
      entryId: 'a',
      exitIds: ['b'],
      nodes: [
        { id: 'a', kind: 'entry' as const, label: 'a', statements: [], span: { startLine: 1, endLine: 1 } },
        { id: 'b', kind: 'return' as const, label: 'b', statements: [], span: { startLine: 2, endLine: 2 } },
      ],
      edges: [{ id: 'e', source: 'a', target: 'b', kind: 'seq' as const }],
    };

    const laid = await mod.layoutFunction(graph);

    // A real layout, not the fallback: ELK stacks b below a.
    const a = laid.nodes.find((n) => n.id === 'a');
    const b = laid.nodes.find((n) => n.id === 'b');
    expect(b!.y).toBeGreaterThan(a!.y);
  });
});
