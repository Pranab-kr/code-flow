# P2 JavaScript Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner pastes everyday JavaScript and gets the same correct control-flow diagram as the three P1 languages, through one new tree-sitter → `SynNode` adapter plus wiring.

**Architecture:** P2 is one new adapter (`src/lib/ir/languages/javascript.ts`) plus the five-point wiring checklist from spec §9. Nothing about the diagram layer changes: same portable IR, same ELK layout, same canvas, same outline, same export. The `SynNode` boundary review (spec §4) lands first as a committed file skeleton; if it finds a gap, work stops for a proposal rather than quietly extending the builder.

**Tech Stack:** `tree-sitter-javascript@0.25.0` (wasm `tree-sitter-javascript.wasm`, ~412KB), `web-tree-sitter@0.27.0`, `@codemirror/lang-javascript` (editor highlighting only), vitest (node env), throwaway `playwright-core` in `/tmp` for the browser smoke (trap 11 pattern — Playwright is configured for E2E but the smoke precedes it).

**Spec:** `docs/superpowers/specs/2026-09-03-code-flow-p2-javascript-design.md` (approved 2026-09-03; supersedes the P2 stub for scope). The stub's process notes (boundary review, wasm verification, wiring checklist) still apply and are folded into the tasks below.

## Global Constraints

- `tree-sitter-javascript@0.25.0` exactly; `web-tree-sitter@0.27.0`; `pnpm@10.25`, never npm (decision log: `npm init` ignores `--prefix` and stamps the repo root — throwaway npm work uses the shell `workdir`, never `--prefix`).
- TypeScript `strict`, no `any` in committed code. `src/lib/ir/` imports no React, Next, or DOM globals (ESLint-enforced; runs in worker + Node job).
- No new IR node or edge kinds without a `SynNode` boundary discussion (spec §2). Ternaries stay inline (P1 basic-blocks policy).
- Never `{...node}` a tree-sitter node (prototype getters — spread copies none of them). Compare nodes by `id`, never `!==` (accessors return fresh wrappers).
- Every colour/font through a token; never inline hex/OKLCH. No token changes expected in P2 — contrast 27/27 stands as-is.
- TDD: failing test, watch it fail, minimal implement, watch it pass, commit per task. Messages say *why*.
- `jpg`/`jpeg` naming and export rules are untouched — no export work in P2.
- Do not proceed past a failing RLS test. A negative test passing when it should fail means the policy is wrong.
- Migration numbering: next is `0007` (`0005` vault, `0006` chat exist). DDL goes through the user's Supabase MCP/dashboard against hosted `gsfosuvhysdesstetwjh`, never ad-hoc SQL from here.
- The marketing hero stays wasm-free; the JS grammar lazy-loads with the language only.
- Never start implementation on `main` — this plan executes on branch `p2-javascript` (worktree `.worktrees/p2-javascript`).

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/ir/languages/javascript.ts` (create) | The ONLY place JS grammar node types appear. tree-sitter → `SynNode`, grammar-notes header like `java.ts`. |
| `src/lib/ir/languages/javascript.test.ts` (create) | ABI probe (spec §3 gate) + focused adapter tests, `// @vitest-environment node`, `parseToIR(source, 'javascript', { baseUrl: 'public' })`. |
| `src/lib/ir/types.ts` (modify) | `Language` gains `'javascript'`. |
| `src/lib/ir/languages/registry.ts` (modify) | `javascript` entry: grammar URL + node package + adapter. Worker and Inngest need no code change (registry-driven). |
| `package.json` (modify) | `tree-sitter-javascript` dependency + `grammars` script gains the fourth `cp`. |
| `src/lib/ir/__fixtures__/js/*.js` (create, 13) | Golden fixtures mirroring the java set + arrow/async forms. |
| `src/lib/ir/golden.test.ts` (modify) | SUITES gains `{ language: 'javascript', dir: 'js', ext: '.js', count: 13 }`. |
| `src/lib/ir/__fixtures__/isomorphic/*.js` (create, 4) | Fourth column for binary-search, bfs, quicksort, fib (declaration form). |
| `src/lib/ir/isomorphism.test.ts` (modify) | LANGUAGES gains `['javascript', 'js']`; describe text "all three" → "all four". |
| `src/lib/ir/detect.ts` + `detect.test.ts` (modify) | JS evidence rules + TS-annotation veto (spec §7). |
| `src/components/workbench/Workbench.tsx` (modify) | Picker `<option value="javascript">` + `JavaScript` label at both call-sites (current title-case logic yields `Javascript` — wrong). |
| `src/app/(app)/projects/NewProjectForm.tsx` (modify) | Creation picker option. |
| `src/components/editor/CodeEditor.tsx` (modify) | `EXTENSIONS` gains `javascript` (`@codemirror/lang-javascript`, new dep). |
| `src/app/(app)/projects/actions.ts` (modify) | `STARTER.javascript`, `isLanguage`, saveSource error copy. |
| `supabase/migrations/0007_javascript_language.sql` (create) | Widen both `language` CHECKs (inline constraints, auto-named `projects_language_check` / `snapshots_language_check`). |
| `docs/superpowers/plans/2026-09-04-p2-javascript.md` (this file) | The plan. |
| `PROGRESS.md` (modify, Task 6) | P2 task board + decision entries. |

