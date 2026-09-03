import { describe, it, expect } from 'vitest';
import { toReactFlow } from './toReactFlow';
import type { Annotation } from '@/lib/annotations';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

const node = (id: string, kind: IRNode['kind'], statements: string[] = []): IRNode => ({
  id,
  kind,
  label: statements[0] ?? id,
  statements,
  span: { startLine: 1, endLine: 2 },
});

const g: FunctionGraph = {
  id: 'f()',
  name: 'f',
  params: [],
  entryId: 'a',
  exitIds: ['c'],
  nodes: [node('a', 'entry'), node('b', 'branch', ['x > 0']), node('c', 'exit')],
  edges: [
    { id: 'e0', source: 'a', target: 'b', kind: 'seq' },
    { id: 'e1', source: 'b', target: 'c', kind: 'true', label: 'true' },
    { id: 'e2', source: 'b', target: 'a', kind: 'back', label: 'while' },
  ],
};

const layout: LaidOutGraph = {
  nodes: [
    { id: 'a', x: 0, y: 0, width: 100, height: 40 },
    { id: 'b', x: 0, y: 80, width: 120, height: 50 },
    { id: 'c', x: 0, y: 200, width: 100, height: 40 },
  ],
  edges: [],
  width: 120,
  height: 240,
};

describe('toReactFlow', () => {
  it('maps every IR node to a positioned node', () => {
    const { nodes } = toReactFlow(g, layout);
    expect(nodes).toHaveLength(3);
    expect(nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 0, y: 80 });
  });

  it('carries kind and span through for the editor link', () => {
    const b = toReactFlow(g, layout).nodes.find((n) => n.id === 'b')!;
    expect(b.data.kind).toBe('branch');
    expect(b.data.span).toEqual({ startLine: 1, endLine: 2 });
  });

  it('user overrides win over the auto layout', () => {
    const { nodes } = toReactFlow(g, layout, { b: { x: 999, y: 888 } });
    expect(nodes.find((n) => n.id === 'b')!.position).toEqual({ x: 999, y: 888 });
  });

  it('labels true/false edges, so meaning is not carried by colour', () => {
    const { edges } = toReactFlow(g, layout);
    expect(edges.find((e) => e.id === 'e1')!.label).toBe('true');
  });

  // v12 does NOT reflect edge.data to DOM attributes, so CSS cannot select on it.
  // className is the supported hook.
  it('styles edge kinds via className, never a data attribute', () => {
    const { edges } = toReactFlow(g, layout);
    expect(edges.find((e) => e.id === 'e2')!.className).toContain('cf-edge-back');
    expect(edges.find((e) => e.id === 'e1')!.className).toContain('cf-edge-true');
  });

  it('uses only BUILT-IN edge types, so no edgeTypes map is required', () => {
    const { edges } = toReactFlow(g, layout);
    const builtin = new Set(['default', 'straight', 'step', 'smoothstep', undefined]);
    for (const e of edges) expect(builtin.has(e.type)).toBe(true);
  });

  it('marks back edges as non-animated', () => {
    // Motion budget is spent on node-settle; edges never animate.
    expect(toReactFlow(g, layout).edges.every((e) => e.animated === false)).toBe(true);
  });

  it('drops nodes with no layout entry rather than throwing', () => {
    const partial: LaidOutGraph = { ...layout, nodes: layout.nodes.slice(0, 2) };
    expect(toReactFlow(g, partial).nodes).toHaveLength(2);
  });

  it('drops edges whose endpoints were dropped', () => {
    const partial: LaidOutGraph = { ...layout, nodes: layout.nodes.slice(0, 2) };
    const { edges } = toReactFlow(g, partial);
    expect(edges.map((e) => e.id)).not.toContain('e1');
  });

  it('passes node size through from the layout', () => {
    const b = toReactFlow(g, layout).nodes.find((n) => n.id === 'b')!;
    expect(b.width).toBe(120);
    expect(b.height).toBe(50);
  });

  it('flags unreachable nodes so the canvas can dim them', () => {
    const dead = node('d', 'basic', ['print(x)']);
    dead.meta = { unsupported: 'unreachable' };
    const withDead: FunctionGraph = { ...g, nodes: [...g.nodes, dead] };
    const withLayout: LaidOutGraph = {
      ...layout,
      nodes: [...layout.nodes, { id: 'd', x: 0, y: 300, width: 100, height: 40 }],
    };
    const d = toReactFlow(withDead, withLayout).nodes.find((n) => n.id === 'd')!;
    expect(d.data.unsupported).toBe('unreachable');
  });
});

describe('toReactFlow annotations', () => {
  const notes: Annotation[] = [
    { id: 'note-1', nodeId: null, body: 'remember this', x: 10, y: 20 },
    { id: 'note-2', nodeId: 'b', body: 'about the branch', x: 30, y: 40 },
  ];

  it('emits annotation nodes alongside IR nodes', () => {
    const { nodes } = toReactFlow(g, layout, {}, notes);
    expect(nodes).toHaveLength(5);
    const n1 = nodes.find((n) => n.id === 'note-1')!;
    expect(n1.type).toBe('annotation');
    expect(n1.position).toEqual({ x: 10, y: 20 });
  });

  it('carries body and anchor through, with no structural IR id', () => {
    const { nodes } = toReactFlow(g, layout, {}, notes);
    const n2 = nodes.find((n) => n.id === 'note-2')!;
    expect(n2.type).toBe('annotation');
    if (n2.type !== 'annotation') throw new Error('expected annotation node');
    expect(n2.data.body).toBe('about the branch');
    expect(n2.data.nodeId).toBe('b');
    expect((n2.data as Record<string, unknown>).kind).toBeUndefined();
  });

  it('marks annotation nodes draggable with their own footprint', () => {
    const { nodes } = toReactFlow(g, layout, {}, notes);
    const n1 = nodes.find((n) => n.id === 'note-1')!;
    expect(n1.draggable).toBe(true);
    expect(n1.width).toBeGreaterThan(0);
    expect(n1.height).toBeGreaterThan(0);
  });

  it('never attaches graph edges to notes', () => {
    const { edges } = toReactFlow(g, layout, {}, notes);
    expect(edges.map((e) => e.id).sort()).toEqual(['e0', 'e1', 'e2']);
    for (const e of edges) {
      expect(e.source.startsWith('note-')).toBe(false);
      expect(e.target.startsWith('note-')).toBe(false);
    }
  });

  it('survives a re-parse: same notes, new graph, nothing dropped', () => {
    const regraph: FunctionGraph = {
      ...g,
      nodes: g.nodes.filter((n) => n.id !== 'c'),
      edges: g.edges.filter((e) => e.id === 'e0'),
    };
    const { nodes } = toReactFlow(regraph, layout, {}, notes);
    expect(nodes.filter((n) => n.type === 'annotation').map((n) => n.id).sort()).toEqual([
      'note-1',
      'note-2',
    ]);
  });

  it('defaults to no notes, so existing callers are unchanged', () => {
    expect(toReactFlow(g, layout).nodes).toHaveLength(3);
  });
});
