// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseToIR } from './parse';
import type { ProgramIR } from './types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '__fixtures__/python');

/**
 * Strip volatile fields so the snapshot captures STRUCTURE, not incidentals.
 * Edge ids are allocation-ordered, so they would churn on unrelated changes.
 */
function normalize(ir: ProgramIR) {
  return {
    language: ir.language,
    functions: ir.functions.map((f) => ({
      id: f.id,
      entryId: f.entryId,
      exitCount: f.exitIds.length,
      nodes: f.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        statements: n.statements,
        ...(n.meta?.loopKind ? { loopKind: n.meta.loopKind } : {}),
        ...(n.meta?.unsupported ? { unsupported: n.meta.unsupported } : {}),
      })),
      edges: f.edges
        .map((e) => ({ source: e.source, target: e.target, kind: e.kind, label: e.label }))
        .sort((a, b) =>
          `${a.source}|${a.target}|${a.kind}`.localeCompare(`${b.source}|${b.target}|${b.kind}`),
        ),
    })),
    callEdges: ir.callEdges.map((c) => ({ from: c.from, to: c.to })),
    diagnostics: ir.diagnostics.map((d) => d.severity),
  };
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.py'))
  .sort();

describe('python golden fixtures', () => {
  it('has all 12 fixtures', () => {
    expect(files).toHaveLength(12);
  });

  for (const file of files) {
    it(`matches the golden IR for ${file}`, async () => {
      const source = readFileSync(path.join(DIR, file), 'utf8');
      const ir = await parseToIR(source, 'python', { baseUrl: 'public' });
      // A fixture is valid source: any error here is a parser bug, not a fixture typo.
      expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(normalize(ir)).toMatchSnapshot();
    });
  }
});

describe('structural invariants across every fixture', () => {
  it('never emits a dangling edge or a duplicate node id', async () => {
    for (const file of files) {
      const source = readFileSync(path.join(DIR, file), 'utf8');
      const ir = await parseToIR(source, 'python', { baseUrl: 'public' });
      for (const f of ir.functions) {
        const ids = new Set(f.nodes.map((n) => n.id));
        expect(ids.size, `${file} ${f.id}: duplicate node ids`).toBe(f.nodes.length);
        for (const e of f.edges) {
          expect(ids.has(e.source), `${file} ${f.id}: edge from unknown ${e.source}`).toBe(true);
          expect(ids.has(e.target), `${file} ${f.id}: edge to unknown ${e.target}`).toBe(true);
        }
      }
    }
  });

  it('every node except entry is reachable, or explicitly tagged unreachable', async () => {
    for (const file of files) {
      const source = readFileSync(path.join(DIR, file), 'utf8');
      const ir = await parseToIR(source, 'python', { baseUrl: 'public' });
      for (const f of ir.functions) {
        const hasIncoming = new Set(f.edges.map((e) => e.target));
        for (const n of f.nodes) {
          if (n.id === f.entryId) continue;
          const ok = hasIncoming.has(n.id) || n.meta?.unsupported === 'unreachable';
          expect(ok, `${file} ${f.id}: orphan node ${n.id} (${n.kind})`).toBe(true);
        }
      }
    }
  });
});
