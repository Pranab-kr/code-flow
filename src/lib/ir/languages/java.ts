/**
 * Java tree-sitter -> SynNode adapter.
 *
 * The ONLY place Java grammar node types appear. Every mapping was read off the
 * real tree-sitter-java 0.23.5 grammar with a scratch dump; the ones that differ
 * from a reasonable guess are worth knowing:
 *
 *   - a `switch` is a `switch_expression` even in statement position, and its arms
 *     are `switch_block_statement_group` (colon form, falls through) or
 *     `switch_rule` (arrow form, Java 14+, does NOT fall through).
 *   - `labeled_statement` exposes its label as a plain named child with NO field
 *     name, unlike C++ which has a `label:` field.
 *   - consecutive labels (`case 1: case 2:`) are SEPARATE groups where the first
 *     has an empty body, so ordinary fallthrough already models them correctly.
 *   - `try_with_resources_statement` is a distinct node type from `try_statement`.
 */

import type { Diagnostic } from '../types';
import type { SynFunction, SynNode } from '../builder';
import { diagnosticsFor, head, span, syn, type TSNode } from './tsnode';

/**
 * Statement children of a body.
 *
 * A non-block body is legal (`for (…) s += x;`) and arrives as a bare statement.
 * Comments are named nodes in this grammar, so they are dropped rather than drawn.
 */
function block(n: TSNode | null): TSNode[] {
  if (!n) return [];
  const list = n.type === 'block' || n.type === 'constructor_body' ? n.namedChildren : [n];
  return list.filter((c) => !isComment(c));
}

function isComment(n: TSNode): boolean {
  return n.type === 'line_comment' || n.type === 'block_comment' || n.type === 'comment';
}

function stmts(list: TSNode[]): SynNode[] {
  return list.flatMap(toSynStmt);
}

/** The test inside a `parenthesized_expression`, without its parentheses. */
function conditionText(n: TSNode | null): string {
  if (!n) return 'true';
  if (n.type === 'parenthesized_expression') {
    const inner = n.namedChildren.find((c) => !isComment(c));
    if (inner) return head(inner);
  }
  return head(n).replace(/^\(/, '').replace(/\)$/, '').trim();
}

/** The `identifier` a labeled break/continue names, or undefined when unlabeled. */
function jumpLabel(n: TSNode): string | undefined {
  return n.namedChildren.find((c) => c.type === 'identifier')?.text.trim();
}

const LOOP_TYPES = new Set([
  'for_statement',
  'enhanced_for_statement',
  'while_statement',
  'do_statement',
]);

