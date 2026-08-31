// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm.
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../parse';

const jv = (source: string) => parseToIR(source, 'java', { baseUrl: 'public' });

describe('java adapter — declarations', () => {
  it('finds a method with typed params', async () => {
    const ir = await jv('class T {\n  int add(int a, int b) { return a + b; }\n}\n');
    expect(ir.functions).toHaveLength(1);
    expect(ir.functions[0].name).toBe('add');
    expect(ir.functions[0].params).toEqual(['int a', 'int b']);
  });

  it('methods are qualified by their class, so two classes may share a name', async () => {
    const ir = await jv(
      'class A { int f() { return 1; } }\nclass B { int f() { return 2; } }\n',
    );
    const ids = ir.functions.map((f) => f.id);
    expect(ids).toEqual(['A.f()', 'B.f()']);
  });

  it('gives overloads distinct ids', async () => {
    const ir = await jv(
      'class T {\n  int f(int a) { return a; }\n  double f(double a) { return a; }\n}\n',
    );
    expect(ir.functions.map((f) => f.id)).toEqual(['T.f(int)', 'T.f(double)']);
  });

  it('static and instance methods both appear', async () => {
    const ir = await jv(
      'class T {\n  static int s() { return 1; }\n  int i() { return 2; }\n}\n',
    );
    expect(ir.functions.map((f) => f.name)).toEqual(['s', 'i']);
  });

  it('includes a constructor', async () => {
    const ir = await jv('class T {\n  T(int a) { this.a = a; }\n}\n');
    expect(ir.functions.map((f) => f.name)).toContain('T');
  });

  it('skips an abstract method, which has no body to draw', async () => {
    const ir = await jv(
      'abstract class T {\n  abstract int nope(int a);\n  int yes(int a) { return a; }\n}\n',
    );
    expect(ir.functions.map((f) => f.name)).toEqual(['yes']);
  });
});

