// @vitest-environment node
// web-tree-sitter needs Node's filesystem to load the grammar wasm.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseToIR } from './parse';
import type { Language, ProgramIR } from './types';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

/**
 * One suite per language, over its own fixture directory.
 *
 * Describe names stay `<lang> golden fixtures` because the Python snapshots were
 * read and verified once already — renaming the suite would orphan all 12 keys and
 * silently re-record them, which is exactly the protection a golden test exists for.
 */
const SUITES: { language: Language; dir: string; ext: string; count: number }[] = [
  { language: 'python', dir: 'python', ext: '.py', count: 12 },
  { language: 'cpp', dir: 'cpp', ext: '.cpp', count: 14 },
];

for (const suite of SUITES) {
  const DIR = path.join(HERE, '__fixtures__', suite.dir);
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(suite.ext))
    .sort();

  describe(`${suite.language} golden fixtures`, () => {
    it(`has all ${suite.count} fixtures`, () => {
      expect(files).toHaveLength(suite.count);
    });

    for (const file of files) {
      it(`matches the golden IR for ${file}`, async () => {
        const source = readFileSync(path.join(DIR, file), 'utf8');
        const ir = await parseToIR(source, suite.language, { baseUrl: 'public' });
        // A fixture is valid source: any error here is a parser bug, not a fixture typo.
        expect(ir.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(normalize(ir)).toMatchSnapshot();
      });
    }
  });

  describe(`${suite.language}: structural invariants across every fixture`, () => {
    it('never emits a dangling edge or a duplicate node id', async () => {
      for (const file of files) {
        const source = readFileSync(path.join(DIR, file), 'utf8');
        const ir = await parseToIR(source, suite.language, { baseUrl: 'public' });
        for (const f of ir.functions) {
          const ids = new Set(f.nodes.map((n) => n.id));
          expect(ids.size, `${file} ${f.id}: duplicate node ids`).toBe(f.nodes.length);
          for (const e of f.edges) {
            expect(ids.has(e.source), `${file} ${f.id}: edge from unknown ${e.source}`).toBe(
              true,
            );
            expect(ids.has(e.target), `${file} ${f.id}: edge to unknown ${e.target}`).toBe(true);
          }
        }
      }
    });

    it('every node except entry is reachable, or explicitly tagged unreachable', async () => {
      for (const file of files) {
        const source = readFileSync(path.join(DIR, file), 'utf8');
        const ir = await parseToIR(source, suite.language, { baseUrl: 'public' });
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
}
