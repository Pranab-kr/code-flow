import type { Language, Diagnostic } from '../types';
import type { SynFunction } from '../builder';
import { toSyn as pythonToSyn } from './python';
import { toSyn as cppToSyn } from './cpp';
import type { TSNode } from './tsnode';

export type Adapter = (root: TSNode) => { funcs: SynFunction[]; diagnostics: Diagnostic[] };

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
    adapter: cppToSyn,
  },
  /**
   * NOTE: java still points at the Python adapter as a PLACEHOLDER so the registry
   * shape stays settled. It is NOT working — the real adapter is Plan 3 Task 2, and
   * no Java option may be exposed to users before then.
   */
  java: {
    grammarUrl: '/grammars/tree-sitter-java.wasm',
    nodePackage: 'tree-sitter-java',
    adapter: pythonToSyn,
  },
};
