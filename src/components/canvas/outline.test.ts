import { describe, it, expect } from 'vitest';
import { buildOutline } from './outline';
import type { FunctionGraph, IRNode } from '@/lib/ir/types';

const node = (
  id: string,
  kind: IRNode['kind'],
  label: string,
  startLine = 1,
  meta?: IRNode['meta'],
): IRNode => ({
  id,
  kind,
  label,
  statements: [label],
  span: { startLine, endLine: startLine },
  ...(meta ? { meta } : {}),
});

const FN = 'binary_search(arr,target)';

const graph: FunctionGraph = {
  id: FN,
  name: 'binary_search',
  params: ['arr', 'target'],
  entryId: `${FN}#entry`,
  exitIds: [],
  nodes: [
    node(`${FN}#entry`, 'entry', 'binary_search(arr, target)', 1),
    node(`${FN}#b0`, 'basic', 'lo = 0', 2),
    node(`${FN}/while@0#cond-b0`, 'loop-header', 'lo <= hi', 4, { loopKind: 'while' }),
    node(`${FN}/while@0#b1`, 'basic', 'mid = (lo + hi) // 2', 5),
    node(`${FN}/while@0/if@0#cond-b0`, 'branch', 'arr[mid] == target', 6),
    node(`${FN}/while@0/if@0/then#return-b0`, 'return', 'return mid', 7),
    node(`${FN}/while@0/if@0/else/if@0#cond-b0`, 'branch', 'arr[mid] < target', 8),
    node(`${FN}/while@0/if@0/else/if@0/then#b0`, 'basic', 'lo = mid + 1', 9),
    node(`${FN}#return-b1`, 'return', 'return -1', 12),
  ],
  edges: [
    { id: 'e0', source: `${FN}#entry`, target: `${FN}#b0`, kind: 'seq' },
    { id: 'e1', source: `${FN}#b0`, target: `${FN}/while@0#cond-b0`, kind: 'seq' },
    {
      id: 'e2',
      source: `${FN}/while@0/if@0/else/if@0/then#b0`,
      target: `${FN}/while@0#cond-b0`,
      kind: 'back',
      label: 'while',
    },
  ],
};

describe('buildOutline', () => {
  it('excludes entry nodes and numbers the rest sequentially', () => {
    const steps = buildOutline(graph);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(steps[0].label).toBe('lo = 0');
    expect(steps[steps.length - 1].label).toBe('return -1');
  });

  it('derives nesting depth from the structural path', () => {
    const steps = buildOutline(graph);
    const byLabel = new Map(steps.map((s) => [s.label, s]));
    expect(byLabel.get('lo = 0')!.depth).toBe(0);
    expect(byLabel.get('lo <= hi')!.depth).toBe(1);
    expect(byLabel.get('arr[mid] == target')!.depth).toBe(2);
    expect(byLabel.get('return mid')!.depth).toBe(3);
  });

  it('annotates back-edge sources with the target step', () => {
    const steps = buildOutline(graph);
    const lo = steps.find((s) => s.label === 'lo = mid + 1')!;
    const cond = steps.find((s) => s.label === 'lo <= hi')!;
    expect(lo.backToStep).toBe(cond.step);
  });

  it('carries kind, span, loop kind, and unreachable through', () => {
    const dead = node(`${FN}#b9`, 'basic', 'print(x)', 13, { unsupported: 'unreachable' });
    const g: FunctionGraph = { ...graph, nodes: [...graph.nodes, dead] };
    const steps = buildOutline(g);
    const found = steps.find((s) => s.id === `${FN}#b9`)!;
    expect(found.kind).toBe('basic');
    expect(found.span.startLine).toBe(13);
    expect(found.unreachable).toBe(true);
    const loop = steps.find((s) => s.label === 'lo <= hi')!;
    expect(loop.loopKind).toBe('while');
  });
});
