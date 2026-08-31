# PROGRESS

**Single source of truth for "where is this project right now."**
Any agent picking up this repo: read this file first, then `CLAUDE.md`, then the spec.
**Update this file at the end of every work session.** It is the handoff.

---

## Status at a glance

| | |
|---|---|
| **Last updated** | 2026-09-01 |
| **Phase** | P1 (of 4) — foundation |
| **Deployed** | **LIVE** at https://code-flow-beta.vercel.app |
| **Plan 1** | Tasks 1, 3–7 done. Task 2 (schema/RLS) absorbed into Plan 2. |
| **Plan 2** | **All 5 tasks done. Plan 2 is complete.** |
| **Tests** | 135 unit + 25 integration passing · lint clean · `tsc --noEmit` clean · build succeeds |
| **Blocked on** | Nothing. |
| **Next action** | **Plan 3 (C++/Java adapters)** — the language picker stops lying. See `docs/superpowers/plans/2026-09-01-NEXT-SESSION.md` §2. |

---

## What works right now, in production

```bash
pnpm install && pnpm grammars && pnpm dev   # local
# http://localhost:3000/demo   — no auth, no persistence
# http://localhost:3000/login  — the real app
```

Live: sign in, create a project, edit Python, and the diagram re-derives as you type
(parse → IR → ELK layout → React Flow, all in a worker). Clicking a node scrolls the editor
to its line. Dragged positions persist. The Inngest job re-parses server-side and writes the
authoritative graph.

**Verified in production, not assumed:**
- All routes serve; `/projects` 307s to `/login?next=` when signed out; `/api/inngest` 401s
  behind its signing key.
- Both wasm files serve as `application/wasm` at full size.
- **4 `analyze-snapshot` runs completed.** `graphs` rows contain the correct shape for
  binary search: `entry, basic, loop-header, basic, branch, return, branch, basic, basic,
  return` — 10 nodes, 0 diagnostics.
- One snapshot shows 9 nodes + 1 diagnostic: a mid-typing partial parse, which is spec §11's
  degrade-never-blank behaviour working rather than a bug.

## Environment (hosted, already provisioned)

| | |
|---|---|
| Supabase project | `code-flow` · `gsfosuvhysdesstetwjh` · ap-south-1 |
| Keys | **New format** (`sb_publishable_…` / `sb_secret_…`), not the legacy anon/service_role JWTs |
| Vercel | `code-flow-beta.vercel.app` (NOT `code-flow.vercel.app`) |
| Inngest | app `code-flow`, SDK 4.18.1, 2 functions synced |
| Vercel env vars | All 5 set: Supabase URL + publishable + service-role, Inngest event + signing |
| `BYOK_KEK` | Generated into `.env.local`. **Not** in Vercel — not needed until Plan 5. |

**Auth note:** email confirmation is ON, and Supabase's built-in email is rate-limited and
often never arrives without custom SMTP. Confirm a test user via the admin API, or turn off
Authentication → Sign In / Providers → Confirm email.

## Next up

**`docs/superpowers/plans/2026-09-01-NEXT-SESSION.md`** — read that first. It has the
remaining work in order, with the traps that cost the most time this session.

---

## Task board — Plan 1

| Task | Deliverable | State |
|---|---|---|
| 1 | Next 16 scaffold, Hallmark Aurora tokens, both themes, `resolveTheme` | ✅ `dace3c2` |
| 2 | Supabase schema, RLS policies, **negative-path isolation tests** | ➡️ moved to Plan 2 Task 1 (done there) |
| 3 | IR types + structural node IDs (`IdBuilder`) | ✅ `ea54bfc` |
| 4 | Language-agnostic CFG builder (the 7 hard constructs) | ✅ `02f4848` |
| 5 | Python tree-sitter adapter + 12 golden fixtures | ✅ `58edc0d` |
| 6 | ELK layout + debounced parse worker | ✅ `e2625f7` |
| 7 | CodeMirror editor, React Flow canvas, working demo | ✅ `29e5bae` (routes + E2E deferred with Task 2) |

**Still owed from Task 7:** the full-slice Playwright test. Its load-bearing assertion — a
dragged position survives a reload — is covered by `tests/overrides.test.ts` against the real
database, but not yet through a browser.

## Task board — Plan 2

| Task | Deliverable | State |
|---|---|---|
| 0 | Provision Postgres | ✅ hosted Supabase |
| 1 | Schema, RLS, 16 isolation tests, 0 security advisors | ✅ `5a79dad` |
| 2 | Auth, project routes, persistence | ✅ `9903c26` |
| 3 | Inngest analyze job + orphan GC | ✅ `43f55f7`, fixed in `e043d0a` + `d832b49` |
| 4 | Layout overrides with orphan retention | ✅ `fbbbe9e` |
| 5 | Realtime snapshot status + degrade-never-blank retry | ✅ this session |

