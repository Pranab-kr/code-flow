# code-flow P1 — Plan 4: Export and annotations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner can put their diagram into their own notes — PNG, JPEG, or SVG, sharp, correctly themed, with their sticky notes included.

**Architecture:** Client-side export. Serialize the React Flow viewport to SVG, then rasterize through a canvas for PNG/JPEG. Nothing round-trips through the server: the graph is already on the client, and a server render would need a headless browser for no gain.

**Tech Stack:** React Flow's `getNodesBounds`/`getViewportForBounds`, native `XMLSerializer` + `<canvas>`. No `html-to-image` — see Task 1 Step 1.

**Spec:** `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` (§8 annotations, §10 export legibility, §11 limits)

**Prerequisite:** Plan 1 (canvas) and Plan 2 (persistence, for annotations).

## Global Constraints

- **jpg and jpeg are the same format.** Three real options: PNG, JPEG, SVG. Do not present four.
- **Export must survive grayscale.** Node meaning is shape + label; if an export is only legible in colour, the export is wrong (spec §10).
- Every colour comes from a token. Export reads *computed* token values, never hardcoded hex.
- A dark-theme diagram exported for a slide deck needs a **light background option** — default it on for JPEG, which has no transparency.
- All 8 states on every control, including the disabled state while an export runs.
- Downloads must be user-initiated (a real click), or browsers block them.

---

## Task 1: SVG serialization

**Files:**
- Create: `src/lib/export/toSvg.ts`
- Test: `src/lib/export/toSvg.test.ts`

**Interfaces:**
- Consumes: `RFNode`, `RFEdge` (Plan 1 Task 7), `LaidOutGraph`.
- Produces: `graphToSvg(opts: SvgOptions): string` where
  `SvgOptions = { nodes, edges, tokens: Record<string,string>, background: 'transparent'|'paper'|'white', padding?: number }`

- [ ] **Step 1: Decide the approach deliberately**

Do **not** reach for `html-to-image` or `dom-to-image`. They rasterize a live DOM subtree
by inlining computed styles, and they are fragile in exactly our case: React Flow renders
edges as SVG inside a transformed container, custom node HTML is `foreignObject`-wrapped,
and web fonts frequently drop. We already hold the graph, its geometry, and its routed
edge points — so **draw the SVG from the IR**, which is deterministic, testable without a
DOM, and produces clean vector output.

- [ ] **Step 2: Write the failing test**

