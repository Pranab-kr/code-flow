// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildContext } from './context';
import type { ProgramIR } from '@/lib/ir/types';

const SRC = 'def f(n):\n    while n > 0:\n        n -= 1\n    return n\n';

const IR: ProgramIR = {
  language: 'python',
  functions: [
    {
      id: 'f(n)',
      name: 'f',
      params: ['n'],
      nodes: [
        {
          id: 'f(n)/entry',
          kind: 'entry',
          label: 'entry',
          statements: [],
          span: { startLine: 1, endLine: 1 },
        },
        {
          id: 'f()/while@0#cond-b0',
          kind: 'loop-header',
          label: 'while n > 0',
          statements: ['while n > 0'],
          span: { startLine: 2, endLine: 2 },
          meta: { loopKind: 'while' },
        },
        {
          id: 'f()/while@0#body-b0',
          kind: 'basic',
          label: 'n -= 1',
          statements: ['n -= 1'],
          span: { startLine: 3, endLine: 3 },
        },
        {
          id: 'f(n)/exit@0',
          kind: 'exit',
          label: 'return n',
          statements: ['return n'],
          span: { startLine: 4, endLine: 4 },
        },
      ],
      edges: [
        { id: 'e0', source: 'f(n)/entry', target: 'f()/while@0#cond-b0', kind: 'seq' },
        { id: 'e1', source: 'f()/while@0#cond-b0', target: 'f()/while@0#body-b0', kind: 'true' },
        { id: 'e2', source: 'f()/while@0#body-b0', target: 'f()/while@0#cond-b0', kind: 'back' },
        { id: 'e3', source: 'f()/while@0#cond-b0', target: 'f(n)/exit@0', kind: 'false' },
      ],
      entryId: 'f(n)/entry',
      exitIds: ['f(n)/exit@0'],
    },
  ],
  callEdges: [],
  diagnostics: [],
  irVersion: 1,
};

const IR_WITH_ERRORS: ProgramIR = {
  ...IR,
  diagnostics: [
    { severity: 'error', message: 'unexpected indent', span: { startLine: 2, endLine: 2 } },
  ],
};

function hugeIr(): ProgramIR {
  const nodes = Array.from({ length: 5000 }, (_, i) => ({
    id: `big()/stmt@${i}`,
    kind: 'basic' as const,
    label: `x = ${i} + some fairly long statement text to fill the window`,
    statements: [`x = ${i}`],
    span: { startLine: i + 1, endLine: i + 1 },
  }));
  const edges = nodes.slice(0, nodes.length - 1).map((n, i) => ({
    id: `he${i}`,
    source: n.id,
    target: nodes[i + 1].id,
    kind: 'seq' as const,
  }));
  return {
    language: 'python',
    functions: [
      {
        id: 'big()',
        name: 'big',
        params: [],
        nodes,
        edges,
        entryId: nodes[0].id,
        exitIds: [nodes[nodes.length - 1].id],
      },
    ],
    callEdges: [],
    diagnostics: [],
    irVersion: 1,
  };
}

describe('buildContext', () => {
  it('includes the source', () => {
    expect(buildContext(IR, 'def f():\n    pass\n')).toContain('def f()');
  });

  it('summarizes the graph structurally, not as raw json', () => {
    const out = buildContext(IR, SRC);
    expect(out).toContain('loop-header');
    expect(out).not.toContain('"irVersion"'); // raw IR wastes the window
  });

  it('names the selected node so "this node" is answerable', () => {
    const out = buildContext(IR, SRC, 'f()/while@0#cond-b0');
    expect(out).toMatch(/selected/i);
  });

  it('reports syntax errors, so the model does not explain broken code as working', () => {
    expect(buildContext(IR_WITH_ERRORS, SRC)).toMatch(/syntax error/i);
  });

  it('truncates predictably on a large graph', () => {
    expect(buildContext(hugeIr(), 'x = 1\n'.repeat(20_000)).length).toBeLessThan(24_000);
  });
});