## Bugs found by reviewing output rather than trusting green tests

Worth recording, because each would have shipped as a silent wrong answer:

1. **Syntax errors went unreported.** tree-sitter parses `def f(:` into
   `(parameters (MISSING ")"))` with **no ERROR node anywhere** — for a recoverable omission
   it inserts a zero-width node with `isMissing` set. Checking only `type === 'ERROR'` missed
   a whole class of real errors, so the canvas would have drawn a clean diagram of broken code.
2. **`finally: if handle: handle.close()` dropped the close() call.** The whole finally body
   was collapsed into one node, which took the `if`'s condition as its statement text. Found
   by reading the golden snapshot, not by a failing assertion.
3. **React Flow v12 does not reflect `edge.data` to the DOM.** The planned
   `.react-flow__edge[data-kind="back"]` selector could never match, so back edges would have
   rendered identically to forward ones — silently defeating the rule that meaning never
   depends on colour alone. `edge.className` is the supported hook.
4. **ELK reverses back edges unconditionally.** `cycleBreaking.strategy` only picks *which*
   edges get reversed. Loop arrows would have pointed backwards; `layoutFunction` now
   un-reverses against the IR source.
5. **`vite` was unresolvable**, so `loadEnv` — the fix for RLS env loading — would have failed
   silently. pnpm's hoisted symlink pointed at `vite@8.2.2/` while the real directory carries
   a peer-dependency hash. Replaced with a `node:fs` reader.
6. **Diamonds and plain blocks shared one min-width**, so a short condition rendered exactly
   as wide as a short statement and the rotated square clipped its own text.

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

All five remaining plans are **written and committed**. Each states its own prerequisites and
what "done" means, so an agent can pick one up without inferring the order.

| Plan | File | Contents | Blocked? |
|---|---|---|---|
| 2 | `2026-09-01-p1-plan2-persistence.md` | Schema, RLS + 9 negative tests, Inngest analyze job, layout overrides, Realtime | ✅ **complete** |
| 3 | `2026-09-01-p1-plan3-cpp-java.md` | C++ and Java adapters, cross-language isomorphism | No — start any time |
| 4 | `2026-09-01-p1-plan4-export.md` | PNG / JPEG / SVG from the IR, sticky notes | Needs Plan 2 for notes only |
| 5 | `2026-09-01-p1-plan5-byok-chat.md` | AES-256-GCM vault, provider registry, streaming chat | Needs Plan 2 (auth) |
| 6 | `2026-09-01-p1-plan6-marketing-a11y.md` | Marketing surface, graph outline view, a11y + 58 slop gates | Last on purpose |
| 7 | `2026-09-01-p1-plan7-design-system.md` | **Design authority.** Token contract, node shape language, macrostructure pick, 21st.dev sourcing rules, 58-gate sweep | No — Task 1 fixes shipped violations |

**Plan 3 is the one to do next.** It is pure IR work with no database dependency, and it is
where the language picker stops lying about C++ and Java.

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

### 2026-09-01 — Repeated submits are harmless by design
Pressing Create/save several times queues several snapshots and several
`analyze-snapshot` runs. This is CORRECT, not a bug to debounce away: `snapshots` is
append-only, each row owns its own `graphs` row via a unique `snapshot_id`, and
`projects.current_snapshot_id` simply points at the newest. Observed live: 4 runs completed,
3 graph rows written, no duplicates and no lost work.

The client already debounces saves at 1500ms of idle, which is where debouncing belongs. Do
**not** add a server-side lock or dedupe — it would trade a harmless duplicate for a dropped
edit, which is the worse failure.

Worth knowing: a run can be *superseded* rather than wrong. Two rapid edits mean the older
run writes a graph nobody will look at, because `current_snapshot_id` has moved on. That is
wasted work, not incorrect state.

### 2026-09-01 — Grammar wasm is traced into the serverless bundle, not read from public/
`next.config.ts` sets `outputFileTracingIncludes` for `/api/inngest`. Vercel uploads
`public/` to the CDN but does **not** put it on a serverless function's filesystem, so
`parseToIR`'s cwd-relative path was ENOENT in production while working locally.

Do not "simplify" this by deleting the config, and do not switch to `require.resolve()`:
Turbopack cannot analyse a dynamic specifier, and it analyses `parse.ts` for the **browser**
bundle too, since the worker imports it. Verify a change by reading
`.next/server/app/api/inngest/route.js.nft.json` for the four wasm entries.

