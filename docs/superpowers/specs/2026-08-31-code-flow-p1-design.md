# code-flow — P1 Foundation Design

**Date:** 2026-08-31
**Status:** Approved (design gate passed)
**Phase:** P1 of 4
**Supersedes:** nothing

---

## 1. Product in one paragraph

code-flow turns a pasted DSA solution into a readable control-flow diagram, then lets the
author study it, rearrange it, ask an AI about it, and export it. The diagram is a **derived
view of the source** — the code is always the single source of truth. A learner pastes a
binary search in C++, sees its real branch and loop structure as a graph, drags the nodes
into a shape that makes sense to them, asks "why does this loop terminate?", and exports a
PNG for their notes. Everything persists, so reopening the project restores both the code
and their arrangement.

**Primary audience:** learners and interview-prep candidates. This decides several
arguments downstream — explanatory empty states over information density, sane defaults over
configurability, and (in P3) the recursion tree as the hero feature.

---

## 2. Scope boundary

The original brief describes four independent subsystems. It was decomposed; this spec
covers **P1 only**.

| Phase | Contents | Status |
|---|---|---|
| **P1** | Auth, projects, editor, Inngest pipeline, static CFG for C++/Java/Python, layout persistence, export, read-only AI chat | **This spec** |
| P2 | JavaScript + more languages via the same IR | Later spec |
| P3 | Flow debug: sandboxed runner, execution traces, recursion tree | Later spec |
| P4 | AI-assisted diagram→code editing behind diff review | Later spec |

### Explicitly out of scope for P1

- **Any code mutation from the diagram.** No AST transforms, no AI writing to the editor.
  P1's diagram is read-only with respect to source. This is the single most important
  boundary in the spec — see §3.
- **Executing user code.** No sandbox, no traces, no runner service. P1 is pure static
  analysis. Nothing in P1 runs untrusted code.
- Collaboration, sharing, public links, teams.
- Diagram→code structural diffing ("wrong diagram shows error"). Deferred to P4, where the
  code-editing path makes it meaningful.

---

## 3. The derived-view principle (load-bearing)

The brief asked for a bidirectional editor: change the diagram, and the code changes to
match. **That round trip is not reliably solvable** for arbitrary graph edits across
C++/Java/Python — there is no total function from a hand-edited flowchart back to correct
source. Attempting it silently produces broken code, which is worse than not offering it.

The resolution is a three-tier edit model. **P1 ships tier 1 only.**

| Tier | Edit kind | Effect on source | Phase |
|---|---|---|---|
| 1 | Layout, collapse, annotation | **None.** Stored separately from the graph. | **P1** |
| 2 | Closed set of AST transforms (rename, invert branch, extract function) | Deterministic source rewrite | P4 |
| 3 | Freeform graph edit | AI proposes a **diff the user reviews and accepts** — never auto-applied | P4 |

Because P1 has no tier 2 or 3, the diagram can never disagree with the code: it is
regenerated from source on every parse. This is what makes P1 safe to build first and is
why "diagram shows error in code" is deferred rather than faked.

---

## 4. Stack

| Concern | Choice | Why this and not the obvious alternative |
|---|---|---|
| Framework | Next.js 15, app router, TypeScript strict | Server routes for BYOK proxying; Vercel-native |
| DB / Auth | Supabase (Postgres + Auth + RLS + Realtime) | RLS gives per-user isolation at the DB, not just the app layer |
| Jobs | Inngest | Durable steps, retries, and it is what P3's long trace runs will need |
| Editor | **CodeMirror 6** | Monaco is ~2MB; we already pay for WASM grammars. CM6 is ~400KB and its Lezer/tree-sitter-shaped model fits our IR work |
| Canvas | `@xyflow/react` (React Flow v12) | Named in the brief; mature custom-node API |
| Layout | **`elkjs`** (layered) | Handles CFG **back edges** far better than dagre — loops are the whole point here |
| Parsing | `web-tree-sitter` + C++/Java/Python grammars | Error-tolerant (partial parse still renders), one WASM runtime, runs in browser AND Node |
| AI | Vercel AI SDK, server routes | Streaming belongs in a route handler, not a queue |
| Styling | Tailwind v4 carrying Hallmark tokens | `@theme inline` maps Hallmark tokens to utilities |
| Testing | Vitest, Playwright, axe-core | — |

