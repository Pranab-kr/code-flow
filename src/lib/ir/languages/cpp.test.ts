// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm.
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../parse';

const cc = (source: string) => parseToIR(source, 'cpp', { baseUrl: 'public' });

describe('cpp adapter — functions', () => {
  it('finds a free function with typed params', async () => {
    const ir = await cc('int add(int a, int b) {\n  return a + b;\n}\n');
    expect(ir.functions).toHaveLength(1);
    expect(ir.functions[0].name).toBe('add');
    // Params carry TYPES: overloads must produce distinct function ids.
    expect(ir.functions[0].params).toEqual(['int a', 'int b']);
  });

  it('gives overloads distinct ids', async () => {
    const ir = await cc('int f(int a) { return a; }\ndouble f(double a) { return a; }\n');
    const ids = ir.functions.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(['f(int)', 'f(double)']);
  });

  it('qualifies a method with its class', async () => {
    const ir = await cc('struct Stack {\n  void push(int x) { data_ = x; }\n  int data_;\n};\n');
    expect(ir.functions[0].id).toContain('Stack');
  });

  it('qualifies an out-of-line definition by its scope', async () => {
    const ir = await cc('void Stack::push(int x) {\n  data_ = x;\n}\n');
    expect(ir.functions[0].name).toBe('push');
    expect(ir.functions[0].id).toBe('Stack.push(int)');
  });

  it('finds a template function', async () => {
    const ir = await cc(
      'template <typename T>\nT maxOf(T a, T b) {\n  return a > b ? a : b;\n}\n',
    );
    expect(ir.functions.map((f) => f.name)).toContain('maxOf');
  });

  it('skips a prototype, which has no body to draw', async () => {
    const ir = await cc('int declared(int a);\nint defined(int a) { return a; }\n');
    expect(ir.functions.map((f) => f.name)).toEqual(['defined']);
  });
});