function toSynStmt(n: TSNode): SynNode[] {
  switch (n.type) {
    // A bare `{ … }` group is transparent: it is a scope, not control flow.
    case 'block':
      return stmts(block(n));

    case 'if_statement': {
      const thenBody = stmts(block(n.childForFieldName('consequence')));
      const alt = n.childForFieldName('alternative');
      // `else if` arrives as an if_statement in the alternative field, so recursing
      // folds the chain into nested else arms with no special-casing.
      const elseBody = alt ? stmts(block(alt)) : [];
      // children = then arm ONLY; the else arm travels in meta.elseBody.
      return [
        syn(
          'if',
          conditionText(n.childForFieldName('condition')),
          thenBody,
          span(n),
          elseBody.length ? { elseBody } : undefined,
        ),
      ];
    }

    case 'while_statement':
      return [
        syn(
          'loop',
          conditionText(n.childForFieldName('condition')),
          stmts(block(n.childForFieldName('body'))),
          span(n),
          { loopKind: 'while' },
        ),
      ];

    case 'do_statement':
      return [
        syn(
          'loop',
          conditionText(n.childForFieldName('condition')),
          stmts(block(n.childForFieldName('body'))),
          span(n),
          { loopKind: 'do-while' },
        ),
      ];

    /**
     * Classic three-part `for`.
     *
     * The init becomes its own statement BEFORE the loop, which is when it runs.
     * The update rides in the header text rather than being appended to the body:
     * `continue` still runs the update in real Java, and the builder sends
     * `continue` to the header, so a trailing update node would be skipped and the
     * diagram would claim the increment never happened.
     */
    case 'for_statement': {
      const init = n.childForFieldName('init');
      const update = n.childForFieldName('update');
      const cond = n.childForFieldName('condition');
      const header = syn(
        'loop',
        cond ? head(cond) : 'true',
        stmts(block(n.childForFieldName('body'))),
        span(n),
        { loopKind: 'for' },
      );
      if (update) header.text = `${header.text}; ${head(update)}`;
      return init ? [syn('stmt', head(init), [], span(init)), header] : [header];
    }

    case 'enhanced_for_statement': {
      const name = n.childForFieldName('name');
      const value = n.childForFieldName('value');
      // Same 'x in xs' shape Python and C++ produce, so all three render alike.
      return [
        syn(
          'loop',
          `${name?.text.trim() ?? '_'} in ${value?.text.trim() ?? '_'}`,
          stmts(block(n.childForFieldName('body'))),
          span(n),
          { loopKind: 'foreach' },
        ),
      ];
    }

    case 'switch_expression': {
      const body = n.childForFieldName('body');
      const arms = (body?.namedChildren ?? []).filter(
        (c) => c.type === 'switch_block_statement_group' || c.type === 'switch_rule',
      );
      // The arrow form is a different node type AND different semantics. Detect it
      // from the arms rather than from the text, which could contain a `->` lambda.
      const isArrow = arms.some((a) => a.type === 'switch_rule');
      const cases = arms.map((a) => {
        const label = a.namedChildren.find((c) => c.type === 'switch_label');
        // `default` is a switch_label with no value children.
        const values = (label?.namedChildren ?? []).filter((c) => !isComment(c));
        const isDefault = !!label && values.length === 0;
        const body = a.namedChildren.filter((c) => c.id !== label?.id && !isComment(c));
        return syn(
          'case',
          head(a),
          stmts(body),
          span(a),
          // Explicit flag: the builder must never infer `default` from a missing value.
          isDefault
            ? { isDefault: true }
            : { caseValue: values.map((v) => v.text.trim()).join(', ') },
        );
      });
      return [
        syn('switch', conditionText(n.childForFieldName('condition')), cases, span(n), {
          ...(isArrow ? { noFallthrough: true } : {}),
        }),
      ];
    }

    case 'try_statement':
    case 'try_with_resources_statement': {
      const catches = n.children.filter((c) => c.type === 'catch_clause');
      const finallyClause = n.children.find((c) => c.type === 'finally_clause');
      const body = stmts(block(n.childForFieldName('body')));
      // A resource is real work that runs on try entry, so it leads the body rather
      // than being dropped: `try (var s = open())` is where the open() happens.
      const resources = n.childForFieldName('resources');
      const leading = resources
        ? resources.namedChildren
            .filter((r) => r.type === 'resource')
            .map((r) => syn('stmt', head(r), [], span(r)))
        : [];
      return [
        syn('try', 'try', [...leading, ...body], span(n), {
          // map, NOT flatMap — one array per handler keeps handler boundaries.
          ...(catches.length
            ? { catchBodies: catches.map((c) => stmts(block(c.childForFieldName('body')))) }
            : {}),
          ...(finallyClause
            ? {
                finallyBody: stmts(
                  block(finallyClause.namedChildren.find((c) => c.type === 'block') ?? null),
                ),
              }
            : {}),
        }),
      ];
    }

    /**
     * `label:` names the statement that follows it.
     *
     * When that statement is a LOOP the label goes onto the loop's own meta.label,
     * which is what lets the builder resolve `break outer` / `continue outer` to
     * the labelled loop instead of the innermost one (spec §5.3). Emitting a
     * separate label node here would leave the loop unlabelled and the jump would
     * silently bind to the wrong loop.
     */
    case 'labeled_statement': {
      const label = n.namedChildren.find((c) => c.type === 'identifier')?.text.trim();
      const inner = n.namedChildren.find((c) => c.type !== 'identifier' && !isComment(c));
      if (!inner) return [];
      const mapped = toSynStmt(inner);
      if (label && LOOP_TYPES.has(inner.type)) {
        // Find the loop by KIND, not by position: a three-part `for` hoists its
        // init ahead of the header, so mapped is [init, loop] and assuming a single
        // element loses the label entirely — which makes `break outer` resolve to
        // no loop and vanish from the graph without any error.
        const idx = mapped.findIndex((m) => m.kind === 'loop');
        if (idx >= 0) {
          const copy = [...mapped];
          copy[idx] = { ...copy[idx], meta: { ...copy[idx].meta, label } };
          return copy;
        }
      }
      // A labelled BLOCK is not a loop; `break blk` cannot resolve to a loop
      // context, so the builder degrades that jump rather than inventing a target.
      return [syn('label', head(n), mapped, span(n), label ? { label } : undefined)];
    }

    case 'return_statement':
      return [syn('return', head(n), [], span(n))];
    case 'throw_statement':
      return [syn('throw', head(n), [], span(n))];
    case 'break_statement':
      return [syn('break', head(n).replace(/;$/, ''), [], span(n), { label: jumpLabel(n) })];
    case 'continue_statement':
      return [syn('continue', head(n).replace(/;$/, ''), [], span(n), { label: jumpLabel(n) })];

    // Java has no goto: it is a reserved word with no statement form.

    default:
      if (!n.isNamed || isComment(n)) return [];
      return [syn('stmt', head(n), [], span(n))];
  }
}

