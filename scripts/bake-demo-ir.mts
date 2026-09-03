/**
 * Bake the marketing hero IR once, commit the JSON.
 *
 * The hero must not download ~460KB of tree-sitter wasm to show a picture:
 * this script parses the demo binary-search source and lays it out at author
 * time, so `HeroCanvas` renders the real `FlowCanvas` from static JSON.
 *
 * Run manually after changing the hero source, then commit the output:
 *
 *   pnpm dlx -y tsx scripts/bake-demo-ir.mts
 *
 * (tsx is not a repo dependency on purpose — this runs rarely, by hand.)
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToIR } from '../src/lib/ir/parse';
import { layoutProgram } from '../src/lib/layout/elk';

const SOURCE = `def binary_search(arr, target):
    lo = 0
    hi = len(arr) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if arr[mid] == target:
            return mid
        elif arr[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1
`;

const ir = await parseToIR(SOURCE, 'python', { baseUrl: 'public' });
const fn = ir.functions[0];
if (!fn) throw new Error('hero source produced no functions');
const layouts = await layoutProgram(ir.functions);
const layout = layouts[fn.id];
if (!layout) throw new Error(`no layout for ${fn.id}`);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'demo-ir.json');
writeFileSync(out, JSON.stringify({ graph: fn, layout }, null, 2) + '\n');
console.log(
  `baked ${fn.id}: ${fn.nodes.length} nodes, ${fn.edges.length} edges -> src/lib/demo-ir.json`,
);
