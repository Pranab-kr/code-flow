# code-flow P2 — JavaScript (design spec)

> **Phase:** P2 of 4. **Status:** spec (approved 2026-09-03). Supersedes the
> stub `2026-09-03-code-flow-p2-stub.md` for scope; the stub's process notes
> (boundary review, wasm verification, wiring checklist) still apply.
>
> **Scope decision:** JavaScript only. TypeScript is explicitly deferred (see
> §7). Go is the named next candidate, not part of this phase.

## 1. Goal

A learner pastes everyday JavaScript — a `function` declaration, a
`const f = async (arr, x) => {...}` arrow, a class method — and gets the same
correct control-flow diagram as Python/C++/Java: same portable IR, same ELK
layout, same canvas, same outline view, same export. Nothing about the
diagram layer changes; P2 is one new adapter plus wiring.

## 2. Non-goals

- **TypeScript.** Not a fallback, not best-effort-through-the-JS-grammar.
  TS source through the JS grammar produces ERROR nodes on annotations, and
  silently drawing a diagram of half-parsed code repeats the exact bug class
  P1 fixed (unreported syntax errors → silent wrong answers). The picker
  lists TypeScript as unsupported with honest copy; TS gets its own spec.
- **No execution semantics.** `async`/`await`, generators, promises, and the
  event loop render as ordinary blocks and call-sites with no trace meaning.
  Execution is P3's problem; the spec must say so wherever async appears, so
  no reviewer infers otherwise.
- **No new IR node or edge kinds.** If the adapter cannot be written without
  one, stop: that is a `SynNode` boundary discussion (see §4), not a quiet
  extension.
- No new export formats, auth, marketing structure, or chat changes beyond
  listing JavaScript honestly where languages are listed.

## 3. Grammar and loading

- Package `tree-sitter-javascript@0.25.0`, root file
  `tree-sitter-javascript.wasm` (412KB — same weight class as Python/Java;
  verified present 2026-09-03).
- Wire into `pnpm grammars` (a `cp`, per the P1 pattern — no toolchain).
- **ABI gate:** before any adapter code, a loader probe must parse one
  function with `web-tree-sitter@0.27.0` in Node *and* in the browser worker
  context. P1's `tree-sitter-wasms` lesson stands: legacy `dylink` sections
  fail with an empty error message, so the probe asserts a named node in the
  tree, not just "no throw".
- Serverless trace check: the wasm must appear in
  `.next/server/app/api/inngest/route.js.nft.json` (the `outputFileTracingIncludes`
  mechanism from P1), or production analysis 500s while local passes.

## 4. `SynNode` boundary review (mandatory first step)

Before writing the adapter, the implementer re-reads `builder.ts` against the
JS construct list in §5 and writes down one of two outcomes: "no builder
change needed" or a named, minimal extension proposal with the same
shape as P1's two precedents (label resolution, `noFallthrough`). Expected
outcome is **no change** — the builder already handles `try`/`catch`/`finally`
bodies, all four loop kinds, classic fallthrough switches, and labeled
break/continue. The review exists because Plan 3 declared the builder frozen
and broke it twice; the step may confirm zero, never assume it.

## 5. Construct map (normative)

| JS source | IR / builder mapping |
|---|---|
| `function f() {}`, `const f = () => {}`, `const f = function () {}` | One `FunctionGraph` each (§6) |
| Class methods, including `static` (`class A { m() {} }`) | One `FunctionGraph` each, named `Class.method` |
| `if` / `else if` / `else`, ternaries | Branch; ternaries stay inline (P1 basic-blocks policy) |
| `switch` + `break` | Classic fallthrough arms (the C++ path, not `noFallthrough`) |
| `while`, `do...while`, `for (;;)`, `for...of`, `for...in` | `loop-header` with `while` / `do-while` / `for` / `foreach` |
| `break` / `continue`, labeled and unlabeled | Existing pending-break machinery, labels resolved as in Java |
| `try` / `catch` / `finally` | Existing `try` support (`catchBodies`, `finallyBody`) |
| `return`, `throw` | Existing kinds |
| `await expr`, `yield expr` | Ordinary statements inside their block; no edge, no marker |
| Getters/setters, object-literal methods (`{ m() {} }`) | **Excluded** — parsed but not graphed as functions; listed in §10 as the known gap |
| `eval`, `with` | Parsed as ordinary statements; P1 executes nothing, so there is nothing to sandbox |

