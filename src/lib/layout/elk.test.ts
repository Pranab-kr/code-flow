import { describe, it, expect } from 'vitest';
import { layoutFunction, nodeSize, fallbackLayout, MAX_LAYOUT_NODES } from './elk';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';

const node = (id: string, kind: IRNode['kind'], statements: string[] = []): IRNode => ({
  id,
  kind,
  label: statements[0] ?? id,
  statements,
  span: { startLine: 1, endLine: 1 },
});

const simpleLoop = (): FunctionGraph => ({
  id: 'f()',
  name: 'f',
  params: [],
  entryId: 'entry',
  exitIds: ['exit'],
  nodes: [
    node('entry', 'entry'),
    node('header', 'loop-header', ['i < n']),
    node('body', 'basic', ['i += 1']),
    node('exit', 'exit'),
  ],
  edges: [
    { id: 'e0', source: 'entry', target: 'header', kind: 'seq' },
    { id: 'e1', source: 'header', target: 'body', kind: 'true', label: 'true' },
    { id: 'e2', source: 'body', target: 'header', kind: 'back', label: 'while' },
    { id: 'e3', source: 'header', target: 'exit', kind: 'false', label: 'false' },
  ],
});

describe('nodeSize', () => {
  it('sizes a branch wider than a plain block for the same text', () => {
    expect(nodeSize(node('b', 'branch', ['x = 1'])).width).toBeGreaterThan(
      nodeSize(node('a', 'basic', ['x = 1'])).width,
    );
  });

  it('grows height with statement count', () => {
    const one = nodeSize(node('a', 'basic', ['x = 1'])).height;
    const three = nodeSize(node('b', 'basic', ['x = 1', 'y = 2', 'z = 3'])).height;
    expect(three).toBeGreaterThan(one);
  });

  it('caps width so one long line cannot blow out the canvas', () => {
    expect(nodeSize(node('a', 'basic', ['x'.repeat(500)])).width).toBeLessThanOrEqual(420);
  });

  it('is deterministic', () => {
    const n = node('a', 'basic', ['some statement']);
    expect(nodeSize(n)).toEqual(nodeSize(n));
  });
});

describe('layoutFunction', () => {
  it('positions every node with finite coordinates', async () => {
    const out = await layoutFunction(simpleLoop());
    expect(out.nodes).toHaveLength(4);
    for (const n of out.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
  });

  it('flows top-to-bottom: entry above header above exit', async () => {
    const out = await layoutFunction(simpleLoop());
    const at = (id: string) => out.nodes.find((n) => n.id === id)!;
    expect(at('entry').y).toBeLessThan(at('header').y);
    expect(at('header').y).toBeLessThan(at('exit').y);
  });

  it('reports overall dimensions', async () => {
    const out = await layoutFunction(simpleLoop());
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
  });

  it('routes edges with real points', async () => {
    const out = await layoutFunction(simpleLoop());
    expect(out.edges.length).toBeGreaterThan(0);
    expect(out.edges.every((e) => e.points.length >= 2)).toBe(true);
  });

  it('is deterministic for the same input', async () => {
    const a = await layoutFunction(simpleLoop());
    const b = await layoutFunction(simpleLoop());
    expect(JSON.stringify(a.nodes)).toBe(JSON.stringify(b.nodes));
  });

  it('does not mutate the IR it is given', async () => {
    const g = simpleLoop();
    const before = JSON.stringify(g);
    await layoutFunction(g);
    expect(JSON.stringify(g)).toBe(before);
  });

  // ELK *would* reject a dangling edge, but layoutFunction filters those out
  // first — so this exercises the SUCCESS path. Assert the drop, not a fallback.
  it('drops dangling edges instead of failing the whole layout', async () => {
    const broken = simpleLoop();
    broken.edges.push({ id: 'bad', source: 'header', target: 'ghost', kind: 'seq' });
    const out = await layoutFunction(broken);
    expect(out.nodes).toHaveLength(4);
    expect(out.edges.map((e) => e.id)).not.toContain('bad');
  });

  it('skips ELK entirely past MAX_LAYOUT_NODES', async () => {
    const big = simpleLoop();
    big.nodes = Array.from({ length: MAX_LAYOUT_NODES + 1 }, (_, i) =>
      node(`n${i}`, 'basic', [`s${i}`]),
    );
    big.edges = [];
    const out = await layoutFunction(big);
    // rendered via the stacked fallback, never dropped
    expect(out.nodes).toHaveLength(MAX_LAYOUT_NODES + 1);
    expect(out.nodes.every((n) => n.x === 0)).toBe(true);
  });
});

describe('fallbackLayout', () => {
  it('stacks every node in a deterministic top-down order', () => {
    const out = fallbackLayout(simpleLoop());
    expect(out.nodes).toHaveLength(4);
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    const ys = out.nodes.map((n) => n.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('keeps every edge id, so nothing silently disappears', () => {
    const g = simpleLoop();
    expect(fallbackLayout(g).edges.map((e) => e.id)).toEqual(g.edges.map((e) => e.id));
  });
});
