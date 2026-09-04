import type { Diagnostic } from '../types';
import type { SynFunction } from '../builder';
import { diagnosticsFor, type TSNode } from './tsnode';

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  return { funcs: [], diagnostics: diagnosticsFor(root) };
}
