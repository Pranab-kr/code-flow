import type { Language, Diagnostic } from '../types';
import type { SynFunction } from '../builder';
import { toSyn as pythonToSyn } from './python';
import { toSyn as cppToSyn } from './cpp';
import { toSyn as javaToSyn } from './java';
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
  java: {
    grammarUrl: '/grammars/tree-sitter-java.wasm',
    nodePackage: 'tree-sitter-java',
    adapter: javaToSyn,
  },
};