---

### Task 1: Grammar dependency + ABI loader probe (spec §3 gate)

**Files:**
- Modify: `package.json` (`dependencies` + `grammars` script)
- Modify: `src/lib/ir/types.ts:12`
- Modify: `src/lib/ir/languages/registry.ts`
- Create: `src/lib/ir/languages/javascript.test.ts` (probe describes only — adapter describes arrive in Task 3)
- Create (temp, deleted in-task): `src/lib/ir/languages/scratch-dump.test.ts`

**Interfaces:**
- Consumes: `parseToIR` from `../parse` (unchanged signature).
- Produces: `Language` includes `'javascript'`; `LANGUAGES.javascript = { grammarUrl: '/grammars/tree-sitter-javascript.wasm', nodePackage: 'tree-sitter-javascript', adapter }` (adapter stub arrives in Task 2; this task wires a temporary inline adapter that Task 2 replaces — no, simpler: Task 1 implements type + registry + grammar copy, and the test target is the probe; the adapter import must exist, so Task 1 also creates the Task-2 skeleton file. The skeleton returns no functions, so the probe FAILS in Task 1 and PASSES only after Task 3's function-identity group. To keep Task 1 independently green, its committed test asserts the loader gate only: parse does not throw and returns a result object with zero error diagnostics for `function add(a, b) {\n  return a + b;\n}\n` — wait, with a stub adapter the diagnostics ARE zero (stub returns `diagnosticsFor(root)`, clean parse → `[]`). Hmm: the honest loader assertion is "grammar loaded and tree built", observable as: no throw + `diagnostics` is an array + result.language === 'javascript'. The *named-node* assertion (function found) belongs to Task 3. So Task 1 probe asserts load-success shape; Task 3 asserts named content. This matches spec §3: "the probe asserts a named node in the tree, not just no throw" — the named-node half is Task 3's first test, explicitly cross-referenced.)

- [ ] **Step 1: Add the grammar package**

```bash
pnpm add tree-sitter-javascript@0.25.0
ls -la node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm
```

Expected: installs 0.25.0; the wasm exists (~412KB per spec §3). If the root wasm file is absent or differently named, STOP — spec §3's premise fails and the spec needs amendment (P1 `tree-sitter-wasms` lesson).

- [ ] **Step 2: Extend the grammars copy script**

In `package.json`, change the `grammars` script to append the fourth `cp`:

```json
"grammars": "mkdir -p public/grammars && cp node_modules/web-tree-sitter/web-tree-sitter.wasm public/grammars/ && cp node_modules/tree-sitter-python/tree-sitter-python.wasm node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm node_modules/tree-sitter-java/tree-sitter-java.wasm node_modules/tree-sitter-javascript/tree-sitter-javascript.wasm public/grammars/"
```

Then run `pnpm grammars` and confirm `public/grammars/tree-sitter-javascript.wasm` exists. (`public/grammars/` is gitignored — generated, never committed. `next.config.ts` `outputFileTracingIncludes` already covers `./public/grammars/**`, so no config change; Task 6 verifies the wasm lands in the trace.)

- [ ] **Step 3: Write the failing loader probe**

Create `src/lib/ir/languages/javascript.test.ts`:

```ts
// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm.
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../parse';
import type { Language } from '../types';

const js = (source: string) => parseToIR(source, 'javascript' as unknown as Language, { baseUrl: 'public' });

describe('javascript grammar loader probe (spec §3)', () => {
  it('loads the grammar and builds a tree instead of throwing', async () => {
    const ir = await js('function add(a, b) {\n  return a + b;\n}\n');
    expect(ir.language).toBe('javascript');
    expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
```

(`as unknown as Language`: `types.ts` has no `'javascript'` yet, so a direct literal is a type error; the cast keeps the test compiling so the failure is the honest runtime one. Task 3 replaces the cast with a plain literal once the type exists — no wait, the type is added in Step 4 of THIS task. Keep the cast in the failing run, then Step 4 adds the type and Step 5 simplifies the helper to `parseToIR(source, 'javascript', ...)` as part of going green. Both states are shown below.)

- [ ] **Step 4: Run the probe, watch it fail**

Run: `pnpm vitest run --project unit src/lib/ir/languages/javascript.test.ts`
Expected: FAIL with `TypeError: Cannot read properties of undefined` (or similar) from `LANGUAGES['javascript']` being undefined in `parse.ts` — the grammar never loads. If it fails any other way, investigate; do not proceed on a misunderstood failure.

- [ ] **Step 5: Minimal implementation — type, registry, skeleton adapter**

