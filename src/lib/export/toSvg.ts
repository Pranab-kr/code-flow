/**
 * Deterministic SVG serialization, drawn from the graph geometry — not from
 * the DOM.
 *
 * React Flow renders edges as SVG inside a transformed container and wraps
 * custom nodes in foreignObject, so DOM rasterizers (html-to-image and
 * friends) drop web fonts and misplace edges. We already hold node positions,
 * sizes, and routed edge points, so draw directly: pure string building, no
 * DOM globals, testable in Node.
 *
 * Shape language mirrors `src/components/canvas/canvas.css`: diamonds for
 * decisions, pill terminals, doubled accent rule for loop headers, filled
 * accent cap for returns, dashed danger border for throws, dimmed + dashed
 * for unreachable. An export must read as the same diagram, including in
 * grayscale.
 */

import type { FlowNode, RFEdge } from '@/components/canvas/toReactFlow';
import type { EdgeKind, NodeKind } from '@/lib/ir/types';
import type { LaidOutGraph } from '@/lib/layout/types';

export interface SvgPoint {
  x: number;
  y: number;
}

export type ExportEdge = RFEdge & { points?: SvgPoint[] };

export interface SvgOptions {
  /** IR nodes plus sticky notes (`type: 'annotation'`); notes render as notes. */
  nodes: FlowNode[];
  edges: ExportEdge[];
  tokens: Record<string, string>;
  background: 'transparent' | 'paper' | 'white';
  padding?: number;
  /** Optional routed geometry (ELK output); per-edge `points` win when present. */
  layout?: LaidOutGraph;
}

const DEFAULT_PADDING = 24;
/** Explicit user choice ("white background for slides"), not a theme color. */
const WHITE_BG = '#ffffff';
const FALLBACK_W = 140;
const FALLBACK_H = 40;

const EDGE_KINDS: ReadonlySet<string> = new Set([
  'seq',
  'true',
  'false',
  'case',
  'default',
  'back',
  'break',
  'continue',
  'exception',
  'call',
]);

function dashFor(kind: string): string | null {
  if (kind === 'back') return '5 4';
  if (kind === 'exception') return '2 3';
  if (kind === 'break' || kind === 'continue') return '6 3';
  return null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Round to 2dp and strip trailing noise, so output is stable across runs. */
function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isFinite(r) ? String(r) : '0';
}

