/**
 * The shared tree-sitter surface every adapter builds on.
 *
 * Lifted out of python.ts so cpp.ts and java.ts import it from here rather than
 * from a sibling adapter. Nothing in this file knows any grammar's node types —
 * the four helpers below are true of tree-sitter generally, which is why they are
 * shared instead of triplicated.
 *
 * Portability rule still applies: no React, no Next, no DOM globals.
 */

import type { Diagnostic, Span } from '../types';
import type { SynNode } from '../builder';

/**
 * The slice of a tree-sitter node the adapters need.
 *
 * Note these are PROTOTYPE GETTERS on the real object, not own properties — so
 * never `{...node}` a tree-sitter node. The spread silently copies none of them
 * and the result looks like an untyped node rather than throwing.
 */
export interface TSNode {
  /**
   * Stable per-node identity. Needed because the accessors return a FRESH wrapper
   * object on every call, so `childForFieldName('value') !== namedChildren[0]` even
   * when both name the same node — comparing with `!==` silently never matches.
   */
  id: number;
  type: string;
  text: string;
  startPosition: { row: number };
  endPosition: { row: number };
  namedChildren: TSNode[];
  children: TSNode[];
  childForFieldName(name: string): TSNode | null;
  hasError: boolean;
  /** True on a node tree-sitter inserted to recover, e.g. a missing ')'. */
  isMissing: boolean;
  isNamed: boolean;
}

export const span = (n: TSNode): Span => ({
  startLine: n.startPosition.row + 1,
  endLine: n.endPosition.row + 1,
});

export const syn = (
  kind: SynNode['kind'],
  text: string,
  children: SynNode[],
  s: Span,
  meta?: SynNode['meta'],
): SynNode => ({ kind, text: text.trim(), children, span: s, meta });

/** First line only — node text can span many lines. */
export function head(n: TSNode): string {
  return n.text.split('\n')[0].trim();
}

/**
 * Collect ERROR and MISSING nodes so a broken parse still reports where it broke.
 *
 * Both cases matter and they are distinct: tree-sitter emits an `ERROR` node for
 * text it cannot fit the grammar, but for a recoverable omission it instead
 * inserts a zero-width node with `isMissing` set — `def f(:` yields
 * `(parameters (MISSING ")"))` and no ERROR node anywhere. Checking only for
 * `ERROR` therefore reports nothing on a whole class of real syntax errors.
 */
export function collectDiagnostics(node: TSNode, out: Diagnostic[]): void {
  if (node.isMissing) {
    out.push({
      severity: 'error',
      message: `Syntax error: missing ${node.type}`,
      span: span(node),
    });
    return;
  }
  if (node.type === 'ERROR') {
    out.push({
      severity: 'error',
      message: `Syntax error near "${head(node)}"`,
      span: span(node),
    });
    return;
  }
  for (const c of node.children) if (c.hasError) collectDiagnostics(c, out);
}

/** Diagnostics for a whole tree, or none when the parse was clean. */
export function diagnosticsFor(root: TSNode): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (root.hasError) collectDiagnostics(root, out);
  return out;
}
