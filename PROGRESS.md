# PROGRESS

**Single source of truth for "where is this project right now."**
Any agent picking up this repo: read this file first, then `CLAUDE.md`, then the spec.
**Update this file at the end of every work session.** It is the handoff.

---

## Status at a glance

| | |
|---|---|
| **Last updated** | 2026-08-31 (plan API-verified) |
| **Phase** | P1 (of 4) — foundation |
| **Active plan** | `docs/superpowers/plans/2026-08-31-p1-vertical-slice.md` (Tasks 1–7) |
| **Code written** | **None yet.** Design + plan only. |
| **Plan status** | **API-verified 2026-08-31.** 6 blockers + 7 majors + 14 minors found and patched in. |
| **Next action** | Execute Plan 1, Task 1 (scaffold + Hallmark tokens) |

---

## Currently working on

**Nothing in flight.** The design and the first implementation plan are written and committed.
No application code exists yet — `git ls-files` returns docs and config only.

## Next up

**Plan 1, Task 1: Scaffold, tokens, and both themes.**
Open `docs/superpowers/plans/2026-08-31-p1-vertical-slice.md` and work Task 1 step by step.
Every step is a checkbox; tick them as you go.

Use `superpowers:subagent-driven-development` (a fresh subagent per task, reviewed between
tasks) or `superpowers:executing-plans` (inline, batched with checkpoints).

---

## Task board — Plan 1

| Task | Deliverable | State |
|---|---|---|
| 1 | Next.js scaffold, Hallmark Aurora tokens, both themes, `resolveTheme` | ☐ not started |
| 2 | Supabase schema, RLS policies, **negative-path isolation tests** | ☐ not started |
| 3 | IR types + structural node IDs (`IdBuilder`) | ☐ not started |
| 4 | Language-agnostic CFG builder (the 7 hard constructs) | ☐ not started |
| 5 | Python tree-sitter adapter + 12 golden fixtures | ☐ not started |
| 6 | ELK layout + debounced parse worker | ☐ not started |
| 7 | CodeMirror editor, React Flow canvas, project routes, E2E | ☐ not started |

**Plan 1 is done when:** a user signs up, creates a project, pastes Python, and sees a correct
control-flow diagram whose nodes scroll the editor to the matching line.

## Plan verification (2026-08-31)

Before writing any code, every third-party API the plan calls was checked against what
`npm` actually resolves today, and the CFG builder was reviewed as code. Findings were then
adversarially re-checked; **24 corrections were upheld and 10 refuted as overreach.** All
upheld findings are now patched into the plan.

**Resolved versions** (pinned in the plan):

| Package | Version | | Package | Version |
|---|---|---|---|---|
| next | 16.3.3 | | web-tree-sitter | 0.27.0 |
| react / react-dom | 19.2.8 | | tree-sitter-python | 0.25.0 |
| @xyflow/react | 12.11.5 | | tree-sitter-cpp | 0.23.4 |
| elkjs | 0.12.0 | | tree-sitter-java | 0.23.5 |
| @supabase/ssr | 0.12.5 | | vitest | 4.1.11 |
| @supabase/supabase-js | 2.112.4 | | tailwindcss | 4.3.3 |
| @uiw/react-codemirror | 4.25.11 | | typescript | 7.0.2 |

**The grammar blocker is solved — no toolchain needed.** This machine has no Docker and no
emscripten (verified), so the plan's `tree-sitter build --wasm` could never have run. It did
not need to: each `tree-sitter-<lang>` package ships a prebuilt, ABI-compatible `.wasm` at
its root. `pnpm grammars` is now a `cp`. Two traps avoided: `pnpm dlx tree-sitter` resolves
the Node-bindings package, which has **no `bin`**; and `tree-sitter-wasms` carries a legacy
`dylink` section that 0.27 rejects with an *empty* error message.

**Bugs that would have passed their own tests** — the reason this pass was worth doing:

1. `ifStmt` sliced then/else out of one array, so any **multi-statement else** put its extra
   statements in the *then* arm. Every plan test used a one-line else, so the suite would
   have gone green on a wrong graph and frozen it into a golden snapshot.
2. The **elif chain** spread a tree-sitter node (`{...first}`). Those properties are
   prototype getters, so the copy had `type === undefined`, fell through, and returned `[]` —
   silently dropping every clause after the first elif.
3. The **ELK fallback test** was vacuous: `layoutFunction` filters dangling edges before
   calling ELK, so ELK never threw and the test passed via the success path.
4. `Parser.init({locateFile})` **aborts in Node**, and `typeof window !== 'undefined'` is
   false in a web worker — so the browser worker would have taken the Node path.
5. The 5s ELK `Promise.race` timeout is **dead code**: `elk.bundled.js` blocks the thread, so
   the timer cannot fire. Replaced with a `MAX_LAYOUT_NODES = 600` pre-check.
