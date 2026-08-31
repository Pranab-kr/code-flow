// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseToIR } from './parse';
import type { FunctionGraph, Language } from './types';

const DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/isomorphic',
);

/** Structural fingerprint: control-flow kinds and topology, ignoring source text. */
function shape(graph: FunctionGraph) {
  return {
    nodes: graph.nodes.map((node) => node.kind).sort(),
    edges: graph.edges.map((edge) => edge.kind).sort(),
    exits: graph.exitIds.length,
  };
}

const CASES = ['binary-search', 'bfs', 'quicksort', 'fib'] as const;
const LANGUAGES: [Language, string][] = [
  ['python', 'py'],
  ['cpp', 'cpp'],
  ['java', 'java'],
];

describe('cross-language isomorphism', () => {
  for (const name of CASES) {
    it(`${name} produces the same graph shape in all three languages`, async () => {
      const shapes = await Promise.all(
        LANGUAGES.map(async ([language, extension]) => {
          const source = readFileSync(path.join(DIR, `${name}.${extension}`), 'utf8');
          const ir = await parseToIR(source, language, { baseUrl: 'public' });
          expect(
            ir.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
            `${name}.${extension}`,
          ).toEqual([]);
          expect(ir.functions, `${name}.${extension}`).toHaveLength(1);
          return { language, shape: shape(ir.functions[0]) };
        }),
      );

      const [reference, ...others] = shapes;
      for (const other of others) {
        expect(
          other.shape,
          `${name}: ${other.language} differs from ${reference.language}`,
        ).toEqual(reference.shape);
      }
    });
  }
});
