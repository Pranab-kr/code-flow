/**
 * JavaScript tree-sitter -> SynNode adapter.
 *
 * The ONLY place JS grammar node types appear. Every mapping was read off the
 * real tree-sitter-javascript 0.25.0 grammar with a scratch dump (P2 Task 2);
 * the ones that differ from a reasonable guess are worth knowing:
 *
 *   - `for...of` and `for...in` are both `for_in_statement` (`left:`/`right:`);
 *     no disambiguation is needed because both map to loopKind 'foreach'.
 *   - an `else` arrives wrapped in `else_clause`, NOT as a bare statement —
 *     unlike Java's direct `alternative`. Unwrap one level, then `else if`
 *     recurses like the Java chain.
 *   - getters/setters are plain `method_definition`, identical to methods in
 *     the named tree. The `get`/`set` keyword is the first ANONYMOUS child, so
 *     the skip check reads `children[0]` — but `static`/`async` ride the same
 *     position and must NOT be skipped.
 *   - `export function f` nests inside `export_statement` (`declaration:`);
 *     the top-level walk unwraps it. Bare `import` lines are ordinary stmts.
 *   - `let`/`const` are `lexical_declaration`, `var` is `variable_declaration`;
 *     both hold `variable_declarator` (`name:`/`value:`).
 *   - arrow functions with an expression body arrive with a non-block `body`;
 *     only BLOCK-bodied arrows assigned to a variable become FunctionGraphs —
 *     expression-bodied arrows and inline callbacks fold into the enclosing
 *     block as statements (spec §6).
 *   - class methods are `method_definition` inside `class_body`; the class name
 *     qualifies the id (`Search.binarySearch(arr,target)`), so two classes may
 *     share a method name (spec §6).
 *   - `switch` arms are `switch_case` / `switch_default` with direct `body:`
 *     statement children (no arm block) and fall through like C++ (the classic
 *     path, NOT `noFallthrough` — spec §5).
 *   - labeled jumps carry the label in a `label:` field holding a
 *     `statement_identifier` (likewise `labeled_statement`'s label) — NOT a
 *     plain `identifier` as in C++.
 *   - object-literal methods (`{ m() {} }`, `pair` arrow props) parse fine but
 *     are NOT graphed (spec §5 + §10 known gap).
 *
 * Boundary review 2026-09-04 (spec §4): NO builder change needed. The builder
 * already handles try/catch/finally bodies, all four loop kinds, classic
 * fallthrough switches, and labeled break/continue (the Java path). `await` /
 * `yield` are ordinary statements; `async` adds no edge. If a construct below
 * ever needs a new IR kind, stop and propose a boundary extension — do not
 * quietly extend the builder.
 *
 * Construct map (spec §5, normative):
 *   function_declaration / generator_function_declaration / assigned arrow /
 *     assigned function_expression -> func
 *   class method_definition (incl. static/async) -> func, id Class.method(params)
 *   if_statement / else-if chain -> if (+ meta.elseBody); ternary -> inline stmt
 *   switch_statement + break -> switch/case (classic fallthrough)
 *   while_statement -> loop 'while'; do_statement -> loop 'do-while'
 *   for_statement -> loop 'for'; for_in_statement (of + in) -> loop 'foreach'
 *   break/continue (+ labeled_statement targets) -> break/continue (+ label)
 *   try_statement -> try (catchBodies per handler, finallyBody)
 *   return_statement -> return; throw_statement -> throw
 *   await_expression / yield_expression -> stmt (no edge, no marker)
 *   eval / with -> stmt (P1 executes nothing; nothing to sandbox)
 */

import type { Diagnostic } from '../types';
import type { SynFunction } from '../builder';
import { diagnosticsFor, type TSNode } from './tsnode';

export function toSyn(root: TSNode): { funcs: SynFunction[]; diagnostics: Diagnostic[] } {
  return { funcs: [], diagnostics: diagnosticsFor(root) };
}
