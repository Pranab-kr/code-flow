# CLAUDE.md

Guidance for AI agents working in this repository. **Read `PROGRESS.md` first** — it holds the
current state, the next action, and the decision log.

## What this is

**code-flow** turns a pasted DSA solution into a readable control-flow diagram. A learner
pastes binary search in C++, sees its real branch and loop structure as a graph, rearranges it,
asks an AI about it, and exports it. Everything persists per user.

## Read these, in this order

1. `PROGRESS.md` — where the project is right now, what to do next, known traps
2. `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` — the P1 design (the *why*)
3. `docs/superpowers/plans/2026-08-31-p1-vertical-slice.md` — the active plan (the *how*)
4. `docs/product-design.md` — product intent and UX principles
5. `docs/setup.md` — environment variables and how to obtain each one

## The one rule that matters most

**The diagram is a derived view. The code is the only source of truth.**

Every parse regenerates the graph from source, so the diagram can never disagree with the code.
No P1 code path writes source from the graph. If you find yourself implementing "edit the
diagram, update the code", stop and read spec §3 — that is a P4 feature with a mandatory
diff-review step, and auto-rewriting it silently is how this product breaks.

## Architecture in one pass

```
CodeMirror ──source──> web worker ──> parseToIR ──> ProgramIR ──> ELK ──> React Flow
                                          │
   POST source (never a graph)            │  same module, no React/Next imports
            │                             ▼
            └──> Inngest job ──> re-parse authoritatively ──> Postgres ──> Realtime
```

- `src/lib/ir/` — **portable.** Must not import React, Next, or DOM globals. An ESLint rule
  enforces this. It is what lets one implementation run in both a browser worker and a Node job.
- `src/lib/ir/builder.ts` — language-agnostic CFG assembly over a normalized `SynNode` tree.
- `src/lib/ir/languages/*.ts` — per-language tree-sitter → `SynNode` adapters. New languages
  are added **here only**; the builder never changes.
- `src/lib/layout/elk.ts` — IR → positions. ELK, not dagre, because back edges matter.
- `src/components/canvas/` — React Flow views. Presentation only, no IR logic.

## Conventions

- TypeScript `strict`. No `any` in committed code.
- `pnpm`, not npm or yarn.
- **TDD.** Write the failing test, watch it fail, implement, watch it pass, commit. The plans
  are written in that order for a reason.
- Small focused files. If a file is doing two jobs, split it.
- Commit per task, not per session. Messages say *why*, not just what.
- Node IDs are structural (`{functionId}/{path}#{role}`) — see spec §6 before touching `ids.ts`.

## Styling

Every colour and font goes through a token: `var(--color-accent)`, `var(--font-mono)`. **Never
inline a hex or OKLCH value** — if you need a value that has no token, add the token first.

- Theme: Hallmark **Aurora**, atmospheric genre, **dark by default**, light as a full alternate.
- **Aurora Day drops the radial blooms.** A bloom on light paper is a known anti-pattern.
- Motion budget is **three primitives**: node-settle, skeleton crossfade, focus ring (instant,
  never animated). `transform`/`opacity` only. Honour `prefers-reduced-motion`.
- Every interactive element ships **all 8 states**: default, hover, `:focus-visible`, `:active`,
  disabled, loading, error, success.
- **Node meaning is never carried by colour alone** — shape and label do the work, so the
  diagram survives grayscale export and colourblind viewers.
- No italic headers, no gradient text, no glassmorphism, no fake browser chrome.

The `hallmark` skill is vendored at `.claude/skills/hallmark/`. Use it for UI work; it carries
the 58-gate slop test that UI must pass before it is called done.

## Verification — run before claiming anything is done

```bash
pnpm test                          # unit
pnpm vitest run tests/rls.test.ts  # isolation — MUST pass
pnpm exec playwright test          # E2E
pnpm lint && pnpm exec tsc --noEmit
```

**A negative RLS test that passes when it should fail means the policy is wrong.** Do not
proceed, and do not assume the test is flaky.

Report results honestly. If tests fail, say so and show the output. If you skipped a step, say
which.

## Security

- **User API keys (BYOK) never reach the browser.** Server-side proxying only; the client sees
  `provider` and `last4`. AES-256-GCM with AAD bound to `user_id|provider`. See spec §9.
- RLS on every table, keyed through `projects.user_id`. Every table gets a negative test.
- The service-role client (`createServiceClient`) must never be imported into a client component.
- **P1 does not execute user code.** No sandbox, no `eval`, no subprocess. That is P3, and it
  needs its own spec and security review.
- Never commit secrets. `.env.local` and `.claude/settings.local.json` are gitignored; keep it
  that way.

## MCP servers

Both are project-scoped in `.mcp.json` and need approval on first use (`claude mcp list` to check).

- **supabase** — inspect schema, apply migrations, check RLS policies. Useful from Task 2 on.
  It has write features enabled; prefer reading and generating migration files over ad-hoc DDL.
- **21st** — component search. Anything pulled from it **must be adapted**: rewritten to use
  Hallmark tokens, given all 8 states, and run through the slop gates. Never a drop-in.

## Scope discipline

P1 is deliberately bounded. **Not in P1:** executing user code, diagram→code editing, C++/Java
adapters (Plan 3), export (Plan 4), AI chat (Plan 5), the marketing surface (Plan 6).

If a task seems to need something from a later phase, it probably does not — check the spec's
§13 build order. Phases P2–P4 each need their own spec before any plan.

## When you finish a work session

Update `PROGRESS.md`: tick the task board, add a decision-log entry for any call a future agent
might reverse, and record any new trap you hit. That file is the handoff.
