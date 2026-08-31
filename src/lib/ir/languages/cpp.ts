/**
 * C++ tree-sitter -> SynNode adapter.
 *
 * The ONLY place C++ grammar node types appear. Every mapping below was read off
 * the real 0.23.4 grammar with a scratch dump, not inferred — several differ from
 * what a reasonable guess would produce:
 *
 *   - `if`/`while`/`switch` wrap their test in a `condition_clause`, so the raw
 *     node text is "(x)" and the useful expression is its `value` field.
 *   - `do_statement` instead wraps its test in a `parenthesized_expression`.
 *   - an else-if chain NESTS inside `else_clause`, unlike Python's flat clause list.
 *   - a method's name is a `field_identifier`, and an out-of-line definition's is a
 *     `qualified_identifier`, so neither is a plain `identifier`.
 */

import type { Diagnostic } from '../types';
import type { SynFunction, SynNode } from '../builder';
import { diagnosticsFor, head, span, syn, type TSNode } from './tsnode';

/**
 * Statement children of a body.
 *
 * A non-block body is legal (`for (…) s += i;`) and arrives as a bare statement.
 * Comments are dropped: they are named nodes in this grammar, so keeping them
 * would put a comment in the diagram as its own statement.
 */
function block(n: TSNode | null): TSNode[] {
  if (!n) return [];
  const list = n.type === 'compound_statement' ? n.namedChildren : [n];
  return list.filter((c) => c.type !== 'comment');
}

function stmts(list: TSNode[]): SynNode[] {
  return list.flatMap(toSynStmt);
}

/**
 * The test inside a condition wrapper, without its parentheses.
 *
 * `condition_clause` exposes a `value` field; `parenthesized_expression` does not,
 * so its first named child is taken instead. Falling back to stripped text keeps a
 * C++17 if-init (`if (auto v = f(); v)`) readable rather than blank.
 */
function conditionText(n: TSNode | null): string {
  if (!n) return 'true';
  if (n.type === 'condition_clause') {
    const value = n.childForFieldName('value');
    if (value) return head(value);
  }
  if (n.type === 'parenthesized_expression') {
    const inner = n.namedChildren[0];
    if (inner) return head(inner);
  }
  return head(n).replace(/^\(/, '').replace(/\)$/, '').trim();
}

/** The statement an `else_clause` guards, or the bare statement of an `else if`. */
function elseContent(alt: TSNode): TSNode | null {
  return alt.type === 'else_clause' ? (alt.namedChildren[0] ?? null) : alt;
}

