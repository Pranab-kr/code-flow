# NEXT SESSION — start here

> **You are picking up a live, deployed project.** Read this file, then `PROGRESS.md`, then
> `CLAUDE.md`. Do not start from the P1 spec as though nothing exists — most of it is built.

**Written:** 2026-09-01, at the end of the session that deployed the app.

---

## 60-second orientation

```bash
cd /home/pranab/proj/codeflow
pnpm install && pnpm grammars     # grammars is REQUIRED: public/grammars/ is gitignored
pnpm test && pnpm test:rls        # 111 unit + 22 integration, all should pass
pnpm dev                          # http://localhost:3000/demo needs no auth
```

| | |
|---|---|
| Live | https://code-flow-beta.vercel.app (**-beta**, not `code-flow.vercel.app`) |
| Repo | https://github.com/Pranab-kr/code-flow |
| Supabase | project `code-flow` · `gsfosuvhysdesstetwjh` · ap-south-1 |
| Inngest | app `code-flow`, SDK 4.18.1, both functions synced and completing |
| Secrets | `.env.local` (gitignored, already filled). All 5 vars set in Vercel too. |

**What works in production, verified not assumed:** sign in → create project → edit Python →
diagram re-derives as you type → drag nodes → reload → positions hold. The Inngest job
re-parses server-side and writes the authoritative graph (4 runs completed, 3 graph rows,
correct 10-node shape for binary search).

---

## Do these in order

### 1. Plan 2 Task 5 — Realtime status (small, finishes Plan 2)

`docs/superpowers/plans/2026-09-01-p1-plan2-persistence.md` § Task 5.

The workbench status indicator currently shows the *client's* parse state. It should also
reflect the *server's* snapshot status, which is already written correctly by the Inngest job
(`queued → parsing → ready`, or `failed` with a reason).

1. Migration: `alter publication supabase_realtime add table snapshots;`
2. `useSnapshotStatus(snapshotId)` subscribing to `postgres_changes` on that row; unsubscribe
   on unmount.
3. Wire it into `src/components/workbench/Workbench.tsx`, which already has a `saveState`
   union to extend.
4. **A `failed` status must keep the last good diagram on screen** with a retry affordance —
   spec §11, degrade never blank. Never a blank canvas.

Verify by editing code on the live site and watching the dot go `parsing → ready` with no
reload.

### 2. Plan 3 — C++ and Java (the biggest user-facing win)

`docs/superpowers/plans/2026-09-01-p1-plan3-cpp-java.md`. Self-contained, no database or
deploy dependency, and it is where the language picker stops lying.

Right now `NewProjectForm.tsx` hard-codes `language="python"` with a hint saying "C++ and Java
are next", because `registry.ts` aliases both to the **Python adapter** as a placeholder. That
is not working code. Remove the restriction only when the adapters exist.

The plan freezes `builder.ts` on purpose: new per-language behaviour belongs in an adapter. If
you genuinely cannot express a construct in `SynNode`, stop and record why in `PROGRESS.md`
before widening the shared type.

Ends in cross-language isomorphism tests — binary search in all three languages must yield the
same graph shape. That test is what keeps the IR honest; expect it to fail at first, and fix
the adapter that normalizes less rather than the comparison.

### 3. Then pick from

- **Plan 4** export (PNG/JPEG/SVG drawn from the IR) — no external dependency.
- **Plan 5** BYOK + AI chat. `BYOK_KEK` is already generated in `.env.local` but **not** in
  Vercel; add it there when starting this. Storage design is settled: server-side encrypted,
  keys never reach the browser. Do not revisit that without reading spec §9.
- **Plan 6** marketing + a11y. Last on purpose: the hero embeds the real canvas.
  **Read Plan 7 first** — it is the design authority Plan 6 consumes.
- **Plan 7** design system + anti-slop pass. **Task 1 fixes violations already shipped**
  (two neutrals below the gate-22 chroma floor; `☀`/`⚠` render as colour emoji on some
  platforms, tripping gate 30 and breaking grayscale export). Do Task 1 whenever you next
  touch UI, regardless of which plan you are on.
- **Owed from Plan 1 Task 7:** the full-slice Playwright test. Its key assertion (a dragged
  position survives a reload) is covered by `tests/overrides.test.ts` against the real
  database, but not yet through a browser.

---

## Traps that cost real time this session