`src/lib/ir/types.ts`:

```ts
export type Language = 'cpp' | 'java' | 'python' | 'javascript';
```

`src/lib/ir/languages/registry.ts` — add the import and entry (keep alphabetical-ish order as-is; append after `java`):

```ts
import { toSyn as javascriptToSyn } from './javascript';
```

```ts
  javascript: {
    grammarUrl: '/grammars/tree-sitter-javascript.wasm',
    nodePackage: 'tree-sitter-javascript',
    adapter: javascriptToSyn,
  },
```

Create `src/lib/ir/languages/javascript.ts` as the Task-2 skeleton (full header + stub body — the exact content is Task 2 Step 3; Task 1 needs the file to exist so the import resolves):

```ts
import type { Diagnostic } from '../types';
import type { SynFunction, SynNode } from '../builder';
import { diagnosticsFor, type TSNode } from './tsnode';

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  return { funcs: [], diagnostics: diagnosticsFor(root) };
}
```

Simplify the test helper to `const js = (source: string) => parseToIR(source, 'javascript', { baseUrl: 'public' });` and drop the `Language` import.

- [ ] **Step 6: Run the probe, watch it pass**

Run: `pnpm vitest run --project unit src/lib/ir/languages/javascript.test.ts`
Expected: PASS (1 test). The grammar loads under `web-tree-sitter@0.27.0`, the tree builds, zero error diagnostics. This closes the ABI half of spec §3 on the Node side; the browser side closes in Task 6's smoke (deliberately no jsdom worker-shape unit — it would pass via the Node path and prove nothing, cf. trap 10).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/ir/types.ts src/lib/ir/languages/registry.ts src/lib/ir/languages/javascript.ts src/lib/ir/languages/javascript.test.ts
git commit -m "feat: load tree-sitter-javascript with ABI probe (P2 Task 1)"
```

Do NOT commit `public/grammars/` (gitignored) or the scratch-dump file (next task creates and deletes it).

---

### Task 2: SynNode boundary review, committed before adapter code (spec §4)

**Files:**
- Modify: `src/lib/ir/languages/javascript.ts` (header comment only — body stays the stub)
- Modify (only if the review finds a gap): `src/lib/ir/builder.ts` + `src/lib/ir/builder.test.ts`

**Interfaces:**
- Consumes: `SynKind` / `SynNode['meta']` from `../builder` (read-only unless the verdict is "extension needed").
- Produces: a committed header comment containing the construct map and the one-line verdict — Task 3's implementer codes against that map.

- [ ] **Step 1: Re-read the builder contract**

Read `src/lib/ir/builder.ts:25-77` (`SynKind`, `SynNode`, `meta` fields) and confirm each capability the JS construct list needs: `func` with `id/name/params`; `if` with then-`children` + `meta.elseBody`; `loop` with `meta.loopKind: 'while' | 'for' | 'do-while' | 'foreach'`; classic fallthrough `switch`/`case` arms; pending-break machinery with `meta.label` for labeled break/continue; `try` with `catchBodies: SynNode[][]` + `finallyBody`; `return` / `throw` / `call` / `stmt`; forward/backward goto + label resolution (needed only if JS had `goto` — it does not).

- [ ] **Step 2: Dump the real grammar tree for a probe file (grounds every later mapping)**

Create temp file `src/lib/ir/languages/scratch-dump.test.ts`:

```ts
// @vitest-environment node
import { it } from 'vitest';
import { Parser, Language as TSLanguage } from 'web-tree-sitter';
import { readFileSync } from 'node:fs';

const SRC = `class Search {
  static async binarySearch(arr, target) {
    let lo = 0;
    for (const x of arr) {
      if (x === target) return x;
    }
    try {
      lo = await Search.helper(lo);
    } catch (e) {
      throw e;
    } finally {
      lo++;
    }
    switch (lo) {
      case 0:
      case 1:
        lo += 2;
        break;
      default:
        lo = -1;
    }
    outer: for (let i = 0; i < lo; i++) {
      for (let j = 0; j < lo; j++) {
        if (i === j) continue outer;
        if (i + j > 10) break outer;
      }
    }
    do {
      lo--;
    } while (lo > 0);
    const dbl = (n) => n * 2;
    return dbl(lo);
  }
}
`;