6. `vitest run tests/rls.test.ts` printed **"No test files found"** — a CLI path argument
   filters `include`, never widens it. The mandatory isolation gate could not run at all,
   and `.env.local` was never loaded into `process.env` either.

**Aurora contrast: computed, not assumed.** The derived OKLCH values failed **8 gates in Day
and 3 in Night**. Worst was `node_brdr` on canvas at **1.51:1** — and since spec §10 makes
node *shape* carry meaning, an invisible border is a real a11y defect. Corrected values now
pass **all 27 text and non-text pairs in both themes**. `--color-rule` stays light by design
(1.71:1 / 1.94:1): a decorative divider is exempt from WCAG 1.4.11, and darkening it to 3:1
reads as heavy-handed. **Re-run the contrast check before changing any L value.**

**Also corrected:** `--no-turbopack` no longer exists (Turbopack is the Next 16 default);
`create-next-app` refuses in a non-empty directory yet **exits 0**, so the plan now scaffolds
via `/tmp` and rsyncs in, excluding the `AGENTS.md` that `--agents-md` would overwrite; the
`geist` package is now actually installed and wired (the tokens named fonts nothing loaded);
`Tree` handles are freed alongside the parser (they leak on every keystroke otherwise);
`continue` inside a `switch` inside a loop targeted the discriminant instead of the loop;
`try` walked one handler per *statement* rather than per clause; call edges dropped recursion,
the hero feature.

**Verification gap, stated honestly:** the sweep's React Flow v12, CodeMirror 6, Supabase SSR,
and Next 16 worker/Tailwind dimensions **never completed** — the inference gateway returned
503s and connection-refused across two runs. Contrast math and version resolution were done
directly instead. So **Task 2 and Task 7 code is still unverified**, and two suspected defects
there remain unconfirmed: the plan registers no `edgeTypes` while setting `type: 'ir'` on every
edge, and it styles edges via `.react-flow__edge[data-kind]`, which v12 almost certainly does
not emit from `edge.data`. Re-run the sweep or verify by hand before starting Task 7.

## Roadmap beyond Plan 1

Plans not yet written — each gets its own file, argued from the same spec, written *after* the
previous slice lands so it is informed by real code.

| Plan | Slice | Contents |
|---|---|---|
| 2 | 4–5 | Inngest durable pipeline, Realtime, `layout_overrides` write path + orphan GC |
| 3 | 6 | C++ and Java adapters; cross-language isomorphism tests |
| 4 | 7 | Export PNG / JPEG / SVG, light-background option |
| 5 | 8 | BYOK vault (AES-256-GCM), provider registry, streaming AI chat |
| 6 | 9 | Marketing + auth surface (full Hallmark page flow), a11y + 58-gate slop pass |

Phases P2 (more languages), P3 (flow debug + sandboxed runner), P4 (AI diagram→code editing)
each need their own **spec** before any plan. Do not start them from this spec.

---

## Decision log (append-only)

Newest last. Add an entry whenever you make a call a future agent might otherwise reverse.

### 2026-08-31 — Brief decomposed into four phases
The original brief described four independent subsystems. Building them as one project would
have meant no working software for a long stretch and IR decisions made before any evidence.
Split into P1–P4; P1 designed first.

### 2026-08-31 — Bidirectional diagram↔code editing replaced with a three-tier model
The brief asked that editing the diagram update the code. There is no total function from an
arbitrary hand-edited flowchart back to correct source across C++/Java/Python. Replaced with
tiers: (1) layout/annotation, no source change — **P1**; (2) a closed set of AST transforms —
P4; (3) freeform edits → AI proposes a **reviewed diff** — P4. See spec §3.
**Do not "restore" auto-rewriting.** It silently produces broken code.

### 2026-08-31 — "Wrong diagram shows error in code" deferred to P4
Needs a definition of "wrong". The tractable version is re-deriving the graph from source and
structurally diffing it against the user's graph. Meaningless in P1, where the graph is always
derived and so can never disagree.

### 2026-08-31 — Basic blocks, not statements, as the node granularity
Statement-level graphs make a 40-line solution into 40+ nodes with heavy edge crossing.
Basic blocks land at 10–15. Ternaries and `&&`/`||` stay **inline** — revisit as an opt-in
toggle, never as a default.

### 2026-08-31 — One portable IR module, two call sites
`src/lib/ir/**` must not import React, Next, or DOM globals, so the identical code runs in a
browser worker and (from Plan 2) an Inngest job. Enforced by an ESLint rule, not convention.

### 2026-08-31 — Client uploads source, never a graph
A client-computed graph is spoofable. The server re-derives. Spec §7.

### 2026-08-31 — AI chat streams from a route handler, not Inngest
The brief specified Inngest so the UI would not feel stuck; correct for the analyze job, wrong
for chat, because a queue cannot stream tokens. Inngest owns analyze (P1) and traces (P3).

