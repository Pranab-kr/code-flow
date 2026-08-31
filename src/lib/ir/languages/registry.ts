import type { Language, Diagnostic } from '../types';
import type { SynFunction } from '../builder';
import { toSyn as pythonToSyn, type TSNode } from './python';

export type Adapter = (root: TSNode) => { funcs: SynFunction[]; diagnostics: Diagnostic[] };

/**
 * NOTE: cpp and java point at the Python adapter as a PLACEHOLDER so the registry
 * shape is settled. They are NOT working — real adapters land in Plan 3, and no
 * C++/Java option may be exposed to users before then.
 */
export const LANGUAGES: Record<Language, { grammarUrl: string; adapter: Adapter }> = {
  python: { grammarUrl: '/grammars/tree-sitter-python.wasm', adapter: pythonToSyn },
  cpp: { grammarUrl: '/grammars/tree-sitter-cpp.wasm', adapter: pythonToSyn },
  java: { grammarUrl: '/grammars/tree-sitter-java.wasm', adapter: pythonToSyn },
};