it('dump', async () => {
  await Parser.init();
  const lang = await TSLanguage.load('public/grammars/tree-sitter-javascript.wasm');
  const parser = new Parser();
  parser.setLanguage(lang);
  const tree = parser.parse(SRC);
  console.log(tree.rootNode.toString());
  tree.delete();
  parser.delete();
});
```

Run: `pnpm vitest run --project unit src/lib/ir/languages/scratch-dump.test.ts 2>&1 | head -c 6000`
Expected: a full S-expression. Confirm (and correct the map if different): `function_declaration` / `arrow_function` / `function_expression` / `generator_function`(+`async` flag usage), `class_declaration` → `class_body` → `method_definition`, `statement_block`, `if_statement` (`condition`/`consequence`/`alternative`), `switch_statement` → `switch_body` → `switch_case`/`switch_default`, `while_statement` / `do_statement` / `for_statement` / `for_in_statement`, `break_statement` / `continue_statement` label shape, `labeled_statement`, `try_statement` (`body`/`handler`→`catch_clause`/`finalizer`→`finally_clause`), `return_statement` / `throw_statement`, `await_expression` / `yield_expression`, `variable_declaration` → `variable_declarator`, `expression_statement`, `comment`. (java.ts's header exists for exactly this reason — every mapping below was read off the real 0.25.0 grammar, not guessed.)

- [ ] **Step 3: Write the header + verdict into `javascript.ts` (body stays the stub)**

Replace the file content with the stub body under this header (adjust any node-type name the dump contradicts):

```ts
/**
 * JavaScript tree-sitter -> SynNode adapter.
 *
 * The ONLY place JS grammar node types appear. Every mapping was read off the
 * real tree-sitter-javascript 0.25.0 grammar with a scratch dump (Task 2); the
 * ones that differ from a reasonable guess are worth knowing:
 *
 *   - `for...of` and `for...in` are both `for_in_statement`; no disambiguation
 *     is needed because both map to loopKind 'foreach' (spec §5).
 *   - arrow functions with an expression body arrive with a non-block `body`;
 *     only BLOCK-bodied arrows assigned to a variable become FunctionGraphs —
 *     expression-bodied arrows and inline callbacks fold into the enclosing
 *     block as statements (spec §6).
 *   - class methods are `method_definition` inside `class_body`; the class name
 *     qualifies the id (`Search.binarySearch(arr,target)`), so two classes may
 *     share a method name (spec §6).
 *   - `switch` arms are `switch_case` / `switch_default` and fall through like
 *     C++ (the classic path, NOT `noFallthrough` — spec §5).
 *   - getters/setters (`get x() {}` / `set x(v) {}`) and object-literal methods
 *     (`{ m() {} }`) parse fine but are NOT graphed (spec §5 + §10 known gap).
 *
 * Boundary review 2026-09-04 (spec §4): NO builder change needed. The builder
 * already handles try/catch/finally bodies, all four loop kinds, classic
 * fallthrough switches, and labeled break/continue (the Java path). `await` /
 * `yield` are ordinary statements; `async` adds no edge. If a construct below
 * ever needs a new IR kind, stop and propose a boundary extension — do not
 * quietly extend the builder.
 *
 * Construct map (spec §5, normative):
 *   function_declaration / assigned arrow / assigned function_expression -> func
 *   class method_definition (incl. static) -> func, id Class.method(params)
 *   if_statement / else-if chain -> if (+ meta.elseBody); ternary -> inline stmt
 *   switch_statement + break -> switch/case (classic fallthrough)
 *   while_statement -> loop 'while'; do_statement -> loop 'do-while'
 *   for_statement -> loop 'for'; for_in_statement (of + in) -> loop 'foreach'
 *   break/continue (+ labeled_statement targets) -> break/continue (+ label)
 *   try_statement -> try (catchBodies per handler, finallyBody)
 *   return_statement -> return; throw_statement -> throw
 *   await_expression / yield_expression -> stmt (no edge, no marker)
 *   eval / with -> stmt (P1 executes nothing; nothing to sandbox)
 */
```

- [ ] **Step 4: If the dump contradicts the map, stop**

If any construct above has no `SynNode` home (the way `goto` and arrow-switches didn't in Plan 3), do NOT invent a quiet workaround: write the minimal extension proposal in the same shape as the two P1 precedents (label resolution, `noFallthrough`), raise it, and only then TDD it in `builder.ts` + `builder.test.ts`. Expected outcome is no change — this step exists so the review can confirm zero, never assume it.

- [ ] **Step 5: Delete the scratch file and commit the review**

```bash
rm src/lib/ir/languages/scratch-dump.test.ts
git add src/lib/ir/languages/javascript.ts
git commit -m "docs: SynNode boundary review for JavaScript, no builder change (P2 Task 2)"
```

---

### Task 3: JS adapter core — functions through try/catch, TDD per group

**Files:**
- Modify: `src/lib/ir/languages/javascript.ts`
- Modify: `src/lib/ir/languages/javascript.test.ts` (append describes; keep the Task 1 probe at top)

**Interfaces:**
- Consumes: `syn`, `span`, `head`, `diagnosticsFor`, `TSNode` from `./tsnode`; `SynFunction`, `SynNode` from `../builder`.
- Produces: `toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] }` — the function `registry.ts` already imports.

General shape (mirrors `java.ts` — `block()`/`stmts()`/`toSynStmt()` helpers; confirm field names against the Task 2 dump):

```ts
function block(n: TSNode | null): TSNode[] {
  if (!n) return [];
  const list = n.type === 'statement_block' ? n.namedChildren : [n];
  return list.filter((c) => !isComment(c));
}