describe('java adapter — the hard constructs (spec §5)', () => {
  it('LABELED BREAK exits the labelled loop, not the innermost (spec §5.3)', async () => {
    const ir = await jv(
      'class T {\n' +
        '  int f(int[][] g) {\n' +
        '    int found = -1;\n' +
        '    outer:\n' +
        '    for (int i = 0; i < g.length; i++) {\n' +
        '      for (int j = 0; j < g[i].length; j++) {\n' +
        '        if (g[i][j] == 0) { found = i; break outer; }\n' +
        '      }\n' +
        '    }\n' +
        '    return found;\n' +
        '  }\n}\n',
    );
    const g = ir.functions[0];
    const brk = g.edges.find((e) => e.kind === 'break')!;
    const target = g.nodes.find((n) => n.id === brk.target)!;
    // Must land AFTER the outer loop — the classic bug lands after the inner one.
    expect(target.statements.some((s) => s.includes('return found'))).toBe(true);
  });

  it('labeled continue targets the labelled loop header', async () => {
    const ir = await jv(
      'class T {\n  void f() {\n    outer:\n    for (int i = 0; i < 3; i++) {\n' +
        '      for (int j = 0; j < 3; j++) { if (j == 1) continue outer; }\n' +
        '    }\n  }\n}\n',
    );
    const g = ir.functions[0];
    const cont = g.edges.find((e) => e.kind === 'continue')!;
    const headers = g.nodes.filter((n) => n.kind === 'loop-header');
    // The OUTER header, which is the first one emitted.
    expect(cont.target).toBe(headers[0].id);
  });

  it('an UNLABELED break in a nested loop still exits only the inner one', async () => {
    const ir = await jv(
      'class T {\n  int f() {\n    int n = 0;\n' +
        '    for (int i = 0; i < 3; i++) {\n' +
        '      for (int j = 0; j < 3; j++) { if (j == 1) break; n++; }\n' +
        '    }\n    return n;\n  }\n}\n',
    );
    const g = ir.functions[0];
    const headers = g.nodes.filter((n) => n.kind === 'loop-header');
    const brk = g.nodes.find((n) => n.statements.includes('break'))!;
    const out = g.edges.filter((e) => e.source === brk.id);
    // Leaving the INNER loop lands on the OUTER header, never on the return: the
    // inner loop is the last statement in the outer body, so continuing past it is
    // the outer loop's next iteration. The edge is therefore `back` rather than
    // `break` — the break's own kind survives in the label.
    expect(out).toHaveLength(1);
    expect(out[0].target).toBe(headers[0].id);
    expect(out[0].label).toContain('break');
    // The classic bug: skipping straight to the return, exiting both loops.
    const ret = g.nodes.find((n) => n.kind === 'return')!;
    expect(out[0].target).not.toBe(ret.id);
  });

  it('switch fallthrough behaves like C++', async () => {
    const ir = await jv(
      'class T {\n  int f(int v) {\n    int r = 0;\n' +
        '    switch (v) {\n' +
        '      case 1: r = 1;\n' +
        '      case 2: r = 2; break;\n' +
        '      default: r = 9;\n' +
        '    }\n    return r;\n  }\n}\n',
    );
    const g = ir.functions[0];
    const one = g.nodes.find((n) => n.statements.some((s) => s.includes('r = 1')))!;
    const two = g.nodes.find((n) => n.statements.some((s) => s.includes('r = 2')))!;
    expect(g.edges.some((e) => e.source === one.id && e.target === two.id)).toBe(true);
    expect(g.edges.filter((e) => e.kind === 'default')).toHaveLength(1);
  });

  it('reads the switch discriminant without its parentheses', async () => {
    const ir = await jv(
      'class T {\n  int f(int v) {\n    switch (v) { default: return 0; }\n  }\n}\n',
    );
    const sw = ir.functions[0].nodes.find((n) => n.kind === 'switch')!;
    expect(sw.label).toBe('v');
  });

  it('an ARROW switch does NOT fall through (Java 14+)', async () => {
    const ir = await jv(
      'class T {\n  int f(int v) {\n    int r = 0;\n' +
        '    switch (v) {\n' +
        '      case 1 -> r = 1;\n' +
        '      case 2 -> r = 2;\n' +
        '      default -> r = 9;\n' +
        '    }\n    return r;\n  }\n}\n',
    );
    const g = ir.functions[0];
    const one = g.nodes.find((n) => n.statements.some((s) => s.includes('r = 1')))!;
    const two = g.nodes.find((n) => n.statements.some((s) => s.includes('r = 2')))!;
    // The colon form would emit this edge. The arrow form must not.
    expect(g.edges.some((e) => e.source === one.id && e.target === two.id)).toBe(false);
    // Each arm instead rejoins after the switch.
    const ret = g.nodes.find((n) => n.kind === 'return')!;
    expect(g.edges.some((e) => e.source === one.id && e.target === ret.id)).toBe(true);
    expect(g.edges.some((e) => e.source === two.id && e.target === ret.id)).toBe(true);
    // And no phantom `break` node appears: there is no break in the source.
    expect(g.nodes.some((n) => n.statements.includes('break'))).toBe(false);
  });

  it('consecutive case labels share one body by falling through an empty arm', async () => {
    const ir = await jv(
      'class T {\n  int f(int v) {\n' +
        '    switch (v) {\n      case 1:\n      case 2: return 1;\n      default: return 0;\n    }\n  }\n}\n',
    );
    const g = ir.functions[0];
    const sw = g.nodes.find((n) => n.kind === 'switch')!;
    // Both labels are reachable from the discriminant.
    expect(g.edges.filter((e) => e.source === sw.id && e.kind === 'case')).toHaveLength(2);
  });

  it('enhanced for normalizes to foreach', async () => {
    const ir = await jv(
      'class T {\n  int f(int[] xs) {\n    int s = 0;\n    for (int x : xs) s += x;\n    return s;\n  }\n}\n',
    );
    const header = ir.functions[0].nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('foreach');
    expect(header.label).toBe('x in xs');
  });

  it('classic for is a loop with a back edge', async () => {
    const ir = await jv(
      'class T {\n  int f(int n) {\n    int s = 0;\n    for (int i = 0; i < n; i++) s += i;\n    return s;\n  }\n}\n',
    );
    const g = ir.functions[0];
    const header = g.nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('for');
    expect(g.edges.some((e) => e.kind === 'back')).toBe(true);
  });

  it('while and do-while are distinguished', async () => {
    const ir = await jv(
      'class T {\n  void f(int x) {\n    while (x > 0) { x--; }\n    do { x++; } while (x < 3);\n  }\n}\n',
    );
    const kinds = ir.functions[0].nodes
      .filter((n) => n.kind === 'loop-header')
      .map((n) => n.meta?.loopKind);
    expect(kinds).toEqual(['while', 'do-while']);
  });

  it('try/catch/finally: finally is reachable from a return inside try', async () => {
    const ir = await jv(
      'class T {\n  int f() {\n' +
        '    try { return g(); }\n' +
        '    catch (Exception e) { return -1; }\n' +
        '    finally { h(); }\n  }\n}\n',
    );
    const g = ir.functions[0];
    const fin = g.nodes.find((n) => n.label === 'finally')!;
    expect(fin).toBeDefined();
    const ret = g.nodes.find((n) => n.statements.some((s) => s.includes('return g()')))!;
    // A return inside try must still run finally (spec §5.4).
    expect(g.edges.some((e) => e.source === ret.id && e.target === fin.id)).toBe(true);
    expect(g.edges.some((e) => e.kind === 'exception')).toBe(true);
  });

  it('try-with-resources is still a try', async () => {
    const ir = await jv(
      'class T {\n  void f() {\n    try (var s = open()) { g(s); }\n    catch (Exception e) { h(); }\n  }\n}\n',
    );
    const g = ir.functions[0];
    expect(g.edges.some((e) => e.kind === 'exception')).toBe(true);
    // The resource is real work that runs on entry, so it must appear.
    expect(g.nodes.some((n) => n.statements.some((s) => s.includes('var s = open()')))).toBe(
      true,
    );
  });

  it('keeps one arm per catch clause', async () => {
    const ir = await jv(
      'class T {\n  void f() {\n    try { g(); }\n' +
        '    catch (IllegalStateException e) { a(); }\n' +
        '    catch (Exception e) { b(); }\n  }\n}\n',
    );
    expect(ir.functions[0].edges.filter((e) => e.kind === 'exception')).toHaveLength(2);
  });

  it('throw is an exit', async () => {
    const ir = await jv(
      'class T {\n  int f(int x) {\n    if (x < 0) throw new IllegalArgumentException("neg");\n    return x;\n  }\n}\n',
    );
    const g = ir.functions[0];
    expect(g.nodes.some((n) => n.kind === 'throw')).toBe(true);
    expect(g.exitIds.length).toBeGreaterThanOrEqual(2);
  });

  it('collects multiple returns', async () => {
    const ir = await jv('class T {\n  int f(int x) {\n    if (x > 0) return 1;\n    return 2;\n  }\n}\n');
    expect(ir.functions[0].exitIds.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a multi-statement else arm in the else arm', async () => {
    const ir = await jv(
      'class T {\n  int f(int x) {\n    int a = 0;\n' +
        '    if (x > 0) { a = 1; }\n' +
        '    else { a = 2; a = a + 1; a = a * 2; }\n    return a;\n  }\n}\n',
    );
    const g = ir.functions[0];
    const branch = g.nodes.find((n) => n.kind === 'branch')!;
    const falseEdge = g.edges.find((e) => e.source === branch.id && e.kind === 'false')!;
    const arm = g.nodes.find((n) => n.id === falseEdge.target)!;
    expect(arm.statements).toHaveLength(3);
  });

  it('folds an else-if chain into a nested else arm', async () => {
    const ir = await jv(
      'class T {\n  int f(int x) {\n' +
        '    if (x == 1) return 1;\n' +
        '    else if (x == 2) return 2;\n' +
        '    else return 3;\n  }\n}\n',
    );
    const g = ir.functions[0];
    expect(g.nodes.filter((n) => n.kind === 'branch')).toHaveLength(2);
    expect(g.nodes.filter((n) => n.kind === 'return')).toHaveLength(3);
  });

  it('a syntax error still yields diagnostics plus partial IR', async () => {
    const ir = await jv('class T {\n  int f( {\n    return 1;\n  }\n}\n');
    expect(ir.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('finds recursion as a call edge to itself', async () => {
    const ir = await jv(
      'class T {\n  int fib(int n) {\n    if (n < 2) return n;\n    return fib(n - 1) + fib(n - 2);\n  }\n}\n',
    );
    expect(ir.callEdges.some((c) => c.from === c.to)).toBe(true);
  });
});
