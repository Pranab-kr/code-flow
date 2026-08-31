import { describe, it, expect } from 'vitest';
import { buildFunctionGraph, buildProgramIR, type SynNode } from './builder';
import type { EdgeKind, FunctionGraph } from './types';

/** Build a normalized syntax node. */
function n(
  kind: SynNode['kind'],
  text: string,
  children: SynNode[] = [],
  meta?: SynNode['meta'],
): SynNode {
  return { kind, text, children, span: { startLine: 1, endLine: 1 }, meta };
}

/** Follow the first edge of a given kind out of a node. */
function via(g: FunctionGraph, from: string, kind: EdgeKind) {
  const e = g.edges.find((x) => x.source === from && x.kind === kind);
  if (!e) throw new Error(`no ${kind} edge out of ${from}: ${JSON.stringify(g.edges)}`);
  return g.nodes.find((x) => x.id === e.target)!;
}

const byStmt = (g: FunctionGraph, s: string) =>
  g.nodes.find((x) => x.statements[0] === s)!;

describe('buildFunctionGraph — straight line', () => {
  it('collapses consecutive statements into ONE basic block', () => {
    const fn = n('func', 'f', [
      n('stmt', 'lo = 0'),
      n('stmt', 'hi = n - 1'),
      n('stmt', 'mid = 0'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const basics = g.nodes.filter((x) => x.kind === 'basic');
    expect(basics).toHaveLength(1);
    expect(basics[0].statements).toEqual(['lo = 0', 'hi = n - 1', 'mid = 0']);
  });

  it('always has an entry and at least one exit', () => {
    const g = buildFunctionGraph(n('func', 'f', [n('stmt', 'x = 1')]), 'f()', 'f', []);
    expect(g.nodes.find((x) => x.id === g.entryId)!.kind).toBe('entry');
    expect(g.exitIds.length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildFunctionGraph — branches', () => {
  it('emits a branch node with true and false edges', () => {
    const fn = n('func', 'f', [
      // children = then arm ONLY; the else arm travels in meta.elseBody
      n('if', 'x > 0', [n('stmt', 'a = 1')], { elseBody: [n('stmt', 'a = 2')] }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const branch = g.nodes.find((x) => x.kind === 'branch')!;
    expect(branch.label).toBe('x > 0');
    expect(via(g, branch.id, 'true').statements).toEqual(['a = 1']);
    expect(via(g, branch.id, 'false').statements).toEqual(['a = 2']);
  });

  it('keeps a MULTI-statement else arm intact', () => {
    // Regression guard: an earlier design sliced then/else out of one `children`
    // array, silently moving the extra else statements into the THEN arm.
    const fn = n('func', 'f', [
      n('if', 'x > 0', [n('stmt', 'a = 1')], {
        elseBody: [n('stmt', 'b = 1'), n('stmt', 'b = 2'), n('stmt', 'b = 3')],
      }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const branch = g.nodes.find((x) => x.kind === 'branch')!;
    expect(via(g, branch.id, 'true').statements).toEqual(['a = 1']);
    expect(via(g, branch.id, 'false').statements).toEqual(['b = 1', 'b = 2', 'b = 3']);
  });

  it('an if with no else still emits a false edge to the join', () => {
    const fn = n('func', 'f', [
      n('if', 'x > 0', [n('stmt', 'a = 1')]),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const branch = g.nodes.find((x) => x.kind === 'branch')!;
    expect(via(g, branch.id, 'false').statements).toEqual(['after = 1']);
  });

  it('isolates arm ids, so editing one arm cannot re-id the other', () => {
    const elseId = (thenStmts: number) => {
      const fn = n('func', 'f', [
        n('if', 'c', Array.from({ length: thenStmts }, (_, i) => n('stmt', `t${i}`)), {
          elseBody: [n('stmt', 'e0')],
        }),
      ]);
      const g = buildFunctionGraph(fn, 'f()', 'f', []);
      return byStmt(g, 'e0').id;
    };
    expect(elseId(1)).toBe(elseId(4));
  });
});

describe('buildFunctionGraph — loops', () => {
  it('emits a loop-header with a BACK edge from the body', () => {
    const fn = n('func', 'f', [
      n('loop', 'lo <= hi', [n('stmt', 'lo = lo + 1')], { loopKind: 'while' }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('while');
    const back = g.edges.find((e) => e.kind === 'back')!;
    expect(back.target).toBe(header.id);
  });

  it('break exits the loop; continue returns to the header', () => {
    const fn = n('func', 'f', [
      n('loop', 'true', [n('if', 'done', [n('break', 'break')]), n('continue', 'continue')], {
        loopKind: 'while',
      }),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    const brk = g.edges.find((e) => e.kind === 'break')!;
    const cont = g.edges.find((e) => e.kind === 'continue')!;
    expect(g.nodes.find((x) => x.id === brk.target)!.statements).toEqual(['after = 1']);
    expect(cont.target).toBe(header.id);
  });

  it('do-while puts the body BEFORE the header, with exactly one back edge', () => {
    const fn = n('func', 'f', [
      n('loop', 'x < 3', [n('stmt', 'x = x + 1')], { loopKind: 'do-while' }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    const body = byStmt(g, 'x = x + 1');
    expect(g.edges.some((e) => e.source === g.entryId && e.target === body.id)).toBe(true);
    expect(g.edges.some((e) => e.source === body.id && e.target === header.id)).toBe(true);
    // Searching all nodes for the body would find the function ENTRY and emit a
    // bogus header -> entry edge.
    expect(g.edges.filter((e) => e.kind === 'back')).toEqual([
      expect.objectContaining({ source: header.id, target: body.id }),
    ]);
  });

  it('python for/while ELSE runs on exhaustion, not on break', () => {
    const fn = n('func', 'f', [
      n('loop', 'i in xs', [n('stmt', 'body = 1')], {
        loopKind: 'foreach',
        elseBody: [n('stmt', 'ran_to_end = 1')],
      }),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    expect(via(g, header.id, 'false').statements).toEqual(['ran_to_end = 1']);
  });

  it('a break SKIPS the loop-else clause', () => {
    const fn = n('func', 'f', [
      n('loop', 'i in xs', [n('break', 'break')], {
        loopKind: 'foreach',
        elseBody: [n('stmt', 'no_break = 1')],
      }),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const brk = g.edges.find((e) => e.kind === 'break')!;
    expect(g.nodes.find((x) => x.id === brk.target)!.statements).toEqual(['after = 1']);
  });

  it('nested loops keep sibling indices scope-local', () => {
    const fn = n('func', 'f', [
      n('loop', 'outer', [n('loop', 'inner', [n('stmt', 's')], { loopKind: 'while' })], {
        loopKind: 'while',
      }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    expect(byStmt(g, 's').id).toContain('while@0/while@0');
  });
});

describe('buildFunctionGraph — switch (spec §5.1)', () => {
  it('a case WITHOUT break falls through to the next case body', () => {
    const fn = n('func', 'f', [
      n('switch', 'v', [
        n('case', '1', [n('stmt', 'a = 1')], { caseValue: '1' }),
        n('case', '2', [n('stmt', 'b = 2'), n('break', 'break')], { caseValue: '2' }),
      ]),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const one = byStmt(g, 'a = 1');
    const two = byStmt(g, 'b = 2');
    expect(g.edges.some((e) => e.source === one.id && e.target === two.id)).toBe(true);
    expect(g.nodes.some((x) => x.kind === 'switch')).toBe(true);
  });

  it('emits exactly ONE default edge when a default arm exists', () => {
    const fn = n('func', 'f', [
      n('switch', 'v', [
        n('case', '1', [n('stmt', 'a = 1'), n('break', 'break')], { caseValue: '1' }),
        n('case', 'default', [n('stmt', 'd = 1')], { isDefault: true }),
      ]),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    // No phantom "no match" bypass on top of the real default arm.
    expect(g.edges.filter((e) => e.kind === 'default')).toHaveLength(1);
  });

  it('emits a bypass edge when NO default arm exists', () => {
    const fn = n('func', 'f', [
      n('switch', 'v', [
        n('case', '1', [n('stmt', 'a = 1'), n('break', 'break')], { caseValue: '1' }),
      ]),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    expect(g.edges.filter((e) => e.kind === 'default')).toHaveLength(1);
  });

  it('a continue inside a case targets the enclosing LOOP, not the switch', () => {
    const fn = n('func', 'f', [
      n('loop', 'more', [
        n('switch', 'v', [n('case', '1', [n('continue', 'continue')], { caseValue: '1' })]),
      ], { loopKind: 'while' }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    const cont = g.edges.find((e) => e.kind === 'continue')!;
    expect(cont.target).toBe(header.id);
  });
});

describe('buildFunctionGraph — labeled break (spec §5.3)', () => {
  it('a labeled break exits the LABELED loop, not the innermost one', () => {
    const fn = n('func', 'f', [
      n('loop', 'outer cond', [
        n('loop', 'inner cond', [n('break', 'break outer', [], { label: 'outer' })], {
          loopKind: 'while',
        }),
      ], { loopKind: 'while', label: 'outer' }),
      n('stmt', 'after = 1'),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const brk = g.edges.find((e) => e.kind === 'break')!;
    expect(g.nodes.find((x) => x.id === brk.target)!.statements).toEqual(['after = 1']);
  });
});

describe('buildFunctionGraph — returns, throws, finally', () => {
  it('collects multiple returns into exitIds', () => {
    const fn = n('func', 'f', [
      n('if', 'x', [n('return', 'return 1')], { elseBody: [n('return', 'return 2')] }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    expect(g.nodes.filter((x) => x.kind === 'return')).toHaveLength(2);
    expect(g.exitIds.length).toBeGreaterThanOrEqual(2);
  });

  it('finally is reachable from a return inside try (spec §5.4)', () => {
    const fn = n('func', 'f', [
      n('try', 'try', [n('return', 'return 1')], {
        finallyBody: [n('stmt', 'cleanup()')],
      }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const ret = g.nodes.find((x) => x.kind === 'return')!;
    const marker = g.nodes.find((x) => x.label === 'finally')!;
    const cleanup = byStmt(g, 'cleanup()');
    // return -> finally region marker -> the finally body
    expect(g.edges.some((e) => e.source === ret.id && e.target === marker.id)).toBe(true);
    expect(g.edges.some((e) => e.source === marker.id && e.target === cleanup.id)).toBe(true);
  });

  it('keeps control flow INSIDE finally rather than flattening it', () => {
    // Collapsing the body into one node dropped handle.close() and mislabelled
    // the node with the if's condition text.
    const fn = n('func', 'f', [
      n('try', 'try', [n('stmt', 'risky()')], {
        finallyBody: [n('if', 'handle', [n('stmt', 'handle.close()')])],
      }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    expect(g.nodes.some((x) => x.kind === 'branch' && x.label === 'handle')).toBe(true);
    expect(g.nodes.some((x) => x.statements.includes('handle.close()'))).toBe(true);
  });

  it('walks one handler per except clause, and never emits an empty edge source', () => {
    const fn = n('func', 'f', [
      n('try', 'try', [n('stmt', 'risky()')], {
        catchBodies: [
          [n('stmt', 'h1a = 1'), n('stmt', 'h1b = 2')],
          [n('stmt', 'h2a = 1'), n('stmt', 'h2b = 2')],
        ],
      }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    expect(g.edges.filter((e) => e.kind === 'exception')).toHaveLength(2);
    expect(g.edges.every((e) => e.source !== '' && e.target !== '')).toBe(true);
  });

  it('adding a finally clause does not renumber the try body blocks', () => {
    const bodyId = (withFinally: boolean) => {
      const fn = n('func', 'f', [
        n(
          'try',
          'try',
          [n('stmt', 'risky()')],
          withFinally ? { finallyBody: [n('stmt', 'cleanup()')] } : undefined,
        ),
      ]);
      const g = buildFunctionGraph(fn, 'f()', 'f', []);
      return byStmt(g, 'risky()').id;
    };
    expect(bodyId(false)).toBe(bodyId(true));
  });

  it('a throw is an exit', () => {
    const g = buildFunctionGraph(
      n('func', 'f', [n('throw', 'raise ValueError()')]),
      'f()',
      'f',
      [],
    );
    const thrown = g.nodes.find((x) => x.kind === 'throw')!;
    expect(g.exitIds).toContain(thrown.id);
  });
});

describe('buildFunctionGraph — unreachable code', () => {
  it('tags code after a return, with no incoming edge', () => {
    const fn = n('func', 'f', [n('return', 'return x'), n('stmt', 'print(x)')]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const dead = byStmt(g, 'print(x)');
    expect(dead.meta?.unsupported).toBe('unreachable');
    expect(g.edges.some((e) => e.target === dead.id)).toBe(false);
  });

  it('leaves reachable code untagged', () => {
    const fn = n('func', 'f', [n('stmt', 'a = 1'), n('return', 'return a')]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    expect(byStmt(g, 'a = 1').meta?.unsupported).toBeUndefined();
  });
});

describe('buildFunctionGraph — determinism', () => {
  it('produces identical output for identical input', () => {
    const make = () =>
      n('func', 'f', [
        n('loop', 'c', [n('if', 'd', [n('stmt', 's')])], { loopKind: 'while' }),
      ]);
    const a = buildFunctionGraph(make(), 'f()', 'f', []);
    const b = buildFunctionGraph(make(), 'f()', 'f', []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('emits no duplicate node ids', () => {
    const fn = n('func', 'f', [
      n('if', 'a', [n('stmt', 's1')], { elseBody: [n('stmt', 's2')] }),
      n('if', 'b', [n('stmt', 's3')], { elseBody: [n('stmt', 's4')] }),
      n('loop', 'c', [n('stmt', 's5')], { loopKind: 'while' }),
    ]);
    const g = buildFunctionGraph(fn, 'f()', 'f', []);
    const ids = g.nodes.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildProgramIR — call edges', () => {
  const fnDef = (name: string, body: SynNode[]) => ({
    node: n('func', name, body),
    id: `${name}()`,
    name,
    params: [] as string[],
  });

  it('links a call to the function it names', () => {
    const ir = buildProgramIR(
      [fnDef('helper', [n('return', 'return x')]), fnDef('main', [n('stmt', 'helper(1)')])],
      'python',
      [],
    );
    expect(ir.callEdges.some((c) => c.from === 'main()' && c.to === 'helper()')).toBe(true);
  });

  it('KEEPS self-calls — recursion is the hero feature, not noise', () => {
    const ir = buildProgramIR([fnDef('fib', [n('stmt', 'fib(n - 1)')])], 'python', []);
    expect(ir.callEdges.some((c) => c.from === 'fib()' && c.to === 'fib()')).toBe(true);
  });

  it('sees MULTIPLE calls in one statement', () => {
    const ir = buildProgramIR(
      [
        fnDef('a', [n('stmt', 'return 1')]),
        fnDef('b', [n('stmt', 'return 2')]),
        fnDef('main', [n('stmt', 'a() + b()')]),
      ],
      'python',
      [],
    );
    const targets = ir.callEdges.filter((c) => c.from === 'main()').map((c) => c.to).sort();
    expect(targets).toEqual(['a()', 'b()']);
  });

  it('refuses to guess when a name is ambiguous', () => {
    const ir = buildProgramIR(
      [
        { node: n('func', 'push', []), id: 'Stack.push(x)', name: 'push', params: ['x'] },
        { node: n('func', 'push', []), id: 'Queue.push(x)', name: 'push', params: ['x'] },
        fnDef('main', [n('stmt', 'push(1)')]),
      ],
      'python',
      [],
    );
    expect(ir.callEdges.filter((c) => c.from === 'main()')).toHaveLength(0);
  });

  it('carries language, diagnostics, and irVersion through', () => {
    const ir = buildProgramIR([fnDef('f', [n('stmt', 'x = 1')])], 'cpp', [
      { severity: 'error', message: 'boom', span: { startLine: 2, endLine: 2 } },
    ]);
    expect(ir.language).toBe('cpp');
    expect(ir.diagnostics).toHaveLength(1);
    expect(ir.irVersion).toBe(1);
  });
});