function isComment(n: TSNode): boolean {
  return n.type === 'comment';
}
```

Top-level walk: `program` children → `function_declaration` (incl. `generator_function_declaration`, `async` variants) → one `SynFunction` each with signature id `name(p1,p2)`; `variable_declarator` whose value is `arrow_function`/`function_expression` with a BLOCK body → one `SynFunction` named by the variable (so `const binarySearch = (arr, target) => {...}` and `function binarySearch(arr, target){...}` share id `binarySearch(arr,target)` — spec §6, pinned by test); `class_declaration` → each block-bodied `method_definition` → `Class.method(params)` (static included; constructor included as `Class.constructor(...)`); anonymous/unassigned functions, getters/setters, object-literal methods → skipped (their statements are NOT hoisted — they belong to a function value, not the enclosing flow; assert absence).

Params: `formal_parameters` named children mapped with `head()` (covers `identifier`, `assignment_pattern` defaults, `rest_pattern`). Async/generator markers do NOT enter the id.

- [ ] **Step 1: Function identity tests (fail first)**

Append to `javascript.test.ts`:

```ts
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
    const ir = await js('function f(items) {\n  items.forEach((x) => {\n    console.log(x);\n  });\n  return 0;\n}\n');
    expect(ir.functions).toHaveLength(1);
    expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