`src/lib/export/toSvg.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { graphToSvg } from './toSvg';
import type { RFEdge, RFNode } from '@/components/canvas/toReactFlow';

const TOKENS = {
  '--color-node': '#ffffff',
  '--color-node-brdr': '#808888',
  '--color-ink': '#121d1d',
  '--color-ink-3': '#5a6263',
  '--color-edge': '#7e8889',
  '--color-edge-back': '#927bbd',
  '--color-accent': '#007177',
  '--color-canvas': '#ebeff0',
  '--color-danger': '#c43f3e',
  '--font-mono': 'monospace',
};

const nodes: RFNode[] = [
  {
    id: 'a', type: 'ir', position: { x: 0, y: 0 }, width: 160, height: 44,
    data: { kind: 'entry', label: 'f()', statements: [], span: { startLine: 1, endLine: 1 } },
  },
  {
    id: 'b', type: 'ir', position: { x: 0, y: 90 }, width: 200, height: 60,
    data: { kind: 'branch', label: 'x > 0', statements: ['x > 0'], span: { startLine: 2, endLine: 2 } },
  },
];

const edges: RFEdge[] = [
  { id: 'e0', source: 'a', target: 'b', type: 'smoothstep', className: 'cf-edge cf-edge-seq', animated: false, data: { kind: 'seq' } },
  { id: 'e1', source: 'b', target: 'a', type: 'default', className: 'cf-edge cf-edge-back', label: 'while', animated: false, data: { kind: 'back' } },
];

const svg = (over: Partial<Parameters<typeof graphToSvg>[0]> = {}) =>
  graphToSvg({ nodes, edges, tokens: TOKENS, background: 'paper', ...over });

describe('graphToSvg', () => {
  it('emits a well-formed svg root with a viewBox', () => {
    const out = svg();
    expect(out).toMatch(/^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(out).toMatch(/viewBox="[-\d. ]+"/);
    expect(out.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('sizes the viewBox to the content plus padding', () => {
    const out = svg({ padding: 20 });
    // content is 200 wide (node b) and 150 tall; padding adds 40 to each axis
    expect(out).toContain('viewBox="-20 -20 240 190"');
  });

  it('renders one shape per node and includes its text', () => {
    const out = svg();
    expect(out).toContain('x &gt; 0');   // escaped, not raw
    expect(out).toContain('f()');
  });

  it('draws a decision as a polygon, not a rect — shape carries meaning', () => {
    expect(svg()).toContain('<polygon');
  });

  it('dashes back edges AND labels them, so colour is never the only signal', () => {
    const out = svg();
    expect(out).toMatch(/stroke-dasharray="[^"]+"/);
    expect(out).toContain('while');
  });

  it('resolves colours from tokens, never hardcoded', () => {
    const out = svg();
    expect(out).toContain('#808888');       // node border token
    expect(out).not.toMatch(/#(f0f|abc123)/i);
  });

  it('paints a background rect for paper and white, none for transparent', () => {
    expect(svg({ background: 'paper' })).toContain('#ebeff0');
    expect(svg({ background: 'white' })).toContain('#ffffff');
    const bare = svg({ background: 'transparent' });
    // no full-bleed background rect
    expect(bare).not.toMatch(/<rect [^>]*class="cf-bg"/);
  });

  it('escapes markup in source text — a diagram must not inject svg', () => {
    const evil: RFNode[] = [{
      ...nodes[0],
      data: { ...nodes[0].data, label: '</svg><script>x</script>', statements: ['a < b && c > d'] },
    }];
    const out = graphToSvg({ nodes: evil, edges: [], tokens: TOKENS, background: 'paper' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;');
    expect(out).toContain('&amp;&amp;');
  });

  it('embeds the font family from the token', () => {
    expect(svg()).toContain('monospace');
  });

  it('is deterministic', () => {
    expect(svg()).toBe(svg());
  });

  it('handles an empty graph without throwing', () => {
    const out = graphToSvg({ nodes: [], edges: [], tokens: TOKENS, background: 'paper' });
    expect(out).toContain('<svg');
  });
});
```

- [ ] **Step 3: Run it** → FAIL (no module)

- [ ] **Step 4: Implement `toSvg.ts`**

Requirements the tests pin down:

- Compute bounds from node positions and sizes; add padding; emit `viewBox`.
- One element per node kind: `rect` (rounded) for `basic`, `polygon` for `branch`/`switch`,
  `rect` with `rx` = half-height for `entry`/`exit`, plus the doubled left rule for
  `loop-header` and the filled cap for `return`. **Same shape language as the canvas**,
  or the export is a different diagram.
- Edges: use routed `points` when present, else a straight line. `stroke-dasharray` for
  `back`/`exception`/`break`/`continue`, and always render the label with a background
  rect behind it so it stays readable over an edge.
- Text: `<text>` per statement line, `font-family` from `--font-mono`, clipped to node
  width. Escape `& < > " '` — a `<` in someone's code must not become markup.
- `unsupported: 'unreachable'` → `opacity: 0.55` and a dashed border, matching the canvas.

- [ ] **Step 5: Run it** → PASS (11 tests)

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: deterministic SVG serialization from the IR"
```

---

## Task 2: Raster export

**Files:**
- Create: `src/lib/export/toRaster.ts`
- Test: `src/lib/export/toRaster.test.ts`

**Interfaces:**
- Consumes: `graphToSvg`.
- Produces: `svgToBlob(svg: string, format: 'png'|'jpeg', scale: number, background: string): Promise<Blob>`

- [ ] **Step 1: Write the test** (jsdom has no real canvas, so assert the contract and
mock `Image`/`toBlob`; the visual check is Task 3 Step 5, by eye):

```ts
it('rejects a scale that would exceed the canvas limit', async () => {
  await expect(svgToBlob('<svg width="8000" height="8000"/>', 'png', 4, '#fff'))
    .rejects.toThrow(/too large/i);
});

