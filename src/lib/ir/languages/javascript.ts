import type { Diagnostic } from '../types';
import type { SynFunction, SynNode } from '../builder';
import { diagnosticsFor, head, span, syn, type TSNode } from './tsnode';

/**
 * Statement children of a body.
 *
 * A non-block body is legal (`if (x) return 1;`) and arrives as a bare
 * statement. Comments are named nodes in this grammar, so they are dropped
 * rather than drawn.
 */
function block(n: TSNode | null): TSNode[] {
  if (!n) return [];
  const list = n.type === 'statement_block' ? n.namedChildren : [n];
  return list.filter((c) => !isComment(c));
}

function isComment(n: TSNode): boolean {
  return n.type === 'comment';
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

/** The label a labeled break/continue names, or undefined when unlabeled. */
function jumpLabel(n: TSNode): string | undefined {
  return n.childForFieldName('label')?.text.trim();
}

/** An `else_clause` wrapper around the real alternative (or the alternative). */
function elseBody(alt: TSNode | null): SynNode[] {
  if (!alt) return [];
  const inner =
    alt.type === 'else_clause'
      ? (alt.namedChildren.find((c) => !isComment(c)) ?? null)
      : alt;
  // `else if` arrives as an if_statement here, so recursing folds the chain
  // into nested else arms with no special-casing.
  return stmts(block(inner));
}

const LOOP_TYPES = new Set([
  'while_statement',
  'do_statement',
  'for_statement',
  'for_in_statement',
]);

/** `let`/`const` declarators and `var` declarators alike. */
function declarators(n: TSNode): TSNode[] {
  if (n.type !== 'lexical_declaration' && n.type !== 'variable_declaration') return [];
  return n.namedChildren.filter((c) => c.type === 'variable_declarator' && !isComment(c));
}

function toSynStmt(n: TSNode): SynNode[] {
  switch (n.type) {
    // A bare `{ … }` group is transparent: it is a scope, not control flow.
    case 'statement_block':
      return stmts(block(n));

    case 'if_statement': {
      const thenBody = stmts(block(n.childForFieldName('consequence')));
      const elseStmts = elseBody(n.childForFieldName('alternative'));
      // children = then arm ONLY; the else arm travels in meta.elseBody.
      return [
        syn(
          'if',
          conditionText(n.childForFieldName('condition')),
          thenBody,
          span(n),
          elseStmts.length ? { elseBody: elseStmts } : undefined,
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
     * `continue` still runs the update in real JS, and the builder sends
     * `continue` to the header, so a trailing update node would be skipped and the
     * diagram would claim the increment never happened.
     */
    case 'for_statement': {
      const init = n.childForFieldName('initializer');
      const update = n.childForFieldName('increment');
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

    /**
     * `for...of` and `for...in` share one node type; both are foreach loops.
     * Same 'x in xs' header shape the other adapters produce.
     */
    case 'for_in_statement': {
      const left = n.childForFieldName('left');
      const right = n.childForFieldName('right');
      const name = (left?.text.trim() ?? '_').replace(/^(?:const|let|var)\s+/, '');
      return [
        syn(
          'loop',
          `${name} in ${right?.text.trim() ?? '_'}`,
          stmts(block(n.childForFieldName('body'))),
          span(n),
          { loopKind: 'foreach' },
        ),
      ];
    }

    /**
     * Classic fallthrough arms (the C++ path, NOT `noFallthrough` — spec §5).
     * Arms carry their statements as direct `body:` children with no arm block.
     */
    case 'switch_statement': {
      const body = n.childForFieldName('body');
      const arms = (body?.namedChildren ?? []).filter(
        (c) => c.type === 'switch_case' || c.type === 'switch_default',
      );
      const cases = arms.map((a) => {
        // Values are expressions (number, identifier, ...); statements follow.
        // `break` is a statement and belongs to the arm body, like java.ts.
        const kids = (a.namedChildren ?? []).filter((c) => !isComment(c));
        const caseValues = kids.filter((c) => !isStatement(c));
        const bodyStmts = kids.filter(isStatement);
        const isDefault = a.type === 'switch_default';
        return syn(
          'case',
          head(a),
          stmts(bodyStmts),
          span(a),
          isDefault
            ? { isDefault: true }
            : caseValues.length
              ? { caseValue: caseValues.map((v) => v.text.trim()).join(', ') }
              : undefined,
        );
      });
      return [syn('switch', conditionText(n.childForFieldName('value')), cases, span(n))];
    }

    case 'try_statement': {
      const catches = n.namedChildren.filter((c) => c.type === 'catch_clause');
      const finalizer = n.childForFieldName('finalizer');
      const body = stmts(block(n.childForFieldName('body')));
      return [
        syn('try', 'try', body, span(n), {
          // map, NOT flatMap — one array per handler keeps handler boundaries.
          ...(catches.length
            ? { catchBodies: catches.map((c) => stmts(block(c.childForFieldName('body')))) }
            : {}),
          ...(finalizer ? { finallyBody: stmts(block(finalizer.namedChildren.find((c) => c.type === 'statement_block') ?? null)) } : {}),
        }),
      ];
    }

    /**
     * `label:` names the statement that follows it.
     *
     * When that statement is a LOOP the label goes onto the loop's own meta.label,
     * which is what lets the builder resolve `break outer` / `continue outer` to
     * the labelled loop instead of the innermost one. Emitting a separate label
     * node here would leave the loop unlabelled and the jump would silently bind
     * to the wrong loop.
     */
    case 'labeled_statement': {
      const label = n.childForFieldName('label')?.text.trim();
      const inner = n.namedChildren.find((c) => c.type !== 'statement_identifier' && !isComment(c));
      if (!inner) return [];
      const mapped = toSynStmt(inner);
      if (label && LOOP_TYPES.has(inner.type)) {
        // Find the loop by KIND, not by position: a three-part `for` hoists its
        // init ahead of the header, so mapped is [init, loop] and assuming a single
        // element loses the label entirely.
        const idx = mapped.findIndex((m) => m.kind === 'loop');
        if (idx >= 0) {
          const copy = [...mapped];
          copy[idx] = { ...copy[idx], meta: { ...copy[idx].meta, label } };
          return copy;
        }
      }
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

    // JS has no goto.

    default:
      if (!n.isNamed || isComment(n)) return [];
      // await/yield/eval/with/imports all land here as ordinary statements:
      // present in the block, never an edge, never a marker (spec §5).
      return [syn('stmt', head(n), [], span(n))];
  }
}

/**
 * True for nodes that can appear as statements inside a switch arm or block
 * (as opposed to the arm's `value:` case expressions).
 */
function isStatement(n: TSNode): boolean {
  return (
    n.type.endsWith('_statement') ||
    n.type.endsWith('_declaration') ||
    n.type === 'statement_block' ||
    n.type === 'labeled_statement'
  );
}

/** `get x()` / `set x(v)` ride in the same `method_definition` as methods. */
function isGetterOrSetter(n: TSNode): boolean {
  const first = n.children[0];
  return !!first && !first.isNamed && (first.text === 'get' || first.text === 'set');
}

function paramNodes(decl: TSNode): TSNode[] {
  const list = decl.childForFieldName('parameters');
  if (!list || list.type !== 'formal_parameters') return [];
  return list.namedChildren.filter((c) => !isComment(c));
}

/** First line only — ids stay single-line even when params wrap. */
function oneLine(t: string): string {
  return t.split('\n')[0].trim();
}

/** Signature-derived id: `binarySearch(arr,target)`, `Search.find(arr,target)`. */
function funcId(name: string, params: string[]): string {
  return `${name}(${params.map(oneLine).join(',')})`;
}

const FUNC_DECLS: Record<string, true> = {
  function_declaration: true,
  generator_function_declaration: true,
};

function pushFunc(
  funcs: SynFunction[],
  opts: { id: string; name: string; params: string[]; body: TSNode | null; spanOf: TSNode },
): void {
  funcs.push({
    id: opts.id,
    name: opts.name,
    params: opts.params,
    node: syn('func', opts.name, stmts(block(opts.body)), span(opts.spanOf)),
  });
}

function funcFromDeclarator(
  funcs: SynFunction[],
  d: TSNode,
  qualifier: string | undefined,
): void {
  const value = d.childForFieldName('value');
  if (!value) return;
  if (value.type !== 'arrow_function' && value.type !== 'function_expression') return;
  // Only block-bodied functions become graphs; expression-bodied arrows
  // (`const dbl = (n) => n * 2`) fold into the enclosing block as statements.
  const body = value.childForFieldName('body');
  if (!body || body.type !== 'statement_block') return;
  const rawName = d.childForFieldName('name')?.text.trim() ?? '<anonymous>';
  const name = qualifier ? `${qualifier}.${rawName}` : rawName;
  const ps = paramNodes(value);
  const params = ps.map((p) => p.text.trim());
  pushFunc(funcs, {
    id: funcId(name, params),
    name,
    params,
    body,
    spanOf: d,
  });
}

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  const diagnostics = diagnosticsFor(root);
  const funcs: SynFunction[] = [];

  const visitMembers = (members: TSNode[], className: string) => {
    for (const m of members) {
      if (m.type !== 'method_definition' || isComment(m) || isGetterOrSetter(m)) continue;
      const body = m.childForFieldName('body');
      if (!body || body.type !== 'statement_block') continue;
      const rawName = m.childForFieldName('name')?.text.trim() ?? '<anonymous>';
      const name = rawName;
      const ps = paramNodes(m);
      const params = ps.map((p) => p.text.trim());
      pushFunc(funcs, {
        // Qualify the id by the enclosing class, so two classes each defining
        // `search` do not collide — while `name` stays the plain method name.
        id: funcId(`${className}.${rawName}`, params),
        name,
        params,
        body,
        spanOf: m,
      });
    }
  };

  const visitTop = (n: TSNode) => {
    if (FUNC_DECLS[n.type]) {
      const body = n.childForFieldName('body');
      if (!body) return;
      const name = n.childForFieldName('name')?.text.trim() ?? '<anonymous>';
      const ps = paramNodes(n);
      const params = ps.map((p) => p.text.trim());
      pushFunc(funcs, { id: funcId(name, params), name, params, body, spanOf: n });
      // P1 does not descend into nested declarations. Acceptable for DSA code.
      return;
    }
    if (n.type === 'class_declaration') {
      const className = n.childForFieldName('name')?.text.trim() ?? '<anonymous>';
      const body = n.childForFieldName('body');
      if (body) visitMembers(body.namedChildren, className);
      return;
    }
    if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
      for (const d of declarators(n)) funcFromDeclarator(funcs, d, undefined);
      return;
    }
    if (n.type === 'export_statement') {
      const decl = n.childForFieldName('declaration');
      if (decl) visitTop(decl);
      return;
    }
  };

  for (const c of root.namedChildren) visitTop(c);

  return { funcs, diagnostics };
}