```

Run: `pnpm vitest run --project unit src/lib/ir/languages/javascript.test.ts`
Expected: FAIL — `toSyn` returns no funcs.

- [ ] **Step 2: Implement function discovery + statement fallback**

Implement the top-level walk and `toSynStmt` fallback (`stmt` for any unlisted statement type — expression/variable/await/yield/eval/with all arrive as plain statements with `head()` text; NO special-casing for `await_expression`/`yield_expression` beyond letting them be statements). Re-run: PASS.

- [ ] **Step 3: Branch + loop tests (fail first)**

```ts
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
    expect(ir.functions[0].edges.some((e) => e.kind === 'call')).toBe(false);
  });
});
```

Run, watch FAIL; implement `if_statement` (condition text unwrapped from `parenthesized_expression`, then-children + `meta.elseBody`, else-if recursion like java.ts), the five loop forms (`for_statement` init-before-loop + update-in-header per the java.ts comment — `continue` must still run the update), `await`/`yield`-as-statement; re-run PASS.

- [ ] **Step 4: Switch + jumps + try tests (fail first)**

```ts
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
```

Run, watch FAIL; implement `switch_statement` (classic arms — do NOT set `noFallthrough`), `break/continue_statement` with `meta.label` via the Java label path, `labeled_statement`, `try_statement` (`catch_clause` body per handler into `catchBodies`, `finally_clause` into `finallyBody`), `return/throw`. The TS-annotation test passes via `diagnosticsFor` with no adapter work (annotations are ERROR nodes in the JS grammar) — that is the point: spec §2's silent-wrong-answer class stays impossible. Re-run: PASS.

- [ ] **Step 5: Full-suite check + commit**

Run: `pnpm test` (whole unit project — nothing else may regress).
Expected: all green (baseline 339 + new JS tests).
Commit:

```bash
git add src/lib/ir/languages/javascript.ts src/lib/ir/languages/javascript.test.ts
git commit -m "feat: JavaScript CFG adapter, declarations through try/finally (P2 Task 3)"
```

---

### Task 4: Golden fixtures — 13 JS files under the existing harness

**Files:**
- Create: `src/lib/ir/__fixtures__/js/01-straight-line.js` … `13-arrow-forms.js` (13 files, listed below)
- Modify: `src/lib/ir/golden.test.ts:48-52` (SUITES row)

**Interfaces:**
- Consumes: `parseToIR` + `normalize()` in `golden.test.ts` (unchanged).
- Produces: 13 committed fixtures + snapshots; every fixture parses with zero error diagnostics.

Fixture list (each small, valid JS, one idea per file — ports of the java set plus JS forms):
01 straight-line (`function add`), 02 if-else, 03 else-if chain, 04 while loop, 05 for-of over an array, 06 nested loops, 07 break/continue, 08 labeled break/continue, 09 multi-return, 10 try-catch-finally, 11 recursion (self `call` edge — the hero feature must show in JS too), 12 binary-search (declaration form, `function binarySearch(arr, target)`), 13 arrow-forms (`const binarySearch = async (arr, target) => {...}` over the same algorithm + a `class Search` method variant — spec §8 requires arrow ≡ declaration isomorphism; the golden pins the arrow rendering).

- [ ] **Step 1: Write the 13 fixtures**

Example shape (all 13 follow this scale — a few lines each):

`12-binary-search.js`:

```js
function binarySearch(arr, target) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    else if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
```

`13-arrow-forms.js`:

```js
const binarySearch = async (arr, target) => {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    else if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
};
class Search {
  static find(arr, target) {
    return binarySearch(arr, target);
  }
}
```

- [ ] **Step 2: Register the suite**

```ts
{ language: 'javascript', dir: 'js', ext: '.js', count: 13 },
```

- [ ] **Step 3: Run goldens, watch the new suite fail on missing snapshots**

Run: `pnpm vitest run --project unit src/lib/ir/golden.test.ts`
Expected: FAIL only on the 13 `javascript` snapshot mismatches (new keys); python/cpp/java suites stay green. Any failure in the older suites means the adapter leaked into shared code — stop and investigate.

- [ ] **Step 4: READ the new snapshots before accepting (the P1 bugs lesson)**

Run with snapshot update off; inspect the written snapshot for `12-binary-search.js` and `13-arrow-forms.js` at minimum: 10 nodes, branch diamonds for the if/else-if/else, `while` loop-header with a `back` edge, two `return` exits (mid + -1). Compare against the java `12-binary-search.java` snapshot shape — same algorithm, same structure. Also read the `10-try-finally` and switch snapshots if present. A green suite frozen over a wrong graph is the exact failure P1's pre-implementation sweep caught — do not `-u` blind.

- [ ] **Step 5: Accept + full green + commit**

```bash
pnpm vitest run --project unit src/lib/ir/golden.test.ts -u
pnpm vitest run --project unit src/lib/ir/golden.test.ts
```

Expected: 13/13 snapshots pass, structural-invariant suites pass for `js`.
Commit:

```bash
git add src/lib/ir/__fixtures__/js/ src/lib/ir/golden.test.ts src/lib/ir/__snapshots__/
git commit -m "test: 13 JavaScript golden fixtures under the existing harness (P2 Task 4)"
```

---

### Task 5: Isomorphism fourth column + the five-point wiring checklist (spec §9)

**Files:**
- Create: `src/lib/ir/__fixtures__/isomorphic/binary-search.js`, `bfs.js`, `quicksort.js`, `fib.js` (idiomatic declaration form)
- Modify: `src/lib/ir/isomorphism.test.ts:24-28,32`
- Modify: `src/lib/ir/detect.ts`, `src/lib/ir/detect.test.ts`
- Modify: `src/components/workbench/Workbench.tsx:119,295,371-373`
- Modify: `src/app/(app)/projects/NewProjectForm.tsx:32-35`
- Modify: `src/components/editor/CodeEditor.tsx:6-8,18-22` (+ `pnpm add @codemirror/lang-javascript`)
- Modify: `src/app/(app)/projects/actions.ts:12-52,54-56,144`
- Create: `supabase/migrations/0007_javascript_language.sql` (+ apply to hosted via Supabase MCP, verify)

**Interfaces:**
- Consumes: `shape()` semantics in `isomorphism.test.ts` (node kinds, edge kinds, exit counts); `detectLanguage(source): Language | null`; `STARTER: Record<Language, string>`; `isLanguage(v: string): v is Language`.
- Produces: JS in every language list; `snapshots.language = 'javascript'` persists end-to-end.

- [ ] **Step 1: Isomorphism fixtures + test (fail first)**

Port the four algorithms to idiomatic JS (declaration form, `===`, `const`/`let`, `for...of` where the python uses iteration). Then:

```ts
const LANGUAGES: [Language, string][] = [
  ['python', 'py'],
  ['cpp', 'cpp'],
  ['java', 'java'],
  ['javascript', 'js'],
];
```

and retitle the test to `` `${name} produces the same graph shape in all four languages` ``. (No snapshots in this file — the rename orphans nothing.)

Arrow ≡ declaration check goes in `javascript.test.ts` (spec §8 identity rule):

```ts
it('arrow-form and declaration-form binary search are isomorphic', async () => {
  const shapeOf = (g: { nodes: { kind: string }[]; edges: { kind: string }[]; exitIds: unknown[] }) => ({
    nodes: g.nodes.map((n) => n.kind).sort(),
    edges: g.edges.map((e) => e.kind).sort(),
    exits: g.exitIds.length,
  });
  const decl = await js('function binarySearch(arr, target) {\n  let lo = 0;\n  let hi = arr.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (arr[mid] === target) return mid;\n    else if (arr[mid] < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}\n');
  const arrow = await js('const binarySearch = (arr, target) => {\n  let lo = 0;\n  let hi = arr.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (arr[mid] === target) return mid;\n    else if (arr[mid] < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}\n');
  expect(shapeOf(arrow.functions[0])).toEqual(shapeOf(decl.functions[0]));
});
```

Run both files; if a principled mismatch appears (a construct with no cross-language twin), STOP — spec §8 requires the spec to amend §8 before the golden freezes it. None expected.

- [ ] **Step 2: `detect.ts` evidence + TS veto (fail first)**

Tests first (`detect.test.ts` append):

```ts
it('detects JavaScript from arrows, strict equality, and console', () => {
  expect(detectLanguage('const binarySearch = (arr, target) => {\n  if (arr[0] === target) return 0;\n  return -1;\n}\n')).toBe('javascript');
});