**No monorepo.** The IR builder lives at `src/lib/ir/` as a portable module with **zero React
and zero Next imports**. That constraint is what lets the identical code run in a browser
worker and in an Inngest job — it is enforced by a lint rule, not just convention.

---

## 5. The IR

One `ProgramIR` per snapshot, normalized across all three languages.

```ts
type NodeKind =
  | 'entry' | 'exit' | 'basic' | 'branch' | 'loop-header'
  | 'switch' | 'return' | 'throw' | 'call-site';

type EdgeKind =
  | 'seq' | 'true' | 'false' | 'case' | 'default'
  | 'back' | 'break' | 'continue' | 'exception' | 'call';

interface IRNode {
  id: string;              // stable structural id — see §6
  kind: NodeKind;
  label: string;           // rendered text, already truncated for display
  statements: string[];    // source lines collapsed into this block
  span: { startLine: number; endLine: number };  // 1-based, for editor sync
  meta?: { loopKind?: 'while'|'for'|'do-while'|'foreach'; caseValue?: string };
}

interface IREdge {
  id: string; source: string; target: string;
  kind: EdgeKind;
  label?: string;          // 'true' | 'false' | 'case 3' | 'break'
}

interface FunctionGraph {
  id: string;              // signature-derived, overload-safe: 'binarySearch(int*,int)'
  name: string;
  params: string[];
  nodes: IRNode[]; edges: IREdge[];
  entryId: string; exitIds: string[];
}

interface ProgramIR {
  language: 'cpp' | 'java' | 'python';
  functions: FunctionGraph[];
  callEdges: { from: string; to: string; nodeId: string }[];
  diagnostics: Diagnostic[];   // parse errors — partial IR is still valid
  irVersion: number;           // bump to invalidate persisted graphs
}
```

### Granularity: basic blocks

A node is a **basic block** — a maximal run of straight-line statements with one entry and
one exit. Branches, loop headers, and switches become their own nodes. A 40-line solution
lands around 10–15 nodes, which stays readable.

**Deliberately kept inline** (they do not become nodes): ternaries, and short-circuit
`&&`/`||`. They are real control flow, but expanding them turns every compound condition
into a hairball, and for a learner audience the cost outweighs the fidelity. Recorded here
so a later phase can revisit it as an opt-in toggle rather than rediscover it as a bug.

### The constructs that break naive CFG builders

These are the acceptance criteria for the IR, not edge cases to handle later:

1. **C++ `switch` fallthrough** — a case body without `break` gets an implicit `seq` edge to
   the next case body. Modelling each case as isolated is the classic bug.
2. **`goto` and labels (C++)** — real edges to the labeled statement. May produce
   irreducible graphs; ELK must not be assumed to produce a tidy tree.
3. **Java labeled `break`/`continue`** — targets the *labeled* statement's exit, not the
   innermost enclosing loop.
4. **`try`/`finally` (all three)** — the `finally` block is reachable from every exit path of
   the `try`, including `return` inside it.
5. **Python `for`/`while` + `else`** — the `else` clause runs on normal loop exhaustion, not
   on `break`. Two distinct exit edges.
6. **Multiple returns** — `exitIds` is a list. A single-exit assumption breaks immediately.
7. **C++ range-for / Java foreach / Python for** — normalize to `loop-header` with
   `meta.loopKind: 'foreach'`, so the three languages render identically.

---

## 6. Stable node IDs

The most consequential detail in the spec. Because the diagram is derived, **every parse
produces a fresh graph** — so something must decide which new node corresponds to which old
one, or the user's dragged layout is destroyed on every keystroke.

IDs are **structural, not positional**:

```
{functionId}/{structuralPath}#{role}

binarySearch(int*,int)/while@0/if@1/then/b0
```

