# code-flow — Plan 7: Design system and the anti-slop pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Load the `hallmark` skill before any step here.** This plan records *decisions*; the skill carries the references those decisions cite, and the 58 gates that verify them.

**Goal:** code-flow looks like someone designed it for this problem — not like a page a model filled in. Every choice below is traceable to a gate or to the product's own constraints.

**Architecture:** This plan is the **design authority**. Plan 6 (marketing) and any future UI work consume it rather than re-deciding. It owns the token contract, the node visual language, the motion budget, the macrostructure decision, and the sourcing rules for third-party components.

**Spec:** `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` §10

**Prerequisite:** Plans 1–2 (the app exists and is deployed). Do Task 1 immediately — it fixes shipped violations.

---

## What "not generic AI slop" means here, concretely

The slop version of this product is easy to picture, and every element of it is banned by a numbered gate:

| The slop version | Gate | What we do instead |
|---|---|---|
| Purple→blue gradient headline | 2 | One cool-cyan accent. No gradient text, ever. |
| 3 equal cards, emoji icons (🚀 ⚡ 🎯) | 3, 30 | **The node shapes are the iconography.** No emoji as UI icon. |
| Fake browser chrome around a screenshot | 47 | The hero embeds the **real canvas** rendering real code. |
| "Trusted by 10,000+ developers" | 46 | We have no users. Say what it does instead. |
| Everything centred in a 100vh hero | 6, 44 | Canvas-led hero; eyebrow and CTA sit **off-axis**. |
| Wordmark-left + 5 links + button-right nav | 42 | **N13 inline ⌘K-pill** — and the ⌘K is real. |
| 4-column footer + social row | 43 | **Ft5 Statement** — the page argues something, the footer states it. |
| `transition: all` + `hover:scale-105` | 10, 11 | Three motion primitives, named properties only. |
| Pure `#000` / `#fff` | 7 | Tinted neutrals, min 0.005 chroma. |

The through-line: **the diagram is the design.** A tool that renders control flow should look like it was made by someone who thinks in control flow. That is the specificity axis (critique D) and it is the one thing a generic template cannot fake.

---

## Global constraints

- **Genre: atmospheric. Theme: Aurora. Dark by default, light a full alternate.** Locked in the spec; do not re-pick.
- **Every colour and font through a token.** No inline hex/OKLCH/`rgb()`, no bare `font-family`. (Gate 48)
- **Three font families maximum**, and we are at exactly three: `--font-display`, `--font-body` (both Geist Sans), `--font-mono` (Geist Mono). **There is no room for a fourth.** (Gate 37)
- **Motion budget is three primitives, total, site-wide:** node-settle, skeleton crossfade, focus ring (instant, never animated). `transform`/`opacity` only. Every one needs a `prefers-reduced-motion` fallback. (Gates 10, 12, 14, 15, 27)
- **Accent ≤ 5% of any viewport by area**, except atmospheric's two fixed radial blooms (≤ 30%, never animated, absent in Day). (Gates 23, 29)
- **All 8 states on every interactive element**: default, hover, `:focus-visible`, `:active`, disabled, loading, error, success. (Gate 26)
- **Node meaning never carried by colour alone.** (Spec §10)
- **Spacing only from the 4pt scale.** `padding: 17px` is a tell. (Gate 24)
- **Prose containers 45–75ch.** (Gate 25)
- Verified at **320 / 375 / 414 / 768px**. No horizontal scroll (`overflow-x: clip`, never `hidden`), no two-line clickable text. (Gates 34, 49)

---

## Task 1: Fix the violations already shipped

Found by auditing the live tokens against the gate list. Do this first — the rest of the plan assumes a clean base.

- [ ] **Step 1: Gate 22 — two neutrals have sub-threshold chroma**

`src/styles/tokens.css`, the Aurora **Day** block. Pure greys read flat; every neutral must be tinted toward the anchor hue with **≥ 0.005 chroma**:

```css
/* was oklch(99% 0.002 200) — 0.002 fails gate 22 */
--color-accent-ink: oklch(99% 0.006 200);
--color-node:       oklch(99% 0.006 200);
```

The Night block is already compliant (0.018 / 0.020). Lightness is unchanged, so contrast is unaffected — but **re-run `python3 scripts/check-contrast.py` anyway** and confirm 27/27 in both themes.

- [ ] **Step 2: Gate 30 — audit the glyphs we use as icons**

`ThemeToggle.tsx` uses `◐ ☀ ☾` and `IRNodeView.tsx` uses `↻ ⚠`. These are Unicode symbols, not emoji — but `☀` and `⚠` render as **colour emoji** on some platforms (notably Windows and Android), which trips the gate and breaks grayscale export.

Replace all five with inline SVG at `1em`, `currentColor`, `aria-hidden="true"`:

| Slot | Draw |
|---|---|
| theme: system | half-filled circle |
| theme: light | circle + 8 rays |
| theme: dark | crescent |
| loop-header | circular arrow |
| unreachable | triangle + bar |

Hand-built, one visual family, no icon library — which also settles gate 30's "don't mix libraries" half. Every decorative SVG needs `aria-hidden="true"` or an `aria-label` (gate 33).

- [ ] **Step 3: Gate 39 — the input-state audit**

Check every input in `AuthForm.tsx`, `NewProjectForm.tsx`, and the editor chrome against all five sub-rules:
- Border-width **identical** across default/hover/focus/error — state changes go to `outline`, `background`, or `border-color`, never `border-width` (it shifts layout).
- Focus ring is `outline: 2px solid var(--color-focus)` with `outline-offset: 1px`, and `outline: 2px solid transparent` reserved at rest so activating does not shift geometry.
- **Input height === adjacent button height**, sharing one base with a 44px floor. A 38px input beside a 44px button is the most common form slop.
- Helper/error slot reserves `min-height: 1lh` **even when empty**, so an appearing error does not push the page down.
- Disabled uses three channels: `opacity: 0.55` **and** `cursor: not-allowed` **and** the native `disabled` attribute.

- [ ] **Step 4: Verify and commit**

```bash
python3 scripts/check-contrast.py   # 27/27 both themes
pnpm lint && pnpm typecheck && pnpm test
```

```bash
git commit -m "fix(design): tint sub-threshold neutrals, replace emoji glyphs with SVG"
```

---

## Task 2: The node visual language

**This is the product's brand, and it is load-bearing rather than decorative.** The reason is worth internalising: node meaning must survive grayscale (spec §10), so shape has to carry it — and shape carrying meaning is exactly what makes the diagram look designed instead of themed. The accessibility requirement and the visual identity are the same decision.

Already built in `canvas.css`; this task makes it deliberate and consistent.

- [ ] **Step 1: Lock the shape system**

| Node | Shape | Non-colour cue |
|---|---|---|
| `entry` / `exit` | Pill | Full-round radius, centred label |
| `basic` | Rounded rect | Baseline form — everything else is a departure from it |
| `branch` / `switch` | **Diamond** | Rotated square behind the text |
| `loop-header` | Rect + **doubled left rule** | 3px `double` border-left + circular-arrow SVG |
| `return` | Rect + **filled left cap** | 6px solid border-left |
| `throw` | **Dashed** border | Plus danger-token border colour |
| unreachable (any) | Dashed + 55% opacity | Plus a triangle mark and the word "unreachable" |

| Edge | Cue |
|---|---|
| `seq` | Solid, no label |
| `true` / `false` | Solid + **text label** |
| `case` / `default` | Solid + `case <value>` label |
| `back` | **Dashed** + loop-kind label + curved routing |
| `exception` | Fine dash + `exception` label |
| `break` / `continue` | Medium dash + word label |

Every distinction is shape, dash pattern, or **words** — never hue alone. Colour only reinforces.