### 2026-09-01 — Server actions cross to the client via .bind(), never a closure
`saveSource(projectId, language, source)` is ordered so `.bind()` can pin the first two.
React can only serialize a *reference* to a `"use server"` function; wrapping one in
`(s) => save(s, language)` inside a Server Component throws at render and 500s the page.
`bind` fills left to right, which is why the pinned arguments must come first.

### 2026-09-01 — The indicator reports two feeds, and 'saved' means the SERVER stored a graph
`useParse` (browser) and `useSnapshotStatus` (server) are separate facts that routinely
disagree — a good diagram on screen while the queue is unreachable is a normal state, not a
contradiction. `describeStatus` in `src/components/workbench/status.ts` ranks them by what the
user can act on: unsaved edit > work in flight > broken parser > their syntax errors > the
server. It is a pure function precisely so that ranking is testable; do not inline it back
into the JSX ternary it replaced.

The word **`saved` now appears only when the server reports `ready`.** Before this it was
printed whenever a `projectId` existed and the local parse was clean, which claimed durability
the app had not confirmed. With no word from the server yet the label is `ready`, which
describes the diagram truthfully without guessing.

A `failed` status adds a label and a retry button. **It never clears the canvas** (spec §11).
`retryAnalysis` re-sends the event for the existing snapshot rather than inserting a new one:
the source is unchanged, so another row would be history recording no edit.

### 2026-09-01 — saveSource returns the new snapshot id
Every edit appends a snapshot, so a client holding only the id the page loaded with would sit
watching a row that stopped being current several edits ago. The action returns
`snapshotId` and the Workbench re-points its subscription. This is still source-up-only —
an id is not a graph, and the server derived it.

### 2026-09-01 — Only `snapshots` is published to Realtime
Not `graphs` (the client already has its own local parse on screen) and not `layout_overrides`
(the dragging client authors those, so echoing them back would fight the pointer). REPLICA
IDENTITY stays DEFAULT: `status` and `error` are in the new row of an UPDATE either way, and
FULL would only add the old row at the cost of a bigger WAL record on every write.

Publishing a table does **not** widen who can read it — Realtime authenticates the socket with
the user's access token and evaluates the same policies before delivery. `tests/realtime.test.ts`
asserts that with a live control rather than trusting it.

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
4b. ~~React Flow v12 unverified~~ **Resolved.** Both suspected defects were real and are
   fixed: v12 does not reflect `edge.data` to the DOM (styling goes through
   `edge.className`), and only built-in edge types are used so nothing can go unregistered.
   CodeMirror and Supabase SSR were verified by building against them.

5. **"Works in `pnpm dev`" is not evidence for a serverless deploy.** This cost the most
   time this session. Local Node has `cwd` = repo root and a real `public/`; a Vercel
   function has neither. Two bugs shipped green because local state masked them — the wasm
   ENOENT above, and the grammar packages that were never in `package.json` (a `pnpm add`
   populated `node_modules` but the manifest write failed on a build-script gate, so every
   local test passed while a fresh clone would install nothing). **Test from a clean clone
   and read the build's trace output** before believing a deploy is sound.

6. **pnpm 12 breaks on Vercel** — its launcher script fails to parse
   (`line 4: syntax error near unexpected token ')'`) before reading the lockfile.
   `packageManager` is pinned to `pnpm@10.34.5`. Note the build-script allowlist key is
   `onlyBuiltDependencies` in pnpm 10 and was renamed `allowBuilds` in 11+; pnpm 10 silently
   **ignores** the newer name, which would let postinstall scripts run on the build image.

7. **Do not report a success through the error channel.** Signup returned "check your email"
   as `error`, so a created account rendered in a red box and read as a failure.
   `AuthResult` now has a separate `notice` field. Watch for this shape elsewhere.
8. **Realtime `SUBSCRIBED` does not mean postgres_changes is attached.** The channel callback
   reports `SUBSCRIBED` first; the Postgres replication connection is wired up a moment later
   and announced by a separate `system` event (`extension: 'postgres_changes', status: 'ok'`).
   **An UPDATE fired in that window is silently lost.** My first `tests/realtime.test.ts`
   triggered on `SUBSCRIBED` and timed out against a feature that worked perfectly — proven by
   a standalone script that waited 6s and received the event.

   The dangerous half: the **negative** RLS case passed in that same broken run, because the
   write raced the subscription rather than because the policy blocked it — exactly trap 8's
   "a negative test that passes when it should fail". Opt in with
   `channel(name, { config: { broadcast: { replication_ready: true } } })`, wait for the
   `system` event, and give every negative Realtime test a **live control**: subscribe the
   owner and the intruder to the same row, fire one UPDATE, and assert the owner received it.
   Silence for the intruder then means the policy and nothing else.

9. **Task 7 writes snapshots via a server action directly**, bypassing Inngest, as an interim
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