- `functionId` is signature-derived, so C++/Java overloads do not collide.
- Each control structure is indexed among **same-kind siblings in its parent scope**
  (`while@0`, `if@1`).
- `role` disambiguates branch arms (`then`, `else`, `case:3`) and block ordinal (`b0`).

### Stated consequences (tested directly, not hoped for)

| Edit | IDs survive? |
|---|---|
| Change statements *inside* a block | ✅ Yes — the layout holds |
| Rename a variable | ✅ Yes |
| Add a statement to an existing block | ✅ Yes |
| Add a new `if` *before* an existing one | ⚠️ No — sibling indices shift; later structures get new IDs |
| Reorder two loops | ⚠️ No |
| Rename a function | ⚠️ No — that function's subtree re-IDs |

This is predictable and acceptable: the common case (editing statements) preserves layout,
and the shifting case is a structural edit where re-layout is defensible. Orphaned overrides
are retained, not deleted — see §8.

---

## 7. Data flow

Two paths, **one IR module**.

### Instant path (client)
Keystroke → 400ms debounce → **web worker** → parse → ELK layout → merge saved overrides →
render. Not persisted. The worker keeps the main thread free so typing never stutters.

### Durable path (server)
On editor idle (1.5s) → `POST /api/snapshots` writes the source → emits Inngest
`code.submitted` → job re-parses **authoritatively**, lays out, reconciles overrides,
writes `graphs`, broadcasts on Supabase Realtime → client swaps to the server graph.

The server graph is the source of truth for anything the server must reason about (AI
grounding now, traces in P3). The client never uploads a graph it computed — only source.
An untrusted, spoofable graph must never become server state.

### Revision from the brief: AI does not go through Inngest

The brief specified Inngest so the UI would not feel stuck. That is right for the analyze
job. It is **wrong for AI chat**: a queue cannot stream tokens. Chat streams directly from a
Next route handler via the AI SDK. Inngest owns the analyze job in P1, and the trace runs in
P3.

### UX improvement over the brief: the skeleton is first-load only

The brief asked for a skeleton loader on every submit. Since the client parses locally in
~50ms, a skeleton on every edit would be **showing a loading state for work already done**.
So: skeleton on first project open (grammar WASM is still downloading — a real wait), and
after that, edits update in place. A small "syncing" dot indicates the durable write.

### WASM grammar loading

Grammars are 1–3MB each and are **lazy-loaded per language on first use**, cached in the
Cache API, and never bundled into the main chunk. Loading all three eagerly would be the
single worst thing we could do to first paint.

---

## 8. Database schema

All tables are RLS-protected, keyed through `projects.user_id`. No table is readable with the
anon key without a policy match.

| Table | Purpose | Notes |
|---|---|---|
| `profiles` | 1:1 with `auth.users` | `theme_pref` ('dark'\|'light'\|'system'), `display_name` |
| `projects` | A saved piece of work | `user_id`, `title`, `language`, `current_snapshot_id` |
| `snapshots` | **Append-only** source history | `project_id`, `source`, `language`, `status` ('queued'\|'parsing'\|'ready'\|'failed'), `error` |
| `graphs` | Derived IR + auto layout | `snapshot_id` (unique), `ir` jsonb, `layout` jsonb, `ir_version` |
| `layout_overrides` | **User's** node positions | `project_id`, `node_id` (stable id), `x`, `y`, `collapsed`, `orphaned_at` |
| `annotations` | Sticky notes | `project_id`, `node_id` (nullable — free-floating allowed), `body`, `x`, `y` |
| `chat_threads` | One per project | `project_id`, `title` |
| `chat_messages` | Chat history | `thread_id`, `role`, `content`, `provider`, `model`, `node_context` jsonb |
| `user_provider_keys` | Encrypted BYOK keys | See §9. **Never** exposed to the anon key |

### Why `layout_overrides` is a separate table from `graphs.layout`