### 2026-08-31 — Skeleton loader on first load only
The client parses in ~50ms, so a skeleton on every edit would be a loading state for work
already finished. First open only (grammar WASM is a real wait); afterwards, in-place updates.

### 2026-08-31 — ELK over dagre for layout
Back edges are the entire point of a CFG and dagre handles them poorly.

### 2026-08-31 — Node meaning never carried by colour alone
Shape + label required (diamond for branches, doubled rule for loops, filled cap for returns).
Needed for colourblind users and for grayscale export.

### 2026-08-31 — Hallmark: atmospheric genre, Aurora theme, dark default
Audience is learners/interview prep. Both drops fully tokenized. **Aurora Day drops the radial
blooms** — a bloom on light paper is the documented aurora-blob anti-pattern.

### 2026-08-31 — App shell is component-scope, not page-scope, for Hallmark
A three-pane workbench has no macrostructure, nav archetype, or hero. It takes the token
system, the mandatory 8-state discipline, and the slop gates. The marketing/auth surface gets
the full page flow (N13 nav, Ft5 footer).

### 2026-08-31 — Unreachable code is tagged and shown dimmed, not dropped
Statements after a `return`/`break`/`continue` are still emitted, tagged
`meta.unsupported: 'unreachable'`, with no incoming edge, so the canvas can render them
dimmed. A learner sees their dead code instead of watching a line they can see in the editor
vanish from the diagram. Product call, consistent with spec §11's "degrade, never blank".

### 2026-08-31 — SynNode carries `meta.elseBody`; there is no `hasElse`
`children` is the then arm only. The earlier flag-plus-slice design mis-split any else arm
with more than one statement, and its tests could not detect it. Do not reintroduce `hasElse`.

### 2026-08-31 — ELK reverses back edges unconditionally
`cycleBreaking.strategy` chooses *which* edges are reversed, not whether. A laid-out back
edge's endpoints are swapped relative to the IR, so the renderer must take direction from the
IR edge (`kind === 'back'`), never from the ELK section's point order. My original code
comment claimed the opposite.

### 2026-08-31 — MCP key referenced by env var, not inlined
Project-scoped `.mcp.json` is meant to be committed, and `claude mcp add` wrote the key
literally. Moved to `${TWENTYFIRST_API_KEY}`. Note `21ST_API_KEY` is **not** a valid shell
identifier (leading digit) — hence `TWENTYFIRST_API_KEY`.

---

## Known gaps and traps

Things a future agent will otherwise trip over:

1. **`src/lib/ir/languages/registry.ts` will point `cpp` and `java` at the Python adapter** as
   a placeholder so the registry shape is right. It is **not working code**. Plan 3 replaces it.
   Do not ship a C++ or Java language option to users before then.
2. ~~Grammar WASM build may fail~~ **Solved.** Prebuilt `.wasm` ships in each
   `tree-sitter-<lang>` package; `pnpm grammars` is a `cp`. No Docker or emscripten needed.
   Do **not** use `tree-sitter-wasms` (legacy `dylink`, empty error message).
3. **Opencode Zen and NVIDIA NIM base URLs are unverified.** Confirm before wiring (Plan 5).
4. ~~Aurora palette unverified~~ **Solved.** All 27 contrast pairs pass in both themes; the
   token block carries a `CONTRAST-VERIFIED` provenance comment. Re-run the check if you
   change any L value. `--color-rule` is intentionally below 3:1 — decorative, 1.4.11-exempt.
4b. **React Flow v12, CodeMirror, Supabase SSR, and Next 16 worker/Tailwind are still
   UNVERIFIED** (gateway 503s). Two suspected defects in Task 7: no `edgeTypes` registered
   despite `type: 'ir'` on every edge, and `.react-flow__edge[data-kind]` CSS that v12
   probably never emits. Verify before starting Task 7.
5. **Task 7 writes snapshots via a server action directly**, bypassing Inngest, as an interim
   measure. Plan 2 moves that behind the durable pipeline.
6. **Do not proceed past a failing RLS test.** A negative test that passes when it should fail
   means the policy is wrong, not that the test is flaky.

---

## Resume commands

```bash
# Where am I?
cat PROGRESS.md && git log --oneline -10

# Read the design, then the active plan
sed -n '1,120p' docs/superpowers/specs/2026-08-31-code-flow-p1-design.md
sed -n '1,80p'  docs/superpowers/plans/2026-08-31-p1-vertical-slice.md

# Local services (needed from Task 2 onward)
pnpm dlx supabase start          # prints the URL + anon/service keys for .env.local
pnpm dlx supabase status

# Verify (run all of these before claiming a task is done)
pnpm test                        # unit
pnpm vitest run tests/rls.test.ts # isolation — must pass
pnpm exec playwright test        # E2E
pnpm lint && pnpm exec tsc --noEmit

# MCP servers (both should read "Connected")
claude mcp list
```