function toSynStmt(n: TSNode): SynNode[] {
  switch (n.type) {
    // A bare `{ … }` group is transparent: it introduces a scope, not control flow.
    // Emitting it as a statement would put a node labelled "{" in the diagram.
    case 'compound_statement':
      return stmts(block(n));

    case 'if_statement': {
      const thenBody = stmts(block(n.childForFieldName('consequence')));
      const alt = n.childForFieldName('alternative');
      // An else-if arrives as an if_statement INSIDE the else_clause, so recursing
      // here folds the chain into nested else arms with no special-casing.
      const elseBody = alt ? stmts(block(elseContent(alt))) : [];
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
     * The initializer becomes its own statement BEFORE the loop, because that is
     * exactly when it runs — once, on entry. The update instead rides along in the
     * header's statements rather than being appended to the body: a `continue`
     * still runs the update in real C++, and the builder sends `continue` to the
     * header, so a trailing update node would be skipped and the graph would lie.
     */
    case 'for_statement': {
      const init = n.childForFieldName('initializer');
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

    case 'for_range_loop': {
      const decl = n.childForFieldName('declarator');
      const right = n.childForFieldName('right');
      // Same 'x in xs' shape Python's foreach produces, so the two render alike.
      return [
        syn(
          'loop',
          `${decl?.text.trim() ?? '_'} in ${right?.text.trim() ?? '_'}`,
          stmts(block(n.childForFieldName('body'))),
          span(n),
          { loopKind: 'foreach' },
        ),
      ];
    }

    case 'switch_statement': {
      const body = n.childForFieldName('body');
      const cases = (body?.namedChildren ?? [])
        .filter((c) => c.type === 'case_statement')
        .map((c) => {
          const value = c.childForFieldName('value');
          // Case bodies are NOT wrapped in a block: the statements sit directly on
          // case_statement alongside the value. Excluded by tree-sitter's stable
          // node `id` rather than by slice(1), which would silently eat the first
          // statement if the grammar ever ordered the value differently — and NOT
          // by `!==`, since every accessor call returns a fresh wrapper object.
          const body = c.namedChildren.filter(
            (x) => x.id !== value?.id && x.type !== 'comment',
          );
          return syn(
            'case',
            head(c),
            stmts(body),
            span(c),
            // Explicit flag: a missing value is what `default:` looks like, but the
            // builder must never have to infer that.
            value ? { caseValue: head(value) } : { isDefault: true },
          );
        });
      return [syn('switch', conditionText(n.childForFieldName('condition')), cases, span(n))];
    }

    case 'try_statement': {
      const catches = n.children.filter((c) => c.type === 'catch_clause');
      return [
        syn('try', 'try', stmts(block(n.childForFieldName('body'))), span(n), {
          // map, NOT flatMap — one array per handler keeps handler boundaries.
          ...(catches.length
            ? { catchBodies: catches.map((c) => stmts(block(c.childForFieldName('body')))) }
            : {}),
        }),
      ];
      // C++ has no `finally`; only Java sets meta.finallyBody.
    }

    /**
     * `label:` names whatever statement follows it, so it is NOT a node of its own.
     * The label travels in meta and the labelled statements travel as children —
     * that is what lets a goto resolve to the node the label actually leads.
     */
    case 'labeled_statement': {
      const label = n.childForFieldName('label')?.text.trim();
      const body = n.namedChildren.slice(1).filter((c) => c.type !== 'comment');
      return [syn('label', head(n), stmts(body), span(n), label ? { label } : undefined)];
    }

    case 'goto_statement':
      return [
        syn('goto', head(n), [], span(n), {
          label: n.childForFieldName('label')?.text.trim(),
        }),
      ];

    case 'return_statement':
      return [syn('return', head(n), [], span(n))];
    case 'throw_statement':
      return [syn('throw', head(n), [], span(n))];
    case 'break_statement':
      return [syn('break', 'break', [], span(n))];
    case 'continue_statement':
      return [syn('continue', 'continue', [], span(n))];

    default:
      if (!n.isNamed || n.type === 'comment') return [];
      return [syn('stmt', head(n), [], span(n))];
  }
}

/** Descend the `declarator` chain to the function_declarator, past any `*`/`&`. */
function functionDeclaratorOf(n: TSNode | null): TSNode | null {
  let cur = n;
  while (cur) {
    if (cur.type === 'function_declarator') return cur;
    cur = cur.childForFieldName('declarator');
  }
  return null;
}

/** A declarator's bare name plus any `Class::` / `Ns::Class::` qualification. */
function declaratorName(d: TSNode | null): { name: string; scope?: string } {
  if (!d) return { name: '<anonymous>' };
  if (d.type === 'qualified_identifier') {
    const scope = d.childForFieldName('scope')?.text.trim();
    const inner = declaratorName(d.childForFieldName('name'));
    const joined = [scope, inner.scope].filter(Boolean).join('.');
    return { name: inner.name, scope: joined || undefined };
  }
  return { name: d.text.trim() };
}

/**
 * A parameter's TYPE, which is what makes an overload's id distinct.
 *
 * `add(int,int)` and `add(double,double)` must not collide, so the id is built
 * from types while the display list keeps the full `int a` text.
 */
function paramType(p: TSNode): string {
  if (p.type === 'variadic_parameter_declaration' || p.text.trim() === '...') return '...';
  const type = p.childForFieldName('type');
  if (!type) return p.text.trim();
  const quals = p.children.filter((c) => c.type === 'type_qualifier').map((c) => c.text.trim());
  let sigil = '';
  let d = p.childForFieldName('declarator');
  while (d) {
    if (d.type === 'pointer_declarator') sigil += '*';
    else if (d.type === 'reference_declarator') sigil += '&';
    else if (d.type === 'array_declarator') sigil += '[]';
    d = d.childForFieldName('declarator');
  }
  return [...quals, type.text.trim()].join(' ') + sigil;
}

function paramNodes(fnDecl: TSNode): TSNode[] {
  const list = fnDecl.childForFieldName('parameters');
  if (!list) return [];
  return list.namedChildren.filter(
    (c) => c.type === 'parameter_declaration' || c.type === 'variadic_parameter_declaration',
  );
}

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  const diagnostics = diagnosticsFor(root);
  const funcs: SynFunction[] = [];

  const visit = (n: TSNode, enclosingClass?: string) => {
    if (n.type === 'function_definition') {
      const body = n.childForFieldName('body');
      const fnDecl = functionDeclaratorOf(n.childForFieldName('declarator'));
      // No body means nothing to draw. A prototype is a `declaration` anyway, but
      // a definition without a recoverable declarator is also not usable.
      if (!body || !fnDecl) return;

      const { name, scope } = declaratorName(fnDecl.childForFieldName('declarator'));
      const ps = paramNodes(fnDecl);
      // Types in the id, full text in the display params.
      const base = `${name}(${ps.map(paramType).join(',')})`;
      // An explicit `Class::` qualifier wins over the lexical class, so an
      // out-of-line definition and its in-class declaration agree.
      const qualifier = scope ?? enclosingClass;
      funcs.push({
        id: qualifier ? `${qualifier}.${base}` : base,
        name,
        params: ps.map((p) => p.text.trim()),
        node: syn('func', name, stmts(block(body)), span(n)),
      });
      // P1 does not descend into nested definitions (a lambda body is DROPPED).
      // Acceptable for DSA code, where nesting is rare.
      return;
    }

    const nextClass =
      n.type === 'class_specifier' || n.type === 'struct_specifier'
        ? (n.childForFieldName('name')?.text.trim() ?? enclosingClass)
        : enclosingClass;
    for (const c of n.namedChildren) visit(c, nextClass);
  };
  visit(root);

  return { funcs, diagnostics };
}
