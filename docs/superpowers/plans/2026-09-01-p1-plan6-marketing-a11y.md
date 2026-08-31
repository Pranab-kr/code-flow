# code-flow P1 — Plan 6: Marketing surface and accessibility pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stranger lands on the site, understands what code-flow does in about ten seconds, and signs up. Everything ships accessible in both themes.

**Architecture:** The marketing and auth pages are the one place in P1 that gets Hallmark's **full page flow** — macrostructure, nav and footer archetypes, hero enrichment. The app shell stays component-scope. The hero embeds a **real working canvas** with a prebaked IR, which is both the honest demo and Hallmark's answer to the ban on re-drawn browser chrome.

**Tech Stack:** Next 16 app router, Hallmark tokens (already in `src/styles/tokens.css`), `@axe-core/playwright`, Lighthouse.

**Spec:** `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` (§10 UI), `docs/product-design.md`

**Prerequisite:** Plans 1–5. This is last on purpose: the hero embeds the real canvas, so the canvas must work first.

## Global Constraints

- **Load the `hallmark` skill before writing any page markup.** Page-scope work needs its macrostructure index, its nav/footer routing tables, and the 58-gate slop test. Do not improvise from memory.
- Genre is **atmospheric**, theme **Aurora**, dark by default. Locked in `.hallmark/log.json` after this plan.
- Nav **N13 inline ⌘K-pill**, footer **Ft5 Statement**. Explicitly **not** N1a and **not** Ft3 — Hallmark bans both as the recognizable AI fingerprints.
- Every colour and font through a token. No inline hex or OKLCH, ever.
- Motion stays at **three primitives** site-wide. No new ones for marketing.
- **No invented metrics.** No "10,000 developers", no "5× faster". We have no users yet; say what the product does instead. (Hallmark gate 46.)
- Mobile verified at **320 / 375 / 414 / 768px**. No horizontal scroll, no two-line clickable text.
- **58/58 slop gates before this is called done.**

---

## Task 1: Landing page

**Files:**
- Create: `src/app/(marketing)/page.tsx`, `src/app/(marketing)/layout.tsx`
- Create: `src/components/marketing/{Nav,Footer,HeroCanvas,Section}.tsx` + CSS
- Create: `src/lib/demo-ir.ts` (prebaked IR for the hero)
- Modify: `src/app/page.tsx` (replace the Task 1 placeholder)

- [ ] **Step 1: Load the skill and state the picks out loud**

Invoke `hallmark`. Read `references/macrostructures.md`, pick one, then load **only** that
per-macro file. Read `references/component-cookbook.md` and load only N13 and Ft5.

State the picks in plain text before writing markup: *"Genre: atmospheric. Macrostructure:
<name>. Nav: N13. Footer: Ft5. Theme: Aurora (dark paper · grotesk-sans · cool accent)."*
This is the accountability step — picking on the page prevents drifting back to defaults.

- [ ] **Step 2: Prebake the hero IR**

The hero must not download 460KB of wasm to show a picture. Generate the IR once at build
time and commit the JSON:

```bash
# scripts/bake-demo-ir.mts — run manually, commit the output
# parseToIR(binarySearchSource, 'python') -> layoutProgram -> write src/lib/demo-ir.json
```

`HeroCanvas` imports that JSON and renders the real `FlowCanvas` in a non-interactive mode
(`nodesDraggable={false}`, `zoomOnScroll={false}` so the page still scrolls). It is the
actual product rendering actual output — no screenshot, no fake chrome, nothing to
misrepresent.

- [ ] **Step 3: Write the copy**

Honest, specific, and short. The one claim worth making is the one competitors cannot:
the diagram is derived from the code, so it cannot drift. Say that plainly.

Voice check against `docs/product-design.md`: we are knowledgeable, not instructive;
supportive, not authoritative. No hyperbole, no exclamation points, no em-dash pileups.
Headline ≤ 7 words and ≤ 50 characters, per Hallmark's hero sizing rule.

