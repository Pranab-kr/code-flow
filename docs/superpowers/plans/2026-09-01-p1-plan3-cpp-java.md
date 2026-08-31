# code-flow P1 — Plan 3: C++ and Java adapters

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Binary search written in C++, Java, or Python produces the same graph shape, and the language picker stops lying.

**Architecture:** Two new adapters under `src/lib/ir/languages/`, each normalizing its tree-sitter grammar into the existing `SynNode`. **The builder does not change.** If it needs to, the abstraction was wrong — say so rather than widening it quietly.

**Tech Stack:** `tree-sitter-cpp` 0.23.4, `tree-sitter-java` 0.23.5, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` (§5 the seven hard constructs)

**Prerequisite:** Plan 1 complete. The grammars are already installed and `pnpm grammars` already copies all three wasm files.

## Global Constraints

- **`src/lib/ir/builder.ts` is frozen for this plan.** New per-language behaviour goes in the adapter. If you genuinely cannot express a construct in `SynNode`, stop and record why in `PROGRESS.md` before changing the shared type.
- `registry.ts` currently points `cpp` and `java` at the Python adapter as a placeholder. Task 1 and Task 2 replace those. **No language may be offered in the UI before its adapter exists.**
- Every construct in spec §5 gets a fixture per language.
- Same portability rule: no React, Next, or DOM in `src/lib/ir/**`.

---

## Task 1: C++ adapter

**Files:**
- Create: `src/lib/ir/languages/cpp.ts`
- Create: `src/lib/ir/__fixtures__/cpp/*.cpp` (14 files)
- Modify: `src/lib/ir/languages/registry.ts`
- Test: `src/lib/ir/languages/cpp.test.ts`

**Interfaces:**
- Consumes: `SynNode`, `SynFunction` (builder), `TSNode` (shared shape — lift it out of `python.ts` into `src/lib/ir/languages/tsnode.ts` in Step 1 so both adapters import it rather than one importing from the other).
- Produces: `toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] }`

- [ ] **Step 1: Extract the shared `TSNode` shape**

Move the `TSNode` interface from `python.ts` to `src/lib/ir/languages/tsnode.ts` and
re-export it. Both adapters and `parse.ts` import from there. Keep `isMissing` on it —
tree-sitter reports a recoverable omission as a zero-width MISSING node, not an ERROR,
and that is how syntax errors are detected at all.

Run `pnpm test && pnpm typecheck` — nothing should change behaviourally.

- [ ] **Step 2: Write the failing C++ test**

`src/lib/ir/languages/cpp.test.ts`:

```ts
// @vitest-environment node
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
    const ir = await cc(
      'int f(int a) { return a; }\n' +
      'double f(double a) { return a; }\n',
    );
    const ids = ir.functions.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('qualifies a method with its class', async () => {
    const ir = await cc(
      'struct Stack {\n  void push(int x) { data_ = x; }\n  int data_;\n};\n',
    );
    expect(ir.functions[0].id).toContain('Stack');
  });

  it('finds a template function', async () => {
    const ir = await cc('template <typename T>\nT maxOf(T a, T b) {\n  return a > b ? a : b;\n}\n');
    expect(ir.functions.map((f) => f.name)).toContain('maxOf');
  });
});

describe('cpp adapter — the hard constructs (spec §5)', () => {
  it('switch FALLTHROUGH: a case without break flows into the next', async () => {
    const ir = await cc(
      'int f(int v) {\n' +
      '  int r = 0;\n' +
      '  switch (v) {\n' +
      '    case 1: r = 1;\n' +          // no break: falls through
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

  it('GOTO and labels become real edges', async () => {
    const ir = await cc(
      'int f(int n) {\n' +
      '  int i = 0;\n' +
      'top:\n  i++;\n' +
      '  if (i < n) goto top;\n' +
      '  return i;\n}\n',
    );
    const g = ir.functions[0];
    // The goto must target the labelled statement, producing a cycle.
    expect(g.edges.some((e) => e.kind === 'back' || e.kind === 'seq')).toBe(true);
    expect(g.nodes.some((n) => n.statements.some((s) => s.includes('goto top')))).toBe(true);
  });

  it('do-while runs the body before the condition', async () => {
    const ir = await cc('void f() {\n  int x = 0;\n  do { x++; } while (x < 3);\n}\n');
    const g = ir.functions[0];
    const header = g.nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('do-while');
    expect(g.edges.filter((e) => e.kind === 'back')).toHaveLength(1);
  });

  it('range-for normalizes to foreach', async () => {
    const ir = await cc('int f(const std::vector<int>& xs) {\n  int s = 0;\n  for (int x : xs) s += x;\n  return s;\n}\n');
    const header = ir.functions[0].nodes.find((n) => n.kind === 'loop-header')!;
    expect(header.meta?.loopKind).toBe('foreach');
  });

  it('classic three-part for is a loop with a back edge', async () => {
    const ir = await cc('int f(int n) {\n  int s = 0;\n  for (int i = 0; i < n; i++) s += i;\n  return s;\n}\n');
    const g = ir.functions[0];
    expect(g.nodes.some((n) => n.kind === 'loop-header')).toBe(true);
    expect(g.edges.some((e) => e.kind === 'back')).toBe(true);
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

  it('records a diagnostic for a syntax error but still returns IR', async () => {
    const ir = await cc('int f( {\n  return 1;\n}\n');
    expect(ir.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });
});
```

- [ ] **Step 3: Run it** → FAIL (the placeholder Python adapter cannot parse C++)

- [ ] **Step 4: Implement `cpp.ts`**

Node types to map (verify each against the real grammar with a scratch script before
trusting this list — grammars change):

| C++ grammar node | SynNode |
|---|---|
| `function_definition`, `template_declaration` > `function_definition` | `func` |
| `if_statement` (`condition`, `consequence`, `alternative`) | `if` + `meta.elseBody` |
| `while_statement` | `loop` `while` |
| `do_statement` | `loop` `do-while` |
| `for_statement` | `loop` `for` |
| `for_range_loop` | `loop` `foreach` |
| `switch_statement` > `compound_statement` > `case_statement` | `switch` + `case` |
| `case_statement` with no `value` field | `case` + `meta.isDefault` |
| `return_statement` | `return` |
| `throw_statement` | `throw` |
| `break_statement` / `continue_statement` | `break` / `continue` |
| `labeled_statement` | `label` + `meta.label` |
| `goto_statement` | `goto` + `meta.label` |
| `try_statement` (+ `catch_clause`) | `try` + `meta.catchBodies` (one array per clause) |
| everything else named | `stmt` |

Function id must include parameter **types**, not just names, or overloads collide:
`add(int,int)`. Qualify methods with their enclosing `class_specifier` /
`struct_specifier` name.

`goto` needs a two-pass approach: collect `labeled_statement` positions first, then
emit `goto` as a `break`-like jump to that label. The builder already resolves labelled
jumps — reuse `meta.label`. If it cannot, record the gap rather than editing the builder.

- [ ] **Step 5: Point the registry at it, run the tests** → PASS

- [ ] **Step 6: Add 14 golden fixtures** under `__fixtures__/cpp/`, mirroring the Python
set plus `13-goto.cpp` and `14-switch-fallthrough.cpp`. Extend `golden.test.ts` to walk
both directories. **Read every new snapshot before trusting it** — a snapshot test only
protects behaviour someone has actually verified once.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: C++ adapter with goto, switch fallthrough, and overload-safe ids"
```

---

## Task 2: Java adapter

**Files:**
- Create: `src/lib/ir/languages/java.ts`
- Create: `src/lib/ir/__fixtures__/java/*.java` (13 files)
- Modify: `src/lib/ir/languages/registry.ts`
- Test: `src/lib/ir/languages/java.test.ts`

- [ ] **Step 1: Write the failing Java test**

Cover, at minimum:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../parse';

const jv = (source: string) => parseToIR(source, 'java', { baseUrl: 'public' });

describe('java adapter — the hard constructs', () => {
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

  it('switch fallthrough behaves like C++', async () => { /* … */ });
  it('enhanced for normalizes to foreach', async () => { /* … */ });
  it('try/catch/finally: finally reachable from a return inside try', async () => { /* … */ });
  it('methods are qualified by their class, so two classes may share a name', async () => { /* … */ });
  it('static and instance methods both appear', async () => { /* … */ });
  it('a syntax error still yields diagnostics plus partial IR', async () => { /* … */ });
});
```

- [ ] **Step 2: Run it** → FAIL

- [ ] **Step 3: Implement `java.ts`**

| Java grammar node | SynNode |
|---|---|
| `method_declaration`, `constructor_declaration` | `func` |
| `if_statement` | `if` + `meta.elseBody` |
| `while_statement` / `do_statement` | `loop` `while` / `do-while` |
| `for_statement` | `loop` `for` |
| `enhanced_for_statement` | `loop` `foreach` |
| `switch_expression` > `switch_block` > `switch_block_statement_group` | `switch` + `case` |
| `labeled_statement` | sets `meta.label` on the loop it wraps |
| `break_statement` / `continue_statement` with a label child | `break`/`continue` + `meta.label` |
| `try_statement`, `catch_clause`, `finally_clause` | `try` + `catchBodies` + `finallyBody` |
| `throw_statement` | `throw` |
| `return_statement` | `return` |

The labelled-loop case is the one to get right: a `labeled_statement` wrapping a loop
must put its label on the **loop's** `meta.label`, not emit a separate node — that is
what lets the builder's existing `breakStmt`/`continueStmt` resolve the jump.

Java 14+ arrow switches (`case 1 ->`) do **not** fall through. Detect the arrow form and
emit an implicit `break` in each case body, or the graph will claim fallthrough that the
language does not have.

- [ ] **Step 4: Registry, tests** → PASS

- [ ] **Step 5: 13 golden fixtures**, read before trusting.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: Java adapter with labeled break/continue and arrow-switch handling"
```