- [ ] **Step 2: Prove it in grayscale**

Screenshot a binary-search diagram, convert to grayscale, and confirm every branch, loop, and return is still identifiable. **If it is not, the shape language failed** — fix the node views, not the exporter. This is also Plan 4's export gate.

- [ ] **Step 3: Document it**

Add a `Node language` section to `docs/product-design.md` with the two tables. Any future adapter (C++/Java in Plan 3) reuses these; a new node kind needs a new *shape*, not a new colour.

---

## Task 3: App shell design pass

The shell is **component-scope**, not page-scope: a three-pane workbench has no macrostructure, no hero, no footer. State that explicitly rather than skipping it silently, per the skill's component-scope rules.

- [ ] **Step 1: Fix the pane ratio and add a real resizer**

Currently `minmax(0, 4fr) minmax(0, 7fr)`, hard-coded. The canvas should dominate — it is why someone opened the app — but the ratio is a preference, not a law. Add a draggable divider persisting to `localStorage`, with a keyboard-accessible handle (`role="separator"`, `aria-orientation="vertical"`, arrow-key resize).

`minmax(0, …)` is not optional on any track holding the canvas (gate 50).

- [ ] **Step 2: Status indicator that reads as a sentence**

Today it prints one word (`saved`, `parsing`, `2 syntax errors`). Learners deserve better than a status word. Pair a hand-built SVG state mark with plain language, and **never let a failure hide the diagram**:

| State | Reads |
|---|---|
| ready, clean | `saved` |
| ready, diagnostics | `2 syntax errors — showing what parsed` |
| parsing | `parsing` |
| save failed | `not saved — your diagram is still current` |
| server analysis failed | `server analysis failed — retry` + a retry control |

Gate 16 applies: **success is silent.** No toast for a save the user can already see reflected.

- [ ] **Step 3: Empty and first-run states that teach**

Three cases, each earning its words:
- Empty editor → "The editor is empty. Paste a function and its diagram appears here."
- Parsed, no functions → explain that top-level statements have no control flow to draw yet.
- First load → the skeleton, which is honest because grammar WASM is a real wait. **First load only** — never on an edit the local parse already answered.

- [ ] **Step 4: Keyboard and focus order**

Tab order: editor → function tabs → canvas → chat. `⌘K` opens the palette (Task 5). Focus rings visible against **both** themes at ≥3:1, and never animated (gate 15).

- [ ] **Step 5: Verify at four widths**

320 / 375 / 414 / 768. Under 768 the shell collapses to tabs — a three-pane layout on a phone serves nobody. Check no button or tab wraps to two lines (gate 49).

---

## Task 4: Marketing macrostructure — the decision

**Macrostructure: 19 · Map / Diagram.** State this out loud before writing markup, with nav and footer:

> *Genre: atmospheric. Macrostructure: Map / Diagram. Nav: N13 inline ⌘K-pill. Footer: Ft5 Statement. Theme: Aurora (dark paper · grotesk-sans · cool-cyan accent).*

**Why Map/Diagram rather than the obvious pick.** Workbench (05) is the reflexive SaaS answer — screenshots in frames, guided tour — and it would be fine and forgettable. Map/Diagram organises the page **spatially, as a diagram**, which for a control-flow-diagram tool is the one shape that could only belong to this product. That is the Specificity axis, and it is where generic templates lose.

**The risk, and the fallback.** Diagram-as-layout can become a gimmick, and it is hard at 320px. So: spatial above the fold on wide viewports, linear stack below 768px — the *content* order must make sense read top-to-bottom regardless. If the spatial version cannot be made to read cleanly in two attempts, fall back to **05 · Workbench** and record why in `PROGRESS.md`. Do not ship a clever layout that fails the fold test (gate 44).

- [ ] **Step 1: Load only what you picked**