- [ ] **Step 4: Sections.** Keep it to what a learner needs to decide: the hero with the
live canvas, what it does (three specifics, not "features"), the languages, honest scope
("P1 shows structure; execution tracing is next" — do not imply P3 exists), and one CTA.

No testimonials. No logo wall. No metrics. We have none of those things, and inventing
them is the fastest way to lose a technical audience.

- [ ] **Step 5: Nav and footer** from the loaded archetype files. The ⌘K pill is real —
wire it to the same command palette the app uses, or drop the pill and use N9 instead.
A dead affordance is worse than a plainer one.

- [ ] **Step 6: Verify at four widths.** 320 / 375 / 414 / 768. Check specifically: no
horizontal scroll (`document.documentElement.scrollWidth <= clientWidth`), no button or
nav link wrapping to two lines, the hero canvas legible rather than a smudge, and image
grid tracks using `minmax(0, 1fr)`.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat: landing page with a live embedded canvas"
```

---

## Task 2: Auth pages

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/AuthForm.tsx`

- [ ] **Step 1: One shared form component**, both modes. All 8 states on the submit
button; the loading state matters because auth is a real round trip.

- [ ] **Step 2: Errors that help.** "That email and password did not match an account" —
never "Invalid credentials", never a raw Supabase message. Validate the email format
client-side before the round trip, and keep what they typed on failure.

- [ ] **Step 3: Accessible by construction.** A real `<form>` with a real submit button,
`<label>` per input (not placeholder-as-label), `aria-describedby` on the error,
`aria-invalid` on the field, `autocomplete="email"` / `"current-password"` /
`"new-password"`, and focus moved to the error on failure so a screen reader announces it.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: accessible auth pages"
```

---

## Task 3: Canvas accessibility

The hardest accessibility problem in the product, and the one most likely to be skipped:
a graph is inherently visual.

**Files:**
- Create: `src/components/canvas/GraphOutline.tsx`
- Modify: `FlowCanvas.tsx`, `IRNodeView.tsx`
- Test: `tests/e2e/a11y.spec.ts`

- [ ] **Step 1: Add a text outline as a first-class view, not a fallback**

A nested list of the control-flow structure, toggleable next to the diagram:

```
binary_search(arr, target)
  1. lo = 0; hi = len(arr) - 1
  2. while lo <= hi
       3. mid = (lo + hi) // 2
       4. if arr[mid] == target → return mid
       5. else if arr[mid] < target → lo = mid + 1
       6. else → hi = mid - 1
       ↻ back to step 2
  7. return -1
```

Derive it from the same IR. It serves screen-reader users, keyboard users, anyone on a
320px screen, and anyone who simply reads faster than they scan. That is why it is a view
rather than an `aria-label` — it is genuinely useful to everyone.

- [ ] **Step 2: Keyboard navigation on the canvas.** React Flow gives nodes
`tabIndex` when `nodesFocusable` is on; verify arrow keys move between nodes, Enter jumps
the editor to that line, and the focus ring is visible against **both** themes. If React
Flow's built-in traversal is inadequate, the outline view is the accessible path and the
canvas gets `aria-hidden` with a pointer to it — an honest fallback beats a broken one.

- [ ] **Step 3: Announce the graph.** The canvas container gets a label naming the function
and its size ("control flow for binary_search, 10 nodes"). Status changes announce via a
polite live region. Nothing important is conveyed by colour alone — already true from
Plan 1, verified here in grayscale.

- [ ] **Step 4: axe on every route, both themes**

```ts
// tests/e2e/a11y.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = ['/', '/login', '/signup', '/projects', '/demo'];

for (const route of ROUTES) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${route} has no axe violations in ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(route);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
}
```

- [ ] **Step 5: Re-run the contrast script.** `python3 scripts/check-contrast.py` must
still report 27/27 in both themes, and the **built** CSS must too — Lightning CSS
downlevels OKLCH to hex, so the shipped values are not literally the source values.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: graph outline view and canvas keyboard navigation"
```

---