/** A parameter's TYPE, which is what keeps overload ids distinct. */
function paramType(p: TSNode): string {
  const type = p.childForFieldName('type');
  if (!type) return p.text.trim();
  // `X... rest` is a spread_parameter, and its type node omits the ellipsis.
  return p.type === 'spread_parameter' ? `${type.text.trim()}...` : type.text.trim();
}

function paramNodes(decl: TSNode): TSNode[] {
  const list = decl.childForFieldName('parameters');
  if (!list) return [];
  return list.namedChildren.filter(
    (c) => c.type === 'formal_parameter' || c.type === 'spread_parameter',
  );
}

/** Type declarations that qualify the methods inside them. */
const TYPE_DECLS: Record<string, true> = {
  class_declaration: true,
  interface_declaration: true,
  enum_declaration: true,
  record_declaration: true,
  annotation_type_declaration: true,
};

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  const diagnostics = diagnosticsFor(root);
  const funcs: SynFunction[] = [];

  const visit = (n: TSNode, enclosingType?: string) => {
    if (n.type === 'method_declaration' || n.type === 'constructor_declaration') {
      const body = n.childForFieldName('body');
      // An abstract or interface method has no body, so there is nothing to draw.
      if (!body) return;

      const name = n.childForFieldName('name')?.text.trim() ?? '<anonymous>';
      const ps = paramNodes(n);
      // Types in the id, full text in the display params.
      const base = `${name}(${ps.map(paramType).join(',')})`;
      funcs.push({
        // Qualify by the enclosing type, so two classes each defining `f` do not
        // collide into one FunctionGraph id.
        id: enclosingType ? `${enclosingType}.${base}` : base,
        name,
        params: ps.map((p) => p.text.trim()),
        node: syn('func', name, stmts(block(body)), span(n)),
      });
      // P1 does not descend into nested declarations (a local or anonymous class
      // body is DROPPED). Acceptable for DSA code, where nesting is rare.
      return;
    }

    const nextType = TYPE_DECLS[n.type]
      ? (n.childForFieldName('name')?.text.trim() ?? enclosingType)
      : enclosingType;
    for (const c of n.namedChildren) visit(c, nextType);
  };
  visit(root);

  return { funcs, diagnostics };
}
