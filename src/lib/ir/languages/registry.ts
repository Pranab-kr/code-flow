import type { Language, Diagnostic } from '../types';
import type { SynFunction } from '../builder';
import { toSyn as pythonToSyn, type TSNode } from './python';

export type Adapter = (root: TSNode) => { funcs: SynFunction[]; diagnostics: Diagnostic[] };

/**
 * NOTE: cpp and java point at the Python adapter as a PLACEHOLDER so the registry
 * shape is settled. They are NOT working — real adapters land in Plan 3, and no
 * C++/Java option may be exposed to users before then.
 */
export const LANGUAGES: Record<
  Language,
  {
    /** Browser path: served from public/ by the CDN. */
    grammarUrl: string;
    /** npm package holding the wasm, for Node — public/ is absent on serverless. */
    nodePackage: string;
    adapter: Adapter;
  }
> = {
  python: {
    grammarUrl: '/grammars/tree-sitter-python.wasm',
    nodePackage: 'tree-sitter-python',
    adapter: pythonToSyn,
  },
  cpp: {
    grammarUrl: '/grammars/tree-sitter-cpp.wasm',
    nodePackage: 'tree-sitter-cpp',
    adapter: pythonToSyn,
  },
  java: {
    grammarUrl: '/grammars/tree-sitter-java.wasm',
    nodePackage: 'tree-sitter-java',
    adapter: pythonToSyn,
  },
};