function tok(tokens: Record<string, string>, name: string, fallback: string): string {
  const v = tokens[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : fallback;
}

function edgeKindOf(e: ExportEdge): EdgeKind {
  const d = e.data?.kind;
  if (typeof d === 'string' && EDGE_KINDS.has(d)) return d as EdgeKind;
  const cls = typeof e.className === 'string' ? e.className : '';
  const m = cls.match(/cf-edge-([a-z]+)/);
  if (m && EDGE_KINDS.has(m[1])) return m[1] as EdgeKind;
  return 'seq';
}

function edgeLabelOf(e: ExportEdge): string | null {
  return typeof e.label === 'string' && e.label !== '' ? e.label : null;
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

function placedOf(n: FlowNode): Placed {
  const w = typeof n.width === 'number' && Number.isFinite(n.width) ? n.width : FALLBACK_W;
  const h = typeof n.height === 'number' && Number.isFinite(n.height) ? n.height : FALLBACK_H;
  const x = n.position.x;
  const y = n.position.y;
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

function pointsFor(
  e: ExportEdge,
  at: Map<string, Placed>,
  layout?: LaidOutGraph,
): SvgPoint[] {
  if (e.points && e.points.length >= 2) return e.points;
  if (layout) {
    const routed = layout.edges.find((r) => r.id === e.id);
    if (routed && routed.points.length >= 2) return routed.points;
  }
  const s = at.get(e.source);
  const t = at.get(e.target);
  if (!s || !t) return [];
  return [
    { x: s.cx, y: s.cy },
    { x: t.cx, y: t.cy },
  ];
}

function pathD(pts: SvgPoint[]): string {
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${fmt(p.x)} ${fmt(p.y)}`).join(' ');
}

function midpoint(pts: SvgPoint[]): SvgPoint {
  if (pts.length === 2) {
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }
  return pts[Math.floor(pts.length / 2)];
}

interface Caption {
  text: string;
  fill: string;
}

function captionsFor(kind: NodeKind, loopKind: string | undefined, unreachable: boolean, ink3: string, warn: string): Caption[] {
  const out: Caption[] = [];
  if (kind === 'loop-header') out.push({ text: `${loopKind ?? 'loop'} \u21BB`, fill: ink3 });
  else if (kind === 'return') out.push({ text: 'return', fill: ink3 });
  else if (kind === 'throw') out.push({ text: 'throw', fill: ink3 });
  else if (kind === 'branch') out.push({ text: 'if', fill: ink3 });
  else if (kind === 'switch') out.push({ text: 'switch', fill: ink3 });
  if (unreachable) out.push({ text: '\u26A0 unreachable', fill: warn });
  return out;
}

export function graphToSvg(opts: SvgOptions): string {
  const { nodes, edges, tokens, background } = opts;
  const pad = opts.padding ?? DEFAULT_PADDING;

  const ink = tok(tokens, '--color-ink', 'black');
  const ink2 = tok(tokens, '--color-ink-2', ink);
  const ink3 = tok(tokens, '--color-ink-3', ink);
  const nodeFill = tok(tokens, '--color-node', 'white');
  const nodeBorder = tok(tokens, '--color-node-brdr', 'currentColor');
  const edgeColor = tok(tokens, '--color-edge', 'currentColor');
  const edgeBack = tok(tokens, '--color-edge-back', edgeColor);
  const accent = tok(tokens, '--color-accent', 'currentColor');
  const danger = tok(tokens, '--color-danger', 'red');
  const warn = tok(tokens, '--color-warn', danger);
  const canvasBg = tok(tokens, '--color-canvas', 'white');
  const paper3 = tok(tokens, '--color-paper-3', nodeFill);
  const noteFill = tok(tokens, '--color-paper-2', nodeFill);
  const fontMono = tok(tokens, '--font-mono', 'monospace');

  const at = new Map<string, Placed>();
  for (const n of nodes) at.set(n.id, placedOf(n));

  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  if (nodes.length > 0) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const p of at.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
  }
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(vbH)}" width="${fmt(vbW)}" height="${fmt(vbH)}" role="img" font-family="${esc(fontMono)}">`,
  );

  // Markers, one per edge palette so arrowheads match their stroke.
  parts.push('<defs>');
  const markers: Array<[string, string]> = [
    ['cf-arrow', edgeColor],
    ['cf-arrow-back', edgeBack],
    ['cf-arrow-danger', danger],
  ];
  for (const [id, fill] of markers) {
    parts.push(
      `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="${esc(fill)}"/></marker>`,
    );
  }
  nodes.forEach((n, i) => {
    const p = at.get(n.id);
    if (!p) return;
    parts.push(
      `<clipPath id="cf-clip-${i}"><rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.w)}" height="${fmt(p.h)}"/></clipPath>`,
    );
  });
  parts.push('</defs>');

  if (background === 'paper') {
    parts.push(
      `<rect class="cf-bg" x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="${esc(canvasBg)}"/>`,
    );
  } else if (background === 'white') {
    parts.push(
      `<rect class="cf-bg" x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(vbH)}" fill="${esc(WHITE_BG)}"/>`,
    );
  }

  const labelParts: string[] = [];

  for (const e of edges) {
    const kind = edgeKindOf(e);
    const pts = pointsFor(e, at, opts.layout);
    if (pts.length < 2) continue;
    const stroke = kind === 'back' ? edgeBack : kind === 'exception' ? danger : edgeColor;
    const marker = kind === 'back' ? 'cf-arrow-back' : kind === 'exception' ? 'cf-arrow-danger' : 'cf-arrow';
    const dash = dashFor(kind);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
    parts.push(
      `<g class="cf-edge cf-edge-${esc(kind)}"><path d="${esc(pathD(pts))}" fill="none" stroke="${esc(stroke)}" stroke-width="1.5"${dashAttr} marker-end="url(#${marker})"/></g>`,
    );
    const label = edgeLabelOf(e);
    if (label !== null) {
      const m = midpoint(pts);
      const w = Math.ceil(label.length * 6.2 + 12);
      const h = 18;
      labelParts.push(
        `<g class="cf-edge-label"><rect x="${fmt(m.x - w / 2)}" y="${fmt(m.y - h / 2)}" width="${fmt(w)}" height="${fmt(h)}" rx="3" fill="${esc(canvasBg)}"/><text x="${fmt(m.x)}" y="${fmt(m.y + 3.5)}" text-anchor="middle" font-family="${esc(fontMono)}" font-size="10" fill="${esc(ink2)}" xml:space="preserve">${esc(label)}</text></g>`,
      );
    }
  }

  nodes.forEach((n, i) => {
    const p = at.get(n.id);
    if (!p) return;
    if (n.type === 'annotation') {
      // Sticky note: the same note shape as the canvas (rect + thick top
      // rule), so the export reads as the same diagram. The top rule — not
      // colour — is what marks it at a glance in grayscale.
      const raw = typeof n.data.body === 'string' ? n.data.body : '';
      const noteLines = raw.split('\n');
      const noteShown = noteLines.slice(0, 6);
      const noteExtra = noteLines.length - noteShown.length;
      parts.push('<g class="cf-note">');
      parts.push(
        `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.w)}" height="${fmt(p.h)}" rx="4" fill="${esc(noteFill)}" stroke="${esc(nodeBorder)}" stroke-width="1.5"/>`,
      );
      parts.push(
        `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.w)}" height="4" fill="${esc(warn)}"/>`,
      );
      parts.push(`<g clip-path="url(#cf-clip-${i})">`);
      parts.push(
        `<text x="${fmt(p.x + 12)}" y="${fmt(p.y + 22)}" font-family="${esc(fontMono)}" font-size="9" fill="${esc(ink3)}" xml:space="preserve">note</text>`,
      );
      let cursor = p.y + 38;
      for (const s of noteShown) {
        parts.push(
          `<text x="${fmt(p.x + 12)}" y="${fmt(cursor)}" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink)}" xml:space="preserve">${esc(s)}</text>`,
        );
        cursor += 14;
      }
      if (noteExtra > 0) {
        parts.push(
          `<text x="${fmt(p.x + 12)}" y="${fmt(cursor)}" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink3)}" xml:space="preserve">+${noteExtra} more</text>`,
        );
      }
      parts.push('</g>');
      parts.push('</g>');
      return;
    }
    const kind = n.data.kind;
    const unreachable = n.data.unsupported === 'unreachable';
    const loopKind = typeof n.data.loopKind === 'string' ? n.data.loopKind : undefined;
    const lines = n.data.statements.length > 0 ? n.data.statements : [n.data.label];
    const shown = lines.slice(0, 6);
    const extra = lines.length - shown.length;
    const captions = captionsFor(kind, loopKind, unreachable, ink3, warn);
    const dim = unreachable ? ' opacity="0.55"' : '';
    const dashedShape = unreachable || kind === 'throw';

    parts.push(`<g class="cf-node" data-kind="${esc(kind)}"${dim}>`);

    if (kind === 'branch' || kind === 'switch') {
      const pts = `${fmt(p.cx)} ${fmt(p.y)} ${fmt(p.x + p.w)} ${fmt(p.cy)} ${fmt(p.cx)} ${fmt(p.y + p.h)} ${fmt(p.x)} ${fmt(p.cy)}`;
      const dashAttr = unreachable ? ' stroke-dasharray="6 3"' : '';
      parts.push(
        `<polygon points="${pts}" fill="${esc(nodeFill)}" stroke="${esc(nodeBorder)}" stroke-width="1.5"${dashAttr}/>`,
      );
      const total = captions.length + shown.length + (extra > 0 ? 1 : 0);
      const startY = p.cy - ((total - 1) * 14) / 2 + 4;
      let li = 0;
      for (const c of captions) {
        parts.push(
          `<text x="${fmt(p.cx)}" y="${fmt(startY + li * 14)}" text-anchor="middle" font-family="${esc(fontMono)}" font-size="9" fill="${esc(c.fill)}" xml:space="preserve">${esc(c.text)}</text>`,
        );
        li += 1;
      }
      for (const s of shown) {
        parts.push(
          `<text x="${fmt(p.cx)}" y="${fmt(startY + li * 14)}" text-anchor="middle" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink)}" xml:space="preserve">${esc(s)}</text>`,
        );
        li += 1;
      }
      if (extra > 0) {
        parts.push(
          `<text x="${fmt(p.cx)}" y="${fmt(startY + li * 14)}" text-anchor="middle" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink3)}" xml:space="preserve">+${extra} more</text>`,
        );
      }
    } else if (kind === 'entry' || kind === 'exit') {
      const rx = fmt(p.h / 2);
      const dashAttr = unreachable ? ' stroke-dasharray="6 3"' : '';
      parts.push(
        `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.w)}" height="${fmt(p.h)}" rx="${rx}" fill="${esc(paper3)}" stroke="${esc(nodeBorder)}" stroke-width="1.5"${dashAttr}/>`,
      );
      const total = shown.length + (extra > 0 ? 1 : 0);
      const startY = p.cy - ((total - 1) * 14) / 2 + 4;
      shown.forEach((s, si) => {
        parts.push(
          `<text x="${fmt(p.cx)}" y="${fmt(startY + si * 14)}" text-anchor="middle" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink)}" xml:space="preserve">${esc(s)}</text>`,
        );
      });
      if (extra > 0) {
        parts.push(
          `<text x="${fmt(p.cx)}" y="${fmt(startY + shown.length * 14)}" text-anchor="middle" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink3)}" xml:space="preserve">+${extra} more</text>`,
        );
      }
    } else {
      const stroke = kind === 'throw' ? danger : nodeBorder;
      const dashAttr = dashedShape ? ' stroke-dasharray="6 3"' : '';
      parts.push(
        `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="${fmt(p.w)}" height="${fmt(p.h)}" rx="8" fill="${esc(nodeFill)}" stroke="${esc(stroke)}" stroke-width="1.5"${dashAttr}/>`,
      );
      if (kind === 'loop-header') {
        parts.push(
          `<line x1="${fmt(p.x + 5)}" y1="${fmt(p.y + 6)}" x2="${fmt(p.x + 5)}" y2="${fmt(p.y + p.h - 6)}" stroke="${esc(accent)}" stroke-width="1.5"/>`,
        );
        parts.push(
          `<line x1="${fmt(p.x + 8.5)}" y1="${fmt(p.y + 6)}" x2="${fmt(p.x + 8.5)}" y2="${fmt(p.y + p.h - 6)}" stroke="${esc(accent)}" stroke-width="1.5"/>`,
        );
      } else if (kind === 'return') {
        parts.push(
          `<rect x="${fmt(p.x)}" y="${fmt(p.y)}" width="6" height="${fmt(p.h)}" fill="${esc(accent)}"/>`,
        );
      }
      parts.push(`<g clip-path="url(#cf-clip-${i})">`);
      let cursor = p.y + 16;
      for (const c of captions) {
        parts.push(
          `<text x="${fmt(p.x + 12)}" y="${fmt(cursor)}" font-family="${esc(fontMono)}" font-size="9" fill="${esc(c.fill)}" xml:space="preserve">${esc(c.text)}</text>`,
        );
        cursor += 13;
        if (captions.length > 0 && c === captions[captions.length - 1]) cursor += 1;
      }
      if (captions.length > 0) cursor += 1;
      for (const s of shown) {
        parts.push(
          `<text x="${fmt(p.x + 12)}" y="${fmt(cursor)}" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink)}" xml:space="preserve">${esc(s)}</text>`,
        );
        cursor += 14;
      }
      if (extra > 0) {
        parts.push(
          `<text x="${fmt(p.x + 12)}" y="${fmt(cursor)}" font-family="${esc(fontMono)}" font-size="12" fill="${esc(ink3)}" xml:space="preserve">+${extra} more</text>`,
        );
      }
      parts.push('</g>');
    }

    parts.push('</g>');
  });

  for (const lp of labelParts) parts.push(lp);

  parts.push('</svg>');
  return parts.join('');
}