Read `references/macrostructures/19-map-diagram.md`, plus `references/components/n13-inline-cmdk-pill.md` and `references/components/ft5-statement.md`. **Do not load the whole cookbook** — that is the single largest token waste in the skill.

- [ ] **Step 2: Prebake the hero IR**

The hero embeds the **real canvas**, which is both the honest demo and gate 47's answer to fake chrome — there is no screenshot to fake because it is the actual product rendering actual output.

It must not download 460KB of WASM to show a picture. Generate the IR once and commit the JSON:

```bash
# scripts/bake-demo-ir.mts — run manually, commit the output to src/lib/demo-ir.json
# parseToIR(binarySearch, 'python') -> layoutProgram -> write JSON
```

Render `FlowCanvas` with `nodesDraggable={false}` and `zoomOnScroll={false}` so the page still scrolls. Gate 45: the canvas is **motivated** decoration — it is the product — which is exactly what that gate asks for.

- [ ] **Step 3: The ⌘K pill must be real**

N13 puts a `⌘K` affordance in the nav. **A dead affordance is worse than a plainer nav** (gate 45: decoration needs a semantic anchor). Either wire it to a working palette — jump to a project, switch theme, open a function — or drop N13 and use **N9 edge-aligned minimal** instead. See Task 5 for sourcing.

- [ ] **Step 4: Copy — honest, specific, short**