describe('cpp adapter — the hard constructs (spec §5)', () => {
  it('switch FALLTHROUGH: a case without break flows into the next', async () => {
    const ir = await cc(
      'int f(int v) {\n' +
        '  int r = 0;\n' +
        '  switch (v) {\n' +
        '    case 1: r = 1;\n' + // no break: falls through
        '    case 2: r = 2; break;\n' +
        '    default: r = 9;\n' +
        '  }\n  return r;\n}\n',
    );
    const g = ir.functions[0];
    const one = g.nodes.find((n) => n.statements.some((s) => s.includes('r = 1')))!;
    const two = g.nodes.find((n) => n.statements.some((s) => s.includes('r = 2')))!;
    expect(g.edges.some((e) => e.source === one.id && e.target === two.id)).toBe(true);
    // An explicit default means no phantom "no match" bypass edge.
    expect(g.edges.filter((e) => e.kind === 'default')).toHaveLength(1);
  });

  it('reads the switch discriminant without its parentheses', async () => {
    const ir = await cc('int f(int v) {\n  switch (v) {\n    default: return 0;\n  }\n}\n');
    const sw = ir.functions[0].nodes.find((n) => n.kind === 'switch')!;
    expect(sw.label).toBe('v');
  });

  it('GOTO jumps to its label instead of falling through', async () => {
    const ir = await cc(
      'int f(int n) {\n' +
        '  int i = 0;\n' +
        'top:\n  i++;\n' +
        '  if (i < n) goto top;\n' +
        '  return i;\n}\n',
    );
    const g = ir.functions[0];
    const goto_ = g.nodes.find((n) => n.statements.some((s) => s.includes('goto top')))!;
    expect(goto_).toBeDefined();

    // The jump is a real edge to the LABELLED statement, and because the label is
    // behind it, the edge is a back edge — that cycle is the whole point.
    const jump = g.edges.find((e) => e.source === goto_.id)!;
    expect(jump.kind).toBe('back');
    const target = g.nodes.find((n) => n.id === jump.target)!;
    expect(target.statements.some((s) => s.includes('i++'))).toBe(true);

    // A goto NEVER falls through: its only outgoing edge is the jump.
    expect(g.edges.filter((e) => e.source === goto_.id)).toHaveLength(1);
  });

  it('resolves a FORWARD goto, which is not a cycle', async () => {
    const ir = await cc(
      'int f(int x) {\n' +
        '  if (x < 0) goto done;\n' +
        '  x = x * 2;\n' +
        'done:\n  return x;\n}\n',
    );
    const g = ir.functions[0];
    const goto_ = g.nodes.find((n) => n.statements.some((s) => s.includes('goto done')))!;
    const jump = g.edges.find((e) => e.source === goto_.id)!;
    expect(jump.kind).toBe('seq');
    const target = g.nodes.find((n) => n.id === jump.target)!;
    expect(target.statements.some((s) => s.includes('return x'))).toBe(true);
  });

  it('do-while runs the body before the condition', async () => {
    const ir = await cc('void f() {\n  int x = 0;\n  do { x++; } while (x < 3);\n}\n');
    const g = ir.functions[0];
    const header = g.nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('do-while');
    expect(header.label).toBe('x < 3');
    expect(g.edges.filter((e) => e.kind === 'back')).toHaveLength(1);
  });

  it('range-for normalizes to foreach', async () => {
    const ir = await cc(
      'int f(const std::vector<int>& xs) {\n  int s = 0;\n  for (int x : xs) s += x;\n  return s;\n}\n',
    );
    const header = ir.functions[0].nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('foreach');
    expect(header.label).toBe('x in xs');
  });

  it('classic three-part for is a loop with a back edge', async () => {
    const ir = await cc(
      'int f(int n) {\n  int s = 0;\n  for (int i = 0; i < n; i++) s += i;\n  return s;\n}\n',
    );
    const g = ir.functions[0];
    const header = g.nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('for');
    expect(g.edges.some((e) => e.kind === 'back')).toBe(true);
  });

  it('while reads its condition without parentheses', async () => {
    const ir = await cc('void f(int n) {\n  while (n > 0) { n--; }\n}\n');
    const header = ir.functions[0].nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.label).toBe('n > 0');
    expect(header.meta?.loopKind).toBe('while');
  });

  it('try/catch/throw produce exception edges', async () => {
    const ir = await cc(
      'int f(int x) {\n' +
        '  try {\n    if (x < 0) throw std::runtime_error("neg");\n    return x;\n' +
        '  } catch (const std::exception& e) {\n    return -1;\n  }\n}\n',
    );
    const g = ir.functions[0];
    expect(g.edges.some((e) => e.kind === 'exception')).toBe(true);
    expect(g.nodes.some((n) => n.kind === 'throw')).toBe(true);
  });

  it('keeps one arm per catch clause', async () => {
    const ir = await cc(
      'void f() {\n  try { g(); }\n  catch (int e) { a(); }\n  catch (...) { b(); }\n}\n',
    );
    const g = ir.functions[0];
    // Two handlers, so two exception edges — never one flattened arm.
    expect(g.edges.filter((e) => e.kind === 'exception')).toHaveLength(2);
  });

  it('collects multiple returns', async () => {
    const ir = await cc('int f(int x) {\n  if (x) return 1;\n  return 2;\n}\n');
    expect(ir.functions[0].exitIds.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a multi-statement else arm in the else arm', async () => {
    const ir = await cc(
      'int f(int x) {\n  int a = 0;\n' +
        '  if (x) { a = 1; }\n' +
        '  else { a = 2; a = a + 1; a = a * 2; }\n  return a;\n}\n',
    );
    const g = ir.functions[0];
    const branch = g.nodes.find((n) => n.kind === 'branch')!;
    const falseEdge = g.edges.find((e) => e.source === branch.id && e.kind === 'false')!;
    const arm = g.nodes.find((n) => n.id === falseEdge.target)!;
    expect(arm.statements).toHaveLength(3);
  });

  it('folds an else-if chain into a nested else arm', async () => {
    const ir = await cc(
      'int f(int x) {\n' +
        '  if (x == 1) return 1;\n' +
        '  else if (x == 2) return 2;\n' +
        '  else return 3;\n}\n',
    );
    const g = ir.functions[0];
    expect(g.nodes.filter((n) => n.kind === 'branch')).toHaveLength(2);
    expect(g.nodes.filter((n) => n.kind === 'return')).toHaveLength(3);
  });

  it('binds break to the switch and continue to the enclosing loop', async () => {
    const ir = await cc(
      'void f(int n) {\n' +
        '  for (int i = 0; i < n; i++) {\n' +
        '    switch (i) {\n' +
        '      case 0: continue;\n' +
        '      default: break;\n' +
        '    }\n' +
        '    g(i);\n' +
        '  }\n}\n',
    );
    const g = ir.functions[0];
    const header = g.nodes.find((n) => n.kind === 'loop-header')!;
    const cont = g.edges.find((e) => e.kind === 'continue')!;
    // `continue` inside a switch inside a loop targets the LOOP, not the discriminant.
    expect(cont.target).toBe(header.id);
  });

  it('records a diagnostic for a syntax error but still returns IR', async () => {
    const ir = await cc('int f( {\n  return 1;\n}\n');
    expect(ir.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('finds recursion as a call edge to itself', async () => {
    const ir = await cc('int fib(int n) {\n  if (n < 2) return n;\n  return fib(n - 1) + fib(n - 2);\n}\n');
    expect(ir.callEdges.some((c) => c.from === c.to)).toBe(true);
  });
});