## Task 4: E2E and the slop test

**Files:**
- Create: `tests/e2e/slice.spec.ts`, `playwright.config.ts`

- [ ] **Step 1: The full-slice E2E** the plan has owed since Plan 1:

```ts
test('signup → project → diagram → drag → reload → export', async ({ page }) => {
  // 1. sign up with a unique email
  // 2. create a project (starter snippet seeds it)
  // 3. a loop-header node appears
  // 4. exactly two branch nodes and two return nodes for binary search
  // 5. drag a node, note its transform
  // 6. reload — the position is preserved  ← the assertion that matters
  // 7. export PNG, assert the download
  // 8. click a node, assert the editor scrolled
});

test('no horizontal scroll at 320px on every route', async ({ page }) => { /* … */ });

test('a syntax error keeps the last good diagram on screen', async ({ page }) => {
  // degrade, never blank (spec §11)
});
```

Note step 6 needs Plan 2's persistence. If Plan 2 is not done, mark this test `.skip`
with a comment naming the dependency rather than deleting it.

- [ ] **Step 2: Run the 58-gate slop test.** Load `references/slop-test.md` **now**, not
earlier — it is a post-emit check. Every answer must be no. Fix what fails and re-run.

Gates that most often catch this kind of app: 34 (root `overflow-x: clip`, never
`hidden`), 38a (no italic headers), 46 (no invented metrics), 47 (no re-drawn browser
chrome — the live canvas satisfies this), 49 (no two-line clickable text), 54 (no
tag-left/heading-right split), and 29 (blooms within the atmospheric allowance, never
animated, absent in Day).

- [ ] **Step 3: Lighthouse.** Accessibility ≥ 95 on `/`, `/login`, and `/demo`. Report the
real numbers, including performance, and do not quietly drop a page that scores badly.

- [ ] **Step 4: Write `.hallmark/log.json`** so the next Hallmark run in this repo rotates
away from these picks:

```json
[{ "date": "2026-09-01", "macrostructure": "<name>", "theme": "Aurora",
   "enrichment": "live embedded canvas", "brief": "code-flow · DSA control-flow diagrams" }]
```

- [ ] **Step 5: Commit**

```bash
git commit -m "test: full-slice E2E, axe both themes, and the 58-gate slop pass"
```

---

## Task 5: Close out P1

- [ ] **Step 1: Run everything and report honestly**

```bash
pnpm test
pnpm vitest run tests/rls.test.ts
pnpm exec playwright test
pnpm lint && pnpm exec tsc --noEmit
pnpm build
python3 scripts/check-contrast.py
```

If something fails, say so with the output. If a step was skipped, say which and why.

- [ ] **Step 2: Update `PROGRESS.md`** — tick every task board, add decision-log entries for
anything a future agent might reverse, and record new traps.

- [ ] **Step 3: Write the P1 retrospective** in `PROGRESS.md`: what the plans got wrong, what
the verification passes caught, and which assumptions cost the most. The pre-implementation
API sweep found six blockers and three bugs that would have passed their own tests — that
pattern is worth repeating for P2–P4, and worth recording as the reason.

- [ ] **Step 4: Write the P2 spec stub.** P2 (more languages), P3 (flow debug), and P4 (AI
diagram→code editing) each need their **own spec** before any plan. Do not start them from
the P1 spec.

Note for whoever writes the P3 spec: it is the first phase that **executes user code**.
That needs a sandboxed runner service, its own threat model, and a security review. P1
deliberately has no `eval`, no subprocess, no sandbox, and that boundary should not be
crossed casually.

---

## Self-Review

**Spec coverage:** §10 marketing surface with the full Hallmark page flow; §12's a11y and
slop-test requirements.

**Done when:** the landing page shows a real diagram of real code, every route is axe-clean
in both themes, the graph has a text outline anyone can read, and 58/58 slop gates pass.

**The honest test:** show the landing page to someone who has never heard of code-flow. If
they cannot say what it does in one sentence afterward, the copy failed — not the reader.
