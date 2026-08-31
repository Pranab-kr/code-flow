// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm; jsdom has none.
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../parse';

const py = (source: string) => parseToIR(source, 'python', { baseUrl: 'public' });

describe('python adapter', () => {
  it('finds a function with its params', async () => {
    const ir = await py('def binary_search(arr, target):\n    return -1\n');
    expect(ir.functions).toHaveLength(1);
    expect(ir.functions[0].name).toBe('binary_search');
    expect(ir.functions[0].params).toEqual(['arr', 'target']);
  });

  it('builds a loop with a back edge for a while', async () => {
    const ir = await py('def f(n):\n    i = 0\n    while i < n:\n        i += 1\n    return i\n');
    const g = ir.functions[0];
    expect(g.nodes.some((x) => x.kind === 'loop-header')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'back')).toBe(true);
  });

  it('distinguishes elif as a nested branch', async () => {
    const ir = await py(
      'def f(x):\n' +
        '    if x > 0:\n        return 1\n' +
        '    elif x < 0:\n        return -1\n' +
        '    else:\n        return 0\n',
    );
    const g = ir.functions[0];
    expect(g.nodes.filter((x) => x.kind === 'branch')).toHaveLength(2);
    expect(g.nodes.filter((x) => x.kind === 'return')).toHaveLength(3);
  });

  it('keeps every clause of a LONG elif chain', async () => {
    // Regression guard: spreading a tree-sitter node dropped all clauses after
    // the first elif, silently and with no error.
    const ir = await py(
      'def f(x):\n' +
        '    if x == 1:\n        return 1\n' +
        '    elif x == 2:\n        return 2\n' +
        '    elif x == 3:\n        return 3\n' +
        '    elif x == 4:\n        return 4\n' +
        '    else:\n        return 0\n',
    );
    const g = ir.functions[0];
    expect(g.nodes.filter((x) => x.kind === 'branch')).toHaveLength(4);
    expect(g.nodes.filter((x) => x.kind === 'return')).toHaveLength(5);
  });

  it('keeps a multi-statement else arm in the ELSE arm', async () => {
    const ir = await py(
      'def f(x):\n' +
        '    if x:\n        a = 1\n' +
        '    else:\n        b = 1\n        c = 2\n        d = 3\n',
    );
    const g = ir.functions[0];
    const branch = g.nodes.find((x) => x.kind === 'branch')!;
    const falseEdge = g.edges.find((e) => e.source === branch.id && e.kind === 'false')!;
    const elseBlock = g.nodes.find((x) => x.id === falseEdge.target)!;
    expect(elseBlock.statements).toEqual(['b = 1', 'c = 2', 'd = 3']);
  });

  it('handles for/else exhaustion', async () => {
    const ir = await py(
      'def f(xs):\n' +
        '    for x in xs:\n        if x:\n            break\n' +
        "    else:\n        return 'none'\n" +
        "    return 'found'\n",
    );
    const g = ir.functions[0];
    const header = g.nodes.find((x) => x.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('foreach');
    expect(g.edges.some((e) => e.kind === 'break')).toBe(true);
  });

  it('records a diagnostic for a syntax error but still returns IR', async () => {
    const ir = await py('def f(:\n    return 1\n');
    expect(ir.diagnostics.length).toBeGreaterThan(0);
    expect(ir.diagnostics[0].severity).toBe('error');
    // degrade, never blank (spec §11)
    expect(ir).toHaveProperty('functions');
  });

  it('emits a call edge between two functions', async () => {
    const ir = await py('def helper(x):\n    return x\n\ndef main():\n    return helper(1)\n');
    expect(ir.callEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('emits a self call edge for recursion', async () => {
    const ir = await py('def fib(n):\n    if n < 2:\n        return n\n    return fib(n-1) + fib(n-2)\n');
    expect(ir.callEdges.some((c) => c.from === c.to)).toBe(true);
  });

  it('reports 1-based spans that match the source lines', async () => {
    const ir = await py('def f(n):\n    a = 1\n    return a\n');
    const g = ir.functions[0];
    const block = g.nodes.find((x) => x.statements[0] === 'a = 1')!;
    expect(block.span.startLine).toBe(2);
    const ret = g.nodes.find((x) => x.kind === 'return')!;
    expect(ret.span.startLine).toBe(3);
  });

  it('normalizes try/except/finally', async () => {
    const ir = await py(
      'def f():\n' +
        '    try:\n        risky()\n' +
        '    except ValueError:\n        handle()\n' +
        '    finally:\n        cleanup()\n',
    );
    const g = ir.functions[0];
    expect(g.edges.some((e) => e.kind === 'exception')).toBe(true);
    expect(g.nodes.some((x) => x.statements.includes('cleanup()'))).toBe(true);
  });

  it('parses match/case with a wildcard default', async () => {
    const ir = await py(
      'def f(v):\n' +
        '    match v:\n' +
        '        case 1:\n            return "one"\n' +
        '        case _:\n            return "other"\n',
    );
    const g = ir.functions[0];
    expect(g.nodes.some((x) => x.kind === 'switch')).toBe(true);
    // A '_' pattern is the default arm, so no phantom "no match" bypass.
    expect(g.edges.filter((e) => e.kind === 'default')).toHaveLength(1);
  });

  it('is deterministic across repeated parses', async () => {
    const src = 'def f(n):\n    while n:\n        n -= 1\n    return n\n';
    const a = await py(src);
    const b = await py(src);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns an empty function list for source with no functions', async () => {
    const ir = await py('x = 1\ny = 2\n');
    expect(ir.functions).toEqual([]);
    expect(ir.language).toBe('python');
  });
});