Read these. Each one shipped green before it was caught.

**1. "Works in `pnpm dev`" is not evidence for a serverless deploy.** Local Node has
`cwd` = repo root and a real `public/`; a Vercel function has neither. The Inngest job failed
in production with `ENOENT: open 'public/grammars/tree-sitter-python.wasm'` even though I had
verified `parseToIR` in Next's Node runtime locally. Fixed via `outputFileTracingIncludes` in
`next.config.ts` — **verify a change there by reading
`.next/server/app/api/inngest/route.js.nft.json` for the four wasm entries**, not by assuming.

Do not replace that config with `require.resolve()`: Turbopack cannot analyse a dynamic
specifier, and it analyses `parse.ts` for the **browser** bundle too, since the worker
imports it.

**2. Test from a clean clone.** The three `tree-sitter-*` packages were missing from
`package.json` for several commits — a `pnpm add` populated `node_modules` but the manifest
write failed on a build-script gate. Every local test passed because `public/grammars/` had
already been filled by hand. A fresh clone would have installed no grammars at all.

**3. Server actions cross to the client via `.bind()`, never a closure.** Passing
`(source) => save(source, language)` from a Server Component 500s the page: React can only
serialize a *reference* to a `"use server"` function. `saveSource(projectId, language, source)`
is ordered so `.bind()` can pin the first two — `bind` fills left to right.

**4. pnpm 12 breaks on Vercel** (`line 4: syntax error near unexpected token ')'` in pnpm's
own launcher, before it reads the lockfile). Pinned to `pnpm@10.34.5`. The build-script
allowlist key is `onlyBuiltDependencies` in pnpm 10 and `allowBuilds` in 11+; **pnpm 10
silently ignores the newer name**, so do not "modernize" `pnpm-workspace.yaml`.

**5. Never report a success through the error channel.** Signup returned "check your email" as
`error`, so a created account rendered in a red box and read as a failure. `AuthResult` now
has a separate `notice` field. Watch for the same shape elsewhere.

**6. Supabase's confirmation email usually never arrives** (rate-limited, no custom SMTP).
Confirm test users via the admin API with the service-role key, or turn off
Authentication → Sign In / Providers → Confirm email.

**7. Repeated submits are fine.** Several presses queue several snapshots and several runs.
`snapshots` is append-only, each row owns its own `graphs` row, and `current_snapshot_id`
points at the newest. **Do not add a server-side lock or dedupe** — it would trade a harmless
duplicate for a dropped edit. The client already debounces at 1500ms of idle, which is where
debouncing belongs.

**8. A negative RLS test that passes when it should fail means the policy is wrong.** There
are 16 isolation tests, 12 of them negative. Do not weaken one to get green, and re-run
`pnpm test:rls` after **any** policy change — moving the helpers to a `private` schema
required exactly that.

---

## Ground rules worth restating

- **The diagram is derived. The code is the only source of truth.** No P1 path writes source
  from the graph. If you find yourself building "edit the diagram, update the code", read
  spec §3 — that is P4, and it needs a review-gated diff.
- **The client uploads source, never a graph.** The server re-derives. A client graph is
  forgeable, and the server has to reason about it (AI grounding now, traces in P3).
- **`src/lib/ir/**` imports no React, Next, or DOM globals.** An ESLint rule enforces it. That
  is what lets one module run in a browser worker and a Node job.
- **Node meaning is never carried by colour alone** — shape and label do the work, so the
  diagram survives grayscale export.
- Run `python3 scripts/check-contrast.py` after touching any token. All 27 pairs must pass in
  both themes. Note Lightning CSS downlevels OKLCH to hex at build time, so also check the
  built CSS if you change a lightness value.
- P2, P3, and P4 each need **their own spec** before any plan. P3 is the first phase that
  executes user code — sandboxed runner, own threat model, security review. P1 deliberately
  has no `eval`, no subprocess, no sandbox.

## Before you say anything is done

```bash
pnpm test                          # 111 unit
pnpm test:rls                      # 22 integration — MUST pass
pnpm lint && pnpm typecheck
pnpm build                         # runs `pnpm grammars` first
python3 scripts/check-contrast.py  # if tokens changed
```

Report honestly. If something fails, show the output. If you skipped a step, say which.
Then update `PROGRESS.md` — task board, a decision-log entry for anything a future agent might
reverse, and any new trap. That file is the handoff.