it('detects JavaScript from import-from and export', () => {
  expect(detectLanguage("import { parse } from './parse';\nexport function f() { return 1; }\n")).toBe('javascript');
});

it('leaves TypeScript-annotated code unselected (spec §7)', () => {
  expect(detectLanguage('function add(a: number, b: number): number {\n  return a + b;\n}\n')).toBeNull();
  expect(detectLanguage('interface User {\n  name: string;\n}\n')).toBeNull();
});

it('still returns null when genuinely ambiguous', () => {
  expect(detectLanguage('x = 1')).toBeNull();
});
```

Implementation: extend scores with `javascript: 0`; evidence (conservative, strong signals only):

```ts
if (/=>/.test(source)) scores.javascript += 3;
if (/===|!==/.test(source)) scores.javascript += 2;
if (/console\.(log|error|warn)/.test(source)) scores.javascript += 2;
if (/^\s*import\s+.+\s+from\s+['"]/.m.test(source)) scores.javascript += 3;
if (/^\s*export\s+(default\s+)?(function|const|let|class)\b/.m.test(source)) scores.javascript += 3;
if (/(?:^|[^\w$])(?:const|let)\s+\w+\s*[:=]/.m.test(source)) scores.javascript += 1;
if (/\bfunction\s+\w*\s*\([^)]*\)\s*\{/.test(source)) scores.javascript += 2;
```

TS veto after ranking (spec §7 — never route TS to the JS adapter):

```ts
const TS_ANNOTATION = /(\)\s*:\s*[A-Za-z_$][\w$<>[\]]*)|(\w\s*:\s*(string|number|boolean|any|unknown|never|void|Record|Array|Promise)\b)|(^\s*interface\s+\w+)|(^\s*type\s+\w+\s*=)/m;
if (ranked[0][0] === 'javascript' && TS_ANNOTATION.test(source)) return null;
```

Verify the veto does not fire on clean JS (`): number` needs the annotation shape; `arr[mid] === target` has no paren-colon). Run `detect.test.ts` + full unit suite.

- [ ] **Step 3: Pickers + editor (one commit with Step 2)**

`Workbench.tsx`: add `<option value="javascript">JavaScript</option>`; fix both label sites — line 119 `handlePaste` and line 295 `languageLabel` — with a shared shape: `detected === 'cpp' ? 'C++' : detected === 'javascript' ? 'JavaScript' : ...`. (Two call-sites, same rule; a `languageLabel()` helper is justified here — the file already repeats the ternary twice.)

`NewProjectForm.tsx`: add the option after Java.

`CodeEditor.tsx`: `pnpm add @codemirror/lang-javascript`, then:

```ts
import { javascript } from '@codemirror/lang-javascript';
```

```ts
const EXTENSIONS: Record<Language, () => Extension[]> = {
  python: () => [python()],
  cpp: () => [cpp()],
  java: () => [java()],
  javascript: () => [javascript()],
};
```

Update the comment above (`three language functions` → `four`). `Record<Language, ...>` makes a missing entry a type error — `tsc` in Task 6 proves completeness.

- [ ] **Step 4: Persistence — actions + migration (fail first where possible)**

`actions.ts`: `STARTER` gains:

```ts
javascript: `function binarySearch(arr, target) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    else if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
`,
```

`isLanguage` gains `|| v === 'javascript'`; saveSource copy becomes `'Choose Python, C++, Java, or JavaScript.'`.

Migration `supabase/migrations/0007_javascript_language.sql` (constraints are inline, hence auto-named — `IF EXISTS` keeps it re-runnable):

```sql
-- P2: JavaScript joins the language set (spec §9 wiring checklist).
alter table projects drop constraint if exists projects_language_check;
alter table projects add constraint projects_language_check
  check (language in ('cpp','java','python','javascript'));
alter table snapshots drop constraint if exists snapshots_language_check;
alter table snapshots add constraint snapshots_language_check
  check (language in ('cpp','java','python','javascript'));