---

## Task 3: Cross-language isomorphism

This is the test that keeps the IR honest. If it fails, the abstraction is leaking.

**Files:**
- Create: `src/lib/ir/isomorphism.test.ts`
- Create: `src/lib/ir/__fixtures__/isomorphic/{binary-search,bfs,quicksort,fib}.{py,cpp,java}`

- [ ] **Step 1: Write the test**

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseToIR } from './parse';
import type { FunctionGraph, Language } from './types';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__/isomorphic');

/** Structural fingerprint: kinds and topology, ignoring names and text. */
function shape(g: FunctionGraph) {
  const kinds = g.nodes.map((n) => n.kind).sort();
  const edges = g.edges.map((e) => e.kind).sort();
  return { kinds, edges, exits: g.exitIds.length };
}

const CASES = ['binary-search', 'bfs', 'quicksort', 'fib'] as const;
const LANGS: [Language, string][] = [['python', 'py'], ['cpp', 'cpp'], ['java', 'java']];

describe('cross-language isomorphism', () => {
  for (const name of CASES) {
    it(`${name} produces the same graph shape in all three languages`, async () => {
      const shapes = await Promise.all(
        LANGS.map(async ([lang, ext]) => {
          const src = readFileSync(path.join(DIR, `${name}.${ext}`), 'utf8');
          const ir = await parseToIR(src, lang, { baseUrl: 'public' });
          expect(ir.diagnostics.filter((d) => d.severity === 'error'), `${name}.${ext}`).toEqual([]);
          // Compare the FIRST function: the fixtures each define one algorithm.
          return { lang, shape: shape(ir.functions[0]) };
        }),
      );
      const [first, ...rest] = shapes;
      for (const other of rest) {
        expect(other.shape, `${name}: ${other.lang} differs from ${first.lang}`)
          .toEqual(first.shape);
      }
    });
  }
});
```

- [ ] **Step 2: Write the 12 fixtures** — the same algorithm, idiomatic in each language.
Keep them structurally equivalent on purpose: same branches, same loops, same number of
returns. If idiomatic code cannot match (a C++ iterator loop vs a Python `range`), that
is a finding about the IR, not a licence to contort the fixture.

- [ ] **Step 3: Run it.** Expect failures at first — this test exists to find them.

When it fails, the question is always *which* is right: usually the adapter that
normalizes less. Fix the adapter, never the comparison. Record each divergence and its
resolution in `PROGRESS.md`.

- [ ] **Step 4: Commit**

```bash
git commit -m "test: cross-language isomorphism across Python, C++, and Java"
```

---

## Task 4: Language picker and detection

**Files:**
- Modify: `src/components/workbench/Workbench.tsx`, project creation form
- Create: `src/lib/ir/detect.ts`
- Test: `src/lib/ir/detect.test.ts`

- [ ] **Step 1: Test-drive `detectLanguage(source): Language | null`**

Cheap heuristics only, and honest about ambiguity — `null` means "ask, don't guess":

```ts
it('detects python from def and colons', () => {
  expect(detectLanguage('def f(x):\n    return x\n')).toBe('python');
});
it('detects java from a class with a typed method', () => {
  expect(detectLanguage('class T { int f(int a) { return a; } }')).toBe('java');
});
it('detects cpp from #include or std::', () => {
  expect(detectLanguage('#include <vector>\nint f() { return 0; }')).toBe('cpp');
});
it('returns null when genuinely ambiguous', () => {
  expect(detectLanguage('x = 1')).toBeNull();
});
```

- [ ] **Step 2: Wire the picker.** On paste, run detection; if it returns a language,
preselect it and say so ("detected Python — change it if that's wrong"). If it returns
`null`, leave the current choice and do not guess.

- [ ] **Step 3: Remove the placeholder guard.** `registry.ts` no longer aliases anything,
and the trap note in `PROGRESS.md` about C++/Java not being real can be struck.

- [ ] **Step 4: Verify by hand** — paste each of the three languages into the workbench and
confirm the diagram is right, not merely present.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: language picker with paste detection"
```

---

## Self-Review

**Spec coverage:** §5's seven hard constructs now have per-language fixtures; §5's
normalization claim is enforced by Task 3 rather than asserted.

**The frozen-builder check:** if this plan ended with edits to `builder.ts`, note in
`PROGRESS.md` what forced them. That is the signal the `SynNode` boundary needs
rethinking before a fourth language (P2's JavaScript) arrives.

**Done when:** binary search in all three languages yields identical graph shapes, the
picker offers all three honestly, and `pnpm test` is green.
