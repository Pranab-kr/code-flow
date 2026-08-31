# PROGRESS

**Single source of truth for "where is this project right now."**
Any agent picking up this repo: read this file first, then `CLAUDE.md`, then the spec.
**Update this file at the end of every work session.** It is the handoff.

---

## Status at a glance

| | |
|---|---|
| **Last updated** | 2026-08-31 |
| **Phase** | P1 (of 4) — foundation |
| **Active plan** | `docs/superpowers/plans/2026-08-31-p1-vertical-slice.md` (Tasks 1–7) |
| **Code written** | **None yet.** Design + plan only. |
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
2. **Grammar WASM build may fail** — `tree-sitter build --wasm` needs docker or emscripten. If
   it does, fall back to a prebuilt package (`@vscode/tree-sitter-wasm`) or a release asset, and
   record which route worked here.
3. **Opencode Zen and NVIDIA NIM base URLs are unverified.** Confirm before wiring (Plan 5).
4. **Aurora has no `references/themes/aurora.md`** in the Hallmark skill. Its palette is derived
   from the atmospheric genre file plus `references/structure.md:102`. Verify contrast gates
   40–41 in both drops rather than trusting the values in Plan 1 Task 1.
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