`graphs.layout` is **disposable** — regenerated by ELK on every parse. `layout_overrides` is
**precious** — it is the user's manual arrangement, keyed by stable node ID and scoped to the
*project*, not the snapshot, so it survives every re-parse.

When a node ID vanishes from the IR, its override is **not deleted**. It is stamped
`orphaned_at` and retained **30 days**, then GC'd by a scheduled Inngest job. Reason: a
transient syntax error mid-typing can make a node disappear for one parse. Hard-deleting on
disappearance would destroy an arrangement the user spent real time on because they typed a
stray brace. If the ID reappears, `orphaned_at` is cleared and the position is restored.

---

## 9. BYOK provider keys — threat model and design

Users supply their own API keys for six providers: OpenAI, Anthropic, OpenRouter, Google AI
Studio, Opencode Zen, NVIDIA NIM.

### Rules

1. **Keys never reach the browser after submission.** Not on read, not masked, not ever. The
   client sees only `provider`, `label`, and `last4`.
2. **All provider calls are server-side.** No client-direct provider requests, which also
   avoids CORS and rate-limit leakage.
3. **Encrypted at rest with AES-256-GCM**, not merely "stored in a private table".
   - Random 96-bit IV per record, stored alongside.
   - **AAD bound to `user_id|provider`** — a ciphertext moved to another user's row fails to
     decrypt rather than silently working.
   - KEK from `BYOK_KEK` env, with a `key_version` column so rotation is possible without a
     destructive migration.
4. **Table accessed via service role only**, from server routes. RLS denies all anon access
   outright, so a leaked anon key exposes nothing.
5. **Redacted from logs and error reports** by an explicit denylist on the key field.

### Honest limit

An env-var KEK means a **database** leak alone does not expose keys, but a **full server**
compromise does — the KEK is in the same process. Upgrade path is Supabase Vault or a cloud
KMS; not worth the P1 complexity, and stated here so it is a decision rather than an
oversight.

### Provider base URLs

OpenAI, Anthropic, OpenRouter, and Google AI Studio are well-known. **Opencode Zen and NVIDIA
NIM base URLs and OpenAI-compatibility must be verified at implementation time** — they are
not assumed here. The provider registry is a table of
`{ id, label, baseUrl, auth, openaiCompatible, models[] }` so an unverified provider is one
row to fix, not a code change.

---

## 10. UI / UX (Hallmark)

**Pre-flight:** empty project — no tokens, fonts, framework, or motion library to preserve.
Full Hallmark stack introduced. First run, so no `.hallmark/log.json` diversification
constraint.

**Genre: atmospheric** (dark-default), per `references/genres/atmospheric.md`.
**Audience: learners + interview prep.**

### Two surfaces, deliberately different treatment

Hallmark's page flow (macrostructure, nav/footer archetypes, hero enrichment) is built for
pages. code-flow's app shell is a three-pane workbench, where macrostructure does not apply.
So:

| Surface | Hallmark treatment |
|---|---|
| Marketing + auth | **Full page flow.** Theme Aurora · Nav N13 inline ⌘K-pill · Footer Ft5 Statement |
| App shell (editor/canvas/chat) | **Component scope.** Tokens, mandatory 8-state discipline, slop gates. No macrostructure — stated explicitly, not skipped silently |

Nav/footer picks are within the atmospheric routing table's allowed set (N13 and Ft5 are both
listed for atmospheric) and avoid N1a and Ft3, which Hallmark bans as the recognizable AI
fingerprints.

### Theme: Aurora + a defined light drop

Aurora is dark paper (L < 30%), cool-cyan accent (~200°), sans display with serif body.
There is **no `references/themes/aurora.md`**, so its definition is derived from
`references/structure.md:102` and the atmospheric genre file. A cool accent is a documented
Aurora-specific departure from the genre's warm-accent default; cyan also reads correctly for
a developer tool.

Dark mode was a stated requirement, so **both drops are fully tokenized**:
- **Aurora Night** (default, designed-for): dark paper, cyan accent, up to two fixed radial
  blooms at ~20–30% footprint (allowed for atmospheric under gate 29; never animated).