## 6. Function identity and IDs

- Signature-derived IDs per spec §6: `f(a,b)` for declarations and assigned
  arrows/functions alike, so `const binarySearch = (arr, target) => ...` and
  `function binarySearch(arr, target)` produce the **same graph id** — required
  for the isomorphism row in §8.
- Class methods: `ClassName.method(params)`. The class name is part of the id,
  so `A.search()` and `B.search()` never collide.
- Anonymous unassigned arrows/functions (callbacks inline in calls) are not
  functions; their bodies fold into the enclosing block as statements.

## 7. TypeScript posture (explicit)

- No `typescript` language value, no TS grammar, no TS fixtures in this phase.
- Anywhere the UI lists languages (creation picker, workbench picker, paste
  detection), TypeScript is either absent or labeled unsupported — never
  silently routed to the JS adapter. Rationale recorded in §2.
- Paste detection (`detect.ts`) must *not* claim TS-annotated code as
  JavaScript: if it detects annotations, it leaves the selection unchanged
  (the conservative rule from P1 Plan 3 Task 4) rather than mislabeling.

## 8. Isomorphism and goldens

- New golden fixtures (12–14, Plan-3 scale) under the existing golden harness,
  covering: arrows vs declarations, class methods, `for...of`, `do...while`,
  classic fallthrough switch, labeled break/continue, try/catch/finally,
  async function (renders as plain blocks).
- Isomorphism comparisons for binary search, BFS, quicksort, Fibonacci gain a
  fourth column: Python = C++ = Java = JavaScript on node kinds, edge kinds,
  and exit counts. The arrow-form and declaration-form JS fixtures must be
  isomorphic to each other by §6's identity rule.
- Principled mismatches are written here, not discovered in review: none
  expected. If one appears (e.g. a construct with no cross-language twin),
  the spec amends this section before the golden freezes it.

## 9. Wiring checklist (all five, together or not at all)

Per the 2026-09-01 persistence lesson, these land in the same plan or the
languages disagree with each other:

1. `registry.ts` + worker grammar load.
2. `detect.ts` evidence rules for JS (conservative; see §7 for the TS guard).
3. Creation picker + workbench picker entries.
4. Persisted `snapshots.language = 'javascript'` through `saveSource` and
   `projects.language` update.
5. Inngest server-side re-parse (same module, same wasm via the trace config).

## 10. Known gaps (honest, not hidden)

- Getters/setters and object-literal methods are not graphed (§5). Rationale:
  they are property semantics, not control flow a learner traces; adding them
  doubles function-identity edge cases for near-zero DSA value.
- `switch` without `break` in non-final arms renders fallthrough edges the
  user may not have intended — same honest rendering as C++; the diagram
  shows the code, not the intent.

## 11. Budgets

- Grammar payload: +412KB wasm, lazy-loaded with the language (never on the
  marketing path — the hero stays wasm-free).
- Parse worker: same ~50ms budget as current languages; measure on quicksort.
- ELK `MAX_LAYOUT_NODES = 600` unchanged; re-check only if a JS golden
  approaches it (not expected — JS hugetime functions are flat).
- No new runtime dependencies beyond `tree-sitter-javascript`.

## 12. Verification (gate — all green or the phase is not done)

- Golden + isomorphism suites pass; loader probe passes in Node and worker.
- Paste-detection browser smoke for JS (all three paste paths, per the Plan 3
  precedent) with zero console errors.
- Full P1 close-out list stays the gate: `pnpm test`, RLS suite, axe spec
  (both themes), full E2E slice, `pnpm lint`, `tsc --noEmit`, `pnpm build`,
  contrast 27/27, Lighthouse a11y ≥ 95 on `/`, `/login`, `/demo`.
- Production check after deploy: paste JS on the live `/demo`, confirm the
  picker detects JavaScript and the diagram renders.
