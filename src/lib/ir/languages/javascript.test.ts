// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm.
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../parse';

const js = (source: string) => parseToIR(source, 'javascript', { baseUrl: 'public' });

describe('javascript grammar loader probe (spec §3)', () => {
  it('loads the grammar and builds a tree instead of throwing', async () => {
    const ir = await js('function add(a, b) {\n  return a + b;\n}\n');
    expect(ir.language).toBe('javascript');
    expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('javascript adapter — function identity (spec §6)', () => {
  it('finds a function declaration with param names', async () => {
    const ir = await js('function add(a, b) {\n  return a + b;\n}\n');
    expect(ir.functions).toHaveLength(1);
    expect(ir.functions[0].name).toBe('add');
    expect(ir.functions[0].id).toBe('add(a,b)');
  });

  it('assigned arrows share the declaration id (spec §6 identity rule)', async () => {
    const decl = await js('function binarySearch(arr, target) {\n  return 1;\n}\n');
    const arrow = await js('const binarySearch = (arr, target) => {\n  return 1;\n}\n');
    expect(arrow.functions.map((f) => f.id)).toEqual(decl.functions.map((f) => f.id));
  });

  it('qualifies class methods so two classes may share a name', async () => {
    const ir = await js(
      'class A {\n  search(x) {\n    return x;\n  }\n}\nclass B {\n  search(x) {\n    return x;\n  }\n}\n',
    );
    expect(ir.functions.map((f) => f.id)).toEqual(['A.search(x)', 'B.search(x)']);
  });

  it('skips getters, setters, and object-literal methods (spec §10 gap)', async () => {
    const ir = await js(
      'class T {\n  get x() {\n    return 1;\n  }\n  set x(v) {}\n  real() {\n    return 2;\n  }\n}\nconst o = {\n  m() {\n    return 3;\n  },\n};\n',
    );
    expect(ir.functions.map((f) => f.name)).toEqual(['real']);
  });

  it('folds an anonymous inline callback into the enclosing block', async () => {
    const ir = await js(
      'function f(items) {\n  items.forEach((x) => {\n    console.log(x);\n  });\n  return 0;\n}\n',
    );
    expect(ir.functions).toHaveLength(1);
    expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('javascript adapter — branches and loops (spec §5)', () => {
  it('chains else-if without special-casing', async () => {
    const ir = await js(
      'function f(x) {\n  if (x === 1) {\n    return 1;\n  } else if (x === 2) {\n    return 2;\n  } else {\n    return 3;\n  }\n}\n',
    );
    const kinds = ir.functions[0].nodes.map((n) => n.kind);
    expect(kinds.filter((k) => k === 'branch')).toHaveLength(2);
  });

  it('keeps ternaries inline (basic-blocks policy)', async () => {
    const ir = await js('function f(c) {\n  const x = c ? 1 : 2;\n  return x;\n}\n');
    expect(ir.functions[0].nodes.some((n) => n.kind === 'branch')).toBe(false);
  });

  it('maps all five loop forms to the right loopKind', async () => {
    const cases: [string, string][] = [
      ['function f(a) {\n  while (a) {\n    a--;\n  }\n}\n', 'while'],
      ['function f(a) {\n  do {\n    a--;\n  } while (a > 0);\n}\n', 'do-while'],
      ['function f(n) {\n  for (let i = 0; i < n; i++) {\n  }\n}\n', 'for'],
      ['function f(arr) {\n  for (const x of arr) {\n  }\n}\n', 'foreach'],
      ['function f(o) {\n  for (const k in o) {\n  }\n}\n', 'foreach'],
    ];
    for (const [src, kind] of cases) {
      const ir = await js(src);
      const header = ir.functions[0].nodes.find((n) => n.kind === 'loop-header');
      expect(header?.meta?.loopKind, src).toBe(kind);
    }
  });

  it('an async function renders as plain blocks (no execution semantics)', async () => {
    const ir = await js('async function f(url) {\n  const r = await fetch(url);\n  return r;\n}\n');
    expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(ir.functions).toHaveLength(1);
    // The await folds into its block's statements — present, not dropped, no edge.
    const text = ir.functions[0].nodes.flatMap((n) => n.statements).join('\n');
    expect(text).toContain('fetch(url)');
  });
});

describe('javascript adapter — switch, jumps, try (spec §5)', () => {
  it('renders classic fallthrough and stops at break', async () => {
    const ir = await js(
      'function f(x) {\n  switch (x) {\n    case 0:\n    case 1:\n      x += 2;\n      break;\n    default:\n      x = -1;\n  }\n  return x;\n}\n',
    );
    const g = ir.functions[0];
    expect(g.nodes.some((n) => n.kind === 'switch')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'break')).toBe(true);
  });

  it('LABELED BREAK exits the labelled loop, not the innermost', async () => {
    const ir = await js(
      'function f(g) {\n  let found = -1;\n  outer:\n  for (let i = 0; i < g.length; i++) {\n    for (let j = 0; j < g[i].length; j++) {\n      if (g[i][j] === 0) {\n        found = i;\n        break outer;\n      }\n    }\n  }\n  return found;\n}\n',
    );
    const g = ir.functions[0];
    const brk = g.edges.find((e) => e.kind === 'break')!;
    const target = g.nodes.find((n) => n.id === brk.target)!;
    expect(target.statements.some((s) => s.includes('return found'))).toBe(true);
  });

  it('labeled continue targets the labelled loop header', async () => {
    const ir = await js(
      'function f() {\n  outer:\n  for (let i = 0; i < 3; i++) {\n    for (let j = 0; j < 3; j++) {\n      if (j === 1) continue outer;\n    }\n  }\n}\n',
    );
    const g = ir.functions[0];
    expect(g.edges.some((e) => e.kind === 'continue')).toBe(true);
  });

  it('maps try/catch/finally onto the existing try support', async () => {
    const ir = await js(
      'function f() {\n  try {\n    risky();\n  } catch (e) {\n    other(e);\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\n',
    );
    expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(ir.functions[0].edges.some((e) => e.kind === 'exception')).toBe(true);
  });

  it('reports TypeScript annotations as errors, never a clean diagram', async () => {
    const ir = await js('function add(a: number, b: number): number {\n  return a + b;\n}\n');
    expect(ir.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