Headline **≤ 7 words and ≤ 50 characters** (Hallmark's hero sizing rule). The one claim worth making is the one competitors cannot: *the diagram is derived from the code, so it cannot drift.*

Banned outright: invented metrics, testimonials, logo walls (gate 46 — we have none of those things, and inventing them is the fastest way to lose a technical audience). No "Jane Doe", no "Acme" (gate 19).

Say the scope honestly: P1 shows structure; execution tracing is next. Do **not** imply P3 exists.

- [ ] **Step 5: Sections**

Only what a learner needs to decide: hero with the live canvas · what it does (three specifics, not "features") · the languages, stated truthfully · honest scope · one CTA.

No pricing tier table. No FAQ accordion. The SaaS section sequence in the skill explicitly does **not** apply to a non-SaaS brief, and stamping it out anyway is how a page reads as templated.

- [ ] **Step 6: Write `.hallmark/log.json`**

So the next Hallmark run rotates away:

```json
[{ "date": "2026-09-01", "macrostructure": "Map / Diagram", "theme": "Aurora",
   "enrichment": "live embedded canvas (prebaked IR)",
   "brief": "code-flow · DSA control-flow diagrams" }]
```

---

## Task 5: Third-party components — where 21st.dev earns its place

The rule from `CLAUDE.md`: anything pulled from 21st.dev **must be adapted** — rewritten onto Hallmark tokens, given all 8 states, run through the gates. Never a drop-in. A component that arrives with its own palette and two states is a starting point, not a deliverable.

**Where it genuinely helps:**

| Need | Candidate | Adaptation required |
|---|---|---|
| ⌘K command palette (N13) | `@ddoemonn/command-palette` or `@rafa-porto/command-palette` | Retheme to tokens; verify focus trap, `role="dialog"`, `aria-modal`, Escape, and restore-focus-on-close; strip any bounce easing (gate 12) |
| Provider-key settings UI (Plan 5) | `@originui/command`-style primitives | Inputs must pass all five of gate 39 |

```bash
# search before assuming; the catalog changes
# mcp__21st__search { query: "command palette cmdk", type: "component" }
```

**Where it does not help, and why — do not spend retrievals here:**

- **The editor.** We use **CodeMirror 6** already. Every 21st code component found is display-only (Ace or Shiki based); swapping one in would *lose* editing, the language extensions, and the reveal-line integration. A downgrade dressed as a shortcut.
- **The canvas.** React Flow v12 with custom nodes. No component in the catalog renders a control-flow graph, and the node shapes are bespoke *by requirement* (Task 2).
- **Node views.** The shape language is the brand. Sourcing it externally would defeat the point.

Honest summary: 21st.dev is worth one or two components on the chrome, and nothing on the core. That is a fine outcome — the core is where the product's identity lives.

- [ ] **Step 1: Search, then decide.** Record which components were pulled and how they were adapted, in `PROGRESS.md`.
- [ ] **Step 2: Adapt fully before use.** Tokens, 8 states, gates 26/39/12/15. A pulled component that still carries its own hex values fails gate 48.

---

## Task 6: The 58-gate sweep

- [ ] **Step 1: Pre-emit critique, before the gates**

Score the planned output 1–5 on six axes. **Anything below 3 triggers a revision pass before the sweep** — do not carry known weakness into a 58-gate review. Two passes is normal; three means the brief is wrong, not the design.

| Axis | The question |
|---|---|
| Philosophy | Is there a clear *why*, or just a layout? |
| Hierarchy | Can a reader tell primary/secondary/tertiary in 2 seconds? |
| Execution | Rule weights, accent footprint, text-wrap, focus rings, contrast — all in spec? |
| **Specificity** | Does this look like *this* brief, or like any page? |
| Restraint | Has everything not earning its place been removed? |
| Variety | Structurally distant from prior output, not just recoloured? |

Stamp the scores at the top of the CSS: `/* Hallmark · pre-emit critique: P5 H4 E5 S5 R4 V5 */`

- [ ] **Step 2: Run all 58.** Load `references/slop-test.md` **now** — it is a post-emit check, and pre-loading it costs ~7K tokens for nothing. Every answer must be **no**.

The ones this product is most likely to trip:

| Gate | Watch for |
|---|---|
| 6, 44 | Centred-everything hero; hero content overflowing at **1280×800** |
| 22 | Any new neutral at zero chroma — the violation Task 1 fixes |
| 30 | Emoji creeping back in as an icon |
| 34 | `overflow-x: clip` on **both** `html` and `body`, never `hidden` |
| 37 | A fourth font family; we are at the ceiling of three |
| 47 | Fake chrome around the canvas — the live canvas is the whole point |
| 50 | Any `1fr` track holding the canvas or an image → `minmax(0, 1fr)` |
| 54 | Eyebrow beside a heading. **Always** stack vertically. |
| 56 | Two sticky-at-`top: 0` elements — nav plus a section head |

- [ ] **Step 3: Stamp the result**

```css
/* Hallmark · macrostructure: Map / Diagram · theme: Aurora · genre: atmospheric
 * nav: N13 · footer: Ft5 · pre-emit critique: P_ H_ E_ S_ R_ V_
 * contrast: pass (40–41) · slop: pass (42–45) · honest: pass (46)
 * chrome: pass (47) · tokens: pass (48) · responsive: pass (49) · mobile: pass (34, 50–57)
 */
```

- [ ] **Step 4: Accessibility, both themes**

axe on every route in dark **and** light; Lighthouse a11y ≥ 95 on `/`, `/login`, `/demo`. Then the canvas-specific work in Plan 6 Task 3 — the **graph outline view**, which is a first-class view rather than a fallback: it serves screen-reader users, keyboard users, anyone on a 320px screen, and anyone who reads faster than they scan.

---

## Self-review

**Owned here, so nothing else re-decides it:** the token contract, the node shape language, the motion budget, the macrostructure/nav/footer picks, third-party sourcing rules, and the gate-compliance record.

**Deliberately not here:** the marketing page *build* (Plan 6 Task 1, which consumes these decisions) and the export pipeline (Plan 4, which must reuse the shape language rather than reinvent it).

**Done when:** Task 1's violations are fixed and verified, the node language is documented and proven in grayscale, and the marketing surface ships with all 58 gates passing and the stamp recording it.

**The honest test, worth more than the gate count:** show the landing page to someone who has never heard of code-flow. If they cannot say what it does in one sentence afterward, the copy failed — not the reader. And if the page could be swapped onto another product by changing the words, the design failed.