```

Apply to hosted `gsfosuvhysdesstetwjh` via the Supabase MCP (user runs/approves DDL), then run the RLS suite — 30/30 must hold (constraint widening cannot break policies, but the rule is the rule: do not proceed past red). Then a service-key probe from `/tmp` (never committed) proving end-to-end persistence with cleanup:

```bash
set -a; source .env.local; set +a
# insert temp project + javascript snapshot, read back, delete — all removed afterwards
```

Existing RLS tests keep using `'python'` — no change needed there.

- [ ] **Step 5: Commit the wiring**

```bash
git add src/lib/ir/__fixtures__/isomorphic/ src/lib/ir/isomorphism.test.ts src/lib/ir/detect.ts src/lib/ir/detect.test.ts src/lib/ir/languages/javascript.test.ts src/components/workbench/Workbench.tsx "src/app/(app)/projects/NewProjectForm.tsx" src/components/editor/CodeEditor.tsx "src/app/(app)/projects/actions.ts" supabase/migrations/0007_javascript_language.sql package.json pnpm-lock.yaml
git commit -m "feat: JavaScript isomorphism, detection, pickers, and persistence (P2 Task 5)"
```

---

### Task 6: Verification gate — all green or the phase is not done (spec §12)

**Files:**
- Modify: `PROGRESS.md` (P2 board + decisions — last step)
- Create (temp, `/tmp` only): playwright smoke script (trap 11 pattern — never in repo)

**Interfaces:** None new. This task proves Task 1–5 jointly.

- [ ] **Step 1: Unit + isolation + static gates**

```bash
pnpm test
pnpm vitest run tests/rls.test.ts
pnpm lint && pnpm exec tsc --noEmit
```

Expected: unit all green (339 baseline + ~40 new); RLS 30/30; lint clean; `tsc` clean (proves `Record<Language, ...>` sites are exhaustive).

- [ ] **Step 2: Build + serverless trace check**

```bash
pnpm build
grep -o "tree-sitter-javascript.wasm" .next/server/app/api/inngest/route.js.nft.json | head -n 1
```

Expected: build succeeds; the wasm appears in the trace (the P1 ENOENT lesson — production analysis 500s while local passes if this is missing).

- [ ] **Step 3: Browser smoke for JS — three paste paths, zero console errors (Plan 3 precedent)**

Throwaway `playwright-core` script in `/tmp` against `pnpm dev` (Chromium already in `~/.cache/ms-playwright`): paste the arrow-form binary search, the class-method form, and the declaration form into `/demo`; assert the picker announces JavaScript, the diagram renders 10 nodes, status reaches ready, zero console errors. Also paste a TS-annotated function and assert the picker does NOT claim JavaScript (selection unchanged, spec §7). Eye-check: diamonds for branches, `while` doubled rule, filled cap on returns — the same visual pass Plan 3's smoke did for C++/Java.

- [ ] **Step 4: Existing E2E + a11y + Lighthouse**

```bash
pnpm exec playwright test
```

Expected: E2E 13/13 (axe 10 both themes — no new page structure, so no new violations expected), Lighthouse a11y ≥ 95 on `/`, `/login`, `/demo` (dev-mode perf numbers are recorded honestly, not gated — P1 precedent). Contrast: no token changed, 27/27 stands — state it, do not re-run unless styling was touched (it wasn't).

- [ ] **Step 5: Production check after deploy (spec §12 last line)**

After Vercel deploys the branch: paste JS on live `/demo`, confirm picker detects JavaScript and the diagram renders. Record the result in PROGRESS.md.

- [ ] **Step 6: Handoff + commit**

Update `PROGRESS.md`: P2 task board (6/6 or current count), decision-log entries (boundary verdict, TS veto rule, migration 0007 applied + RLS count, production check result), traps if any. Commit:

```bash
git add PROGRESS.md
git commit -m "docs: P2 JavaScript handoff and verification record (P2 Task 6)"
```

---

## Self-Review

**1. Spec coverage:** §3 grammar+ABI → Task 1 (+ Task 6 trace/smoke for the browser half). §4 boundary review → Task 2 (committed before adapter code; stop-on-gap rule). §5 construct map → Tasks 3 (tests per row) + 4 (goldens). §6 identity/IDs → Task 3 Step 1 tests (shared arrow≡declaration id, `Class.method`, anonymous fold). §7 TS posture → Task 3 annotation-error test + Task 5 veto + Task 6 TS-paste smoke. §8 goldens/isomorphism → Tasks 4 + 5 Step 1 (arrow≡declaration pinned; spec-amendment stop rule on mismatch). §9 wiring checklist → Task 5 (all five + editor + STARTER + migration; worker/Inngest proven by registry design + trace check). §10 gaps → pinned by Task 3 skip-test (getters/setters/object methods) + header comment. §11 budgets → no new runtime deps beyond the grammar (+ CM highlighting); hero untouched; MAX_LAYOUT_NODES unchanged. §12 gate → Task 6 step-for-step.

**2. Placeholder scan:** every step names exact files, exact commands, expected outputs, and real code — no TBD/TODO, no "handle edge cases", no "similar to Task N" (the java.ts pattern is cited for shape, but each block is spelled out), no undefined references (all helpers — `syn`/`span`/`head`/`diagnosticsFor` — exist in `tsnode.ts`).

**3. Type consistency:** `toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] }` matches `Adapter` in `registry.ts`; `Language` gains one variant consumed by `Record<Language, ...>` maps (`EXTENSIONS`, `STARTER`, `scores`) with `tsc` as the exhaustiveness proof; fixture/test naming follows the `cpp`/`java` precedent exactly (`javascript.test.ts`, `__fixtures__/js/`, `.js` ext).

*(Execution handoff: pre-decided — plan + inline implementation in this session via executing-plans. Proceeding to Task 1.)*
