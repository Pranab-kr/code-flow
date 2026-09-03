# code-flow P2 — stub (more languages)

> **Status: STUB.** This is not a spec. It exists so the P2 spec author starts
> from the right question instead of from the P1 spec. P2, P3, and P4 each
> need their **own spec** before any plan. Do not start P2 from
> `2026-08-31-code-flow-p1-design.md` beyond the architecture it locks in.

## Goal

JavaScript plus further languages, each rendering correct control-flow
diagrams through the same portable IR (`src/lib/ir/`), the same ELK layout,
and the same canvas — the way C++ and Java joined Python in P1 Plan 3.

## What P1 already proved (reuse, don't re-decide)

- New languages land in `src/lib/ir/languages/*` as tree-sitter → `SynNode`
  adapters; the builder is the wrong place for language knowledge.
- `SynNode` needed **two** boundary extensions for three languages (goto/label
  resolution, `noFallthrough` for arrow switches). The fourth language will
  stress the boundary again — budget an explicit "reconsider the `SynNode`
  boundary" step before adding it, per the 2026-09-01 decision-log entry.
- Cross-language isomorphism fixtures (binary search, BFS, quicksort,
  Fibonacci) are the enforcement mechanism, not an afterthought.
- `pnpm grammars` is a `cp` of prebuilt `.wasm` from each `tree-sitter-<lang>`
  package — verify the next language's package ships one before promising it.
- Paste detection (`detect.ts`), the creation/workbench pickers, persisted
  `snapshots.language`, and the Inngest server parse must all learn the new
  language together, or they disagree (see the 2026-09-01 persistence entry).

## Questions the real spec must answer

1. **Which languages, in which order?** JavaScript is named in the P1 spec's
   phase table; anything beyond that needs a learner-demand argument, not a
   popularity contest.
2. **Grammar availability.** Does each candidate have a prebuilt,
   ABI-compatible wasm (no Docker/emscripten on this machine — P1 verification
   §"grammar blocker")? If not, it is blocked until that changes.
3. **Construct coverage.** Which new control-flow shapes does the language
   bring (e.g. JS `try/finally` + async, pattern matching, generators)? Each
   needs a builder-mapping decision and golden fixtures.
4. **Isomorphism set.** Which algorithms, across which language subset — and
   what a principled mismatch looks like (not every construct exists
   everywhere; "matches except X, because Y" must be written down, not
   discovered in review).
5. **Budgets.** Grammar wasm size per language (the hero stays wasm-free for a
   reason), parse-worker latency, ELK node ceiling (600) re-check.

## Non-goals (these are P3 / P4, not P2)

- **No execution of user code.** No sandbox, no `eval`, no runner. That is P3
  and needs its own threat model + security review.
- **No diagram→code editing.** Tier-1 layout/annotation only. P4, with a
  mandatory diff-review step.
- No new export formats, no new auth surface, no marketing changes beyond
  listing the new languages honestly.

## Verification bar (minimum)

- Golden fixtures per language + isomorphism comparisons green.
- Paste-detection smoke in a real browser for every new language (P1's Plan 3
  smoke caught the ELK worker bug no suite could see).
- `pnpm test`, RLS suite, axe spec, full E2E slice, lint, `tsc`, build,
  contrast 27/27 — the P1 close-out list stays the gate for every phase.
