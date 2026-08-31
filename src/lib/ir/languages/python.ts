/**
 * Python tree-sitter -> SynNode adapter.
 *
 * This is the ONLY place Python grammar node types appear. The builder consumes
 * the normalized SynNode tree and never learns which language produced it.
 */

import type { Diagnostic, Span } from '../types';
import type { SynFunction, SynNode } from '../builder';

/**
 * The slice of a tree-sitter node this adapter needs.
 *
 * Note these are PROTOTYPE GETTERS on the real object, not own properties — so
 * never `{...node}` a tree-sitter node. The spread silently copies none of them
 * and the result looks like an untyped node rather than throwing.
 */
export interface TSNode {
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

const span = (n: TSNode): Span => ({
  startLine: n.startPosition.row + 1,
  endLine: n.endPosition.row + 1,
});

const syn = (
  kind: SynNode['kind'],
  text: string,
  children: SynNode[],
  s: Span,
  meta?: SynNode['meta'],
): SynNode => ({ kind, text: text.trim(), children, span: s, meta });

/** First line only — node text can span many lines. */
function head(n: TSNode): string {
  return n.text.split('\n')[0].trim();
}

function block(n: TSNode | null): TSNode[] {
  if (!n) return [];
  return n.type === 'block' ? n.namedChildren : [n];
}

function stmts(list: TSNode[]): SynNode[] {
  return list.flatMap(toSynStmt);
}

/**
 * Fold `[elif, elif, …, else]` into a single nested-if else arm.
 *
 * Recurses over the CLAUSE LIST, never over a synthesized node: see the TSNode
 * note above for why spreading one loses every clause after the first elif.
 */
function elseArmOf(alts: TSNode[]): SynNode[] {
  if (alts.length === 0) return [];
  const [first, ...rest] = alts;
  if (first.type === 'else_clause') {
    return stmts(block(first.childForFieldName('body')));
  }
  const cond = first.childForFieldName('condition')!;
  const body = stmts(block(first.childForFieldName('consequence')));
  const deeper = elseArmOf(rest);
  return [
    syn('if', head(cond), body, span(first), deeper.length ? { elseBody: deeper } : undefined),
  ];
}

function toSynStmt(n: TSNode): SynNode[] {
  switch (n.type) {
    case 'if_statement': {
      const cond = n.childForFieldName('condition')!;
      const thenBody = stmts(block(n.childForFieldName('consequence')));
      const alts = n.children.filter(
        (c) => c.type === 'elif_clause' || c.type === 'else_clause',
      );
      const elseBody = elseArmOf(alts);
      // children = then arm ONLY; the else arm travels in meta.elseBody
      return [
        syn('if', head(cond), thenBody, span(n), elseBody.length ? { elseBody } : undefined),
      ];
    }

    case 'while_statement': {
      const cond = n.childForFieldName('condition')!;
      const elseClause = n.children.find((c) => c.type === 'else_clause');
      return [
        syn('loop', head(cond), stmts(block(n.childForFieldName('body'))), span(n), {
          loopKind: 'while',
          ...(elseClause
            ? { elseBody: stmts(block(elseClause.childForFieldName('body'))) }
            : {}),
        }),
      ];
    }

    case 'for_statement': {
      const left = n.childForFieldName('left');
      const right = n.childForFieldName('right');
      const elseClause = n.children.find((c) => c.type === 'else_clause');
      return [
        syn(
          'loop',
          `${left?.text ?? '_'} in ${right?.text ?? '_'}`,
          stmts(block(n.childForFieldName('body'))),
          span(n),
          {
            loopKind: 'foreach',
            ...(elseClause
              ? { elseBody: stmts(block(elseClause.childForFieldName('body'))) }
              : {}),
          },
        ),
      ];
    }

    case 'try_statement': {
      const finallyClause = n.children.find((c) => c.type === 'finally_clause');
      const excepts = n.children.filter((c) => c.type === 'except_clause');
      return [
        syn('try', 'try', stmts(block(n.childForFieldName('body'))), span(n), {
          ...(finallyClause
            ? { finallyBody: stmts(block(finallyClause.namedChildren.at(-1) ?? null)) }
            : {}),
          // map, NOT flatMap — one array per handler keeps handler boundaries
          ...(excepts.length
            ? { catchBodies: excepts.map((e) => stmts(block(e.namedChildren.at(-1) ?? null))) }
            : {}),
        }),
      ];
    }

    case 'return_statement':
      return [syn('return', head(n), [], span(n))];
    case 'raise_statement':
      return [syn('throw', head(n), [], span(n))];
    case 'break_statement':
      return [syn('break', 'break', [], span(n))];
    case 'continue_statement':
      return [syn('continue', 'continue', [], span(n))];

    case 'match_statement': {
      const cases = n.namedChildren
        .flatMap((c) => (c.type === 'block' ? c.namedChildren : [c]))
        .filter((c) => c.type === 'case_clause')
        .map((c) => {
          // Strip the keyword AND the trailing colon: 'case 1:' would otherwise
          // yield the pattern '1:', which leaks into labels and never matches '_'.
          const pattern = head(c)
            .replace(/^case\s*/, '')
            .replace(/:\s*$/, '')
            .trim();
          const body = c.childForFieldName('consequence') ?? c.namedChildren.at(-1) ?? null;
          return syn(
            'case',
            head(c),
            stmts(block(body)),
            span(c),
            pattern === '_' ? { isDefault: true } : { caseValue: pattern },
          );
        });
      return [syn('switch', head(n.childForFieldName('subject') ?? n), cases, span(n))];
    }

    default:
      if (!n.isNamed) return [];
      return [syn('stmt', head(n), [], span(n))];
  }
}

function params(fn: TSNode): string[] {
  const p = fn.childForFieldName('parameters');
  if (!p) return [];
  return p.namedChildren
    .map((c) => (c.childForFieldName('name') ?? c).text.trim())
    .filter((t) => t && t !== 'self');
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
function collectDiagnostics(node: TSNode, out: Diagnostic[]): void {
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

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (root.hasError) collectDiagnostics(root, diagnostics);

  const funcs: SynFunction[] = [];

  const visit = (n: TSNode, enclosingClass?: string) => {
    if (n.type === 'function_definition') {
      const name = n.childForFieldName('name')?.text ?? '<anonymous>';
      const ps = params(n);
      // Qualify methods with their class, so two classes each defining `push`
      // do not collide into one FunctionGraph id.
      const base = `${name}(${ps.join(',')})`;
      funcs.push({
        id: enclosingClass ? `${enclosingClass}.${base}` : base,
        name,
        params: ps,
        node: syn('func', name, stmts(block(n.childForFieldName('body'))), span(n)),
      });
      // P1 does not descend into nested defs: a closure or inner helper is
      // DROPPED from the diagram. Acceptable for DSA code, where nesting is rare.
      return;
    }
    const nextClass =
      n.type === 'class_definition'
        ? (n.childForFieldName('name')?.text ?? enclosingClass)
        : enclosingClass;
    for (const c of n.namedChildren) visit(c, nextClass);
  };
  visit(root);

  return { funcs, diagnostics };
}