- **Aurora Day**: light paper alternate. Same accent hue, re-tuned for contrast. **Blooms are
  dropped entirely** in Day — a bloom on light paper is the aurora-blob anti-pattern
  (`anti-patterns.md:91`).

Persisted to `profiles.theme_pref` + localStorage, with the class applied pre-paint to avoid
a flash.

### App shell layout

```
┌──────────────────────────────────────────────────────────────┐
│  N13 pill nav · project title · ⌘K · theme · avatar          │
├───────────────┬──────────────────────────────┬───────────────┤
│  EDITOR       │  CANVAS (dominant)           │  ASK (toggle) │
│  CodeMirror   │  React Flow                  │  chat, node-  │
│  lang badge   │  fn tabs · fit · export      │  grounded     │
│  diagnostics  │  minimap on >30 nodes        │               │
└───────────────┴──────────────────────────────┴───────────────┘
   resizable, persisted           < 768px: tabs [Code|Diagram|Ask]
```

### Node semantics never rely on colour alone

Required for colourblind users and for grayscale export:

| Node | Shape / non-colour cue |
|---|---|
| `branch` | Diamond + `true`/`false` **edge labels** |
| `loop-header` | Doubled left rule + `↻` |
| `return` | Filled left cap |
| `throw` | Dashed border |
| `call-site` | Chevron right edge, click to jump to that function |
| Back edge | Dashed, curved, labelled with the loop kind |

### Motion — capped at three primitives

Per Hallmark's hard rule, and atmospheric's "fade-in only, the atmosphere does the work":
1. **Node settle** on relayout — `transform`/`opacity` only, 180ms, `--ease-out`.
2. **Skeleton → content** crossfade, 140ms.
3. **Focus ring** — appears **instantly**, never animated.

`prefers-reduced-motion: reduce` collapses 1 and 2 to a ≤150ms opacity crossfade. No
animated blooms, no glassmorphism, no gradient text, no italic headers.

### Component sourcing (21st.dev MCP)

The `21st` MCP server is registered at project scope for component search. Any component
pulled from it **must be adapted before use**: rewritten to reference Hallmark tokens by name
(no inlined hex/OKLCH — locked-tokens discipline), given all 8 states, and run through the
slop-test gates. Sourced markup is a starting point, never a drop-in.

---

## 11. Errors and limits

**Degrade, never blank.** tree-sitter is error-tolerant by design, so:

| Failure | Behaviour |
|---|---|
| Syntax error | **Partial graph still renders** + gutter diagnostics + banner naming what failed. The last good graph stays visible beneath a "showing last valid diagram" notice |
| Unsupported construct | Node renders with `⚠` and a plain-English tooltip; the graph is still whole |
| Inngest job fails | Local client graph stays visible; status dot turns amber; explicit retry offered. Never a blank canvas |
| Grammar WASM fails to load | Named error + retry. Other languages unaffected |
| No AI key configured | Chat panel shows a setup prompt, not an error |
| Provider 401 / 429 | Mapped to plain language ("your OpenAI key was rejected"), never a raw dump |

**Limits:** 2000 lines or 100KB per snapshot (rejected with a clear message, not truncated
silently). Above ~400 nodes, function subgraphs auto-collapse with an expand affordance.
ELK runs with a 5s timeout, falling back to a simple layered placement.

---

## 12. Testing strategy

TDD on the IR builder — it is pure, deterministic, and the highest-value thing to test first.