it('always paints a background for jpeg — it has no alpha', async () => { /* … */ });
it('resolves to a Blob of the requested type', async () => { /* … */ });
```

- [ ] **Step 2: Implement.** `new Image()` from a `data:image/svg+xml;base64,…` URL (base64,
not `encodeURIComponent` — Safari mishandles some UTF-8 there), draw to a canvas at
`scale`, `toBlob`. Guard total pixels: browsers cap canvas area (~268MP on Chrome, lower
on iOS Safari), so refuse above ~64MP with a plain-language error rather than producing a
blank image.

- [ ] **Step 3: Commit**

---

## Task 3: Export UI

**Files:**
- Create: `src/components/export/ExportMenu.tsx`, `ExportMenu.css`
- Modify: the Workbench toolbar

- [ ] **Step 1: Build the menu** — format (PNG / JPEG / SVG), scale (1× / 2× / 3×, PNG and
JPEG only), background (transparent / paper / white; transparent disabled for JPEG with a
reason shown, not silently), and "include sticky notes".

- [ ] **Step 2: Read tokens at export time**

```ts
const style = getComputedStyle(document.documentElement);
const tokens = Object.fromEntries(
  TOKEN_NAMES.map((n) => [n, style.getPropertyValue(n).trim()]),
);
```

This is why the exporter takes tokens as a parameter: it picks up whichever theme is
active, and a future theme needs no export change.

- [ ] **Step 3: Trigger the download** from the click handler, via
`URL.createObjectURL` + a synthetic `<a download>`, then `revokeObjectURL`. Filename:
`{project-title}-{function-name}.{ext}`, slugified.

- [ ] **Step 4: All 8 states.** The export button shows a loading state while rasterizing
(a 3× export of a large graph is not instant), success is silent — the file downloading is
the confirmation — and failure states the reason.

- [ ] **Step 5: Verify by eye — the part that matters**

1. Export binary search as PNG at 2× in **dark** theme: sharp text, no clipped nodes.
2. Same in **light** theme.
3. Export as JPEG with a white background, open it: no black box where transparency was.
4. Export SVG, open in a browser, **zoom to 400%**: still crisp.
5. **Convert one export to grayscale.** Every branch, loop, and return must still be
   identifiable. If not, the shape language failed, and that is a bug in the node views —
   not something to fix in the exporter.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: PNG, JPEG, and SVG export with theme-aware tokens"
```

---

## Task 4: Sticky notes

**Files:**
- Create: `src/components/canvas/AnnotationNode.tsx`
- Modify: `toReactFlow.ts`, `FlowCanvas.tsx`, `toSvg.ts`
- Test: extend `toReactFlow.test.ts`, `toSvg.test.ts`

- [ ] **Step 1: Extend `toReactFlow`** to accept `annotations: Annotation[]` and emit them as
`type: 'annotation'` nodes. They are **not** IR nodes: they have no structural id, they
are never re-derived, and they carry `draggable: true` with no source/target handles.

- [ ] **Step 2: Build `AnnotationNode`** — a textarea-backed note, tokens only, saving on
blur through the Plan 2 action. Anchored notes (`node_id` set) move with their node;
free-floating ones keep their own position.

- [ ] **Step 3: Include them in export** behind the "include sticky notes" toggle.

- [ ] **Step 4: Verify** — add a note, reload (it persists), re-parse (it survives), export
(it appears).

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: sticky notes on the canvas and in exports"
```

---

## Self-Review

**Spec coverage:** §8 annotations (Task 4), §10 grayscale legibility (Task 3 Step 5), §11
size limits (Task 2).

**Deliberately not here:** PDF export (no learner asked for it), server-side rendering (a
headless browser for a job the client already has the data for), and batch export of every
function at once — revisit only if someone asks.

**Done when:** a dark-theme diagram exports as a sharp 2× PNG, an SVG stays crisp at 400%,
and a grayscale copy is still readable.
