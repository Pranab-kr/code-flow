// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm.
import { describe, it, expect } from 'vitest';
import { parseToIR } from '../parse';

const js = (source: string) => parseToIR(source, 'javascript', { baseUrl: 'public' });

describe('javascript grammar loader probe (spec §3)', () => {
  it('loads the grammar and builds a tree instead of throwing', async () => {
    const ir = await js('function add(a, b) {\n  return a + b;\n}\n');
    expect(ir.language).toBe('javascript');
    expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});
