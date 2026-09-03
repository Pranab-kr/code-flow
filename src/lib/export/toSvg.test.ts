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