| Layer | Tests |
|---|---|
| **IR golden files** | ~30 fixtures per language (90 total): every construct in §5's list. Source in → serialized IR snapshot out |
| **Stable IDs** | Edit statements inside a block, assert **IDs unchanged**. Insert a structure before another, assert the documented shift. This encodes §6's table as executable spec |
| **Cross-language isomorphism** | Binary search, BFS, quicksort, and a recursive fib written in all three languages must yield **structurally equivalent** graphs (same node kinds, same edge topology). This is the test that keeps the IR honest |
| **Layout reconciliation** | Overrides survive re-parse; orphans are marked not deleted; reappearing IDs are restored |
| **RLS** | Assert user A **cannot** read/write user B's project, snapshot, graph, override, or key. Positive-path-only auth tests are how leaks ship |
| **BYOK crypto** | Round-trip; wrong-AAD decryption **fails**; `key_version` honoured; key absent from all serialized output |
| **E2E (Playwright)** | signup → new project → paste C++ → diagram renders → drag a node → reload → **position persisted** → export PNG → ask AI (mocked provider) |
| **A11y** | axe on every route; contrast gates 40–41 in **both** themes; full keyboard traversal of the canvas; 8-state audit per interactive component |
| **Slop test** | All 58 gates before any UI is called done |

---

## 13. Build order — nine verifiable slices

Each slice ends with a check a human or agent can actually run. This is what makes handoff
between agents viable.

| # | Slice | Done when |
|---|---|---|
| 1 | Scaffold, Supabase auth, RLS, projects CRUD, Hallmark tokens + both themes | Sign up, create a project, see it after reload. RLS tests pass |
| 2 | **IR core + Python** (TDD), worker, golden fixtures | `parse(python)` produces correct IR for all 30 fixtures |
| 3 | Canvas: custom nodes, ELK layout, fn tabs, editor↔node span sync | Paste Python, see a correct diagram, click a node → editor scrolls to it |
| 4 | Snapshots + Inngest analyze job + Realtime + status states | Edit → durable graph written → status dot resolves. Kill the job → local graph survives |
| 5 | `layout_overrides`: drag, collapse, annotate, reconcile, orphan GC | Drag, reload, position holds. Break syntax, fix it, position still holds |
| 6 | **C++ and Java** grammars + the seven hard constructs | Isomorphism tests green across all three languages |
| 7 | Export PNG / JPEG / SVG, light-background option | Export at 2x, diagram is sharp and correctly themed |
| 8 | BYOK vault + provider registry + streaming chat grounded in IR | Add a key, ask about a node, get a grounded streamed answer. Key never appears in any client payload |
| 9 | Marketing + auth pages (full Hallmark page flow), a11y + slop pass | Slop test 58/58, axe clean both themes, Lighthouse a11y ≥ 95 |

Slices 1–3 are strictly sequential. 6 and 7 can run in parallel once 3 lands. 8 depends only
on 1. 9 is last so the marketing hero can embed a real working canvas.

---

## 14. Decisions worth not relitigating

Recorded so a future agent does not "fix" a deliberate choice:

1. **The diagram is derived.** Code is truth. No P1 path writes source from the graph.
2. **Basic blocks, not statements.** Readability beat fidelity for a learner audience.
3. **Ternaries and `&&`/`||` stay inline.** Revisit as an opt-in toggle, never as a default.
4. **One IR module, two call sites.** Any React/Next import in `src/lib/ir/` is a bug.
5. **Client never uploads a graph.** Source only. The server re-derives.
6. **AI streams from a route handler, not Inngest.** Queues cannot stream.
7. **Skeleton on first load only.** A loader for work already finished is a lie.
8. **Orphaned overrides are retained 30 days, not deleted.** Protects against transient
   syntax errors.
9. **ELK over dagre.** Back edges are the whole point.
10. **Shape and label carry node meaning, not colour.** Export and a11y both need it.
11. **Aurora Day drops the blooms.** A bloom on light paper is the anti-pattern.

---

## 15. Open items for implementation

Flagged rather than guessed:

1. **Opencode Zen + NVIDIA NIM base URLs / OpenAI-compatibility** — verify before wiring.
2. **Aurora's exact OKLCH values** — no `themes/aurora.md` exists; derive from the genre file
   and `structure.md:102`, then verify contrast gates 40–41 in both drops.
3. **Java generics in `functionId`** — decide whether erasure or the full signature is used,
   and make it consistent for overload disambiguation.
4. **ELK tuning for irreducible graphs** (`goto`) — may need a fallback if layering degrades.
