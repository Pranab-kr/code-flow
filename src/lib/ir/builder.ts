/**
 * Language-agnostic CFG assembly.
 *
 * The builder never sees tree-sitter types. Each language adapter normalizes its
 * parse tree into `SynNode`, and this file turns that into a `FunctionGraph`.
 * That boundary is what lets a new language be added by writing one adapter
 * without touching the graph logic — and it is why this file is unit-testable
 * against hand-written trees, with no WASM in the loop.
 */

import { IdBuilder, makeNodeId } from './ids';
import {
  IR_VERSION,
  type CallEdge,
  type Diagnostic,
  type FunctionGraph,
  type IREdge,
  type IRNode,
  type Language,
  type LoopKind,
  type ProgramIR,
  type Span,
} from './types';

export type SynKind =
  | 'func'
  | 'stmt'
  | 'if'
  | 'loop'
  | 'switch'
  | 'case'
  | 'return'
  | 'throw'
  | 'break'
  | 'continue'
  | 'try'
  | 'goto'
  | 'label'
  | 'call';

export interface SynNode {
  kind: SynKind;
  text: string;
  /** For `if`, this is the THEN arm only — the else arm lives in meta.elseBody. */
  children: SynNode[];
  span: Span;
  meta?: {
    loopKind?: LoopKind;
    /** Loop label, or the target named by a labeled break/continue. */
    label?: string;
    caseValue?: string;
    /** Explicit flag. Never infer a default arm from a missing caseValue. */
    isDefault?: boolean;
    /** `if`: the else arm. `loop`: python's for/while else. */
    elseBody?: SynNode[];
    finallyBody?: SynNode[];
    /** One array PER handler; flattening would lose handler boundaries. */
    catchBodies?: SynNode[][];
    unsupported?: string;
  };
}

export interface SynFunction {
  node: SynNode;
  id: string;
  name: string;
  params: string[];
}

/** An edge whose target is unknown until the successor node is emitted. */
interface Pending {
  from: string;
  kind: IREdge['kind'];
  label?: string;
}

interface LoopCtx {
  /** 'switch' collects `break` but must never capture `continue`. */
  ctxKind: 'loop' | 'switch';
  headerId: string;
  label?: string;
  /** Edges waiting for whatever follows this construct. */
  breaks: Pending[];
  continueTarget: string;
}

class GraphBuilder {
  nodes: IRNode[] = [];
  edges: IREdge[] = [];
  exitIds: string[] = [];

  private ids: IdBuilder;
  private edgeSeq = 0;
  private loops: LoopCtx[] = [];
  /** Enclosing try blocks that have a finally, innermost last. */
  private finallies: { entryId: string }[] = [];

  constructor(private readonly functionId: string) {
    this.ids = new IdBuilder(functionId);
  }

  addNode(node: IRNode): IRNode {
    this.nodes.push(node);
    return node;
  }

  private connect(from: Pending[], to: string): void {
    for (const p of from) {
      this.edges.push({
        id: `e${this.edgeSeq++}`,
        source: p.from,
        target: to,
        kind: p.kind,
        ...(p.label ? { label: p.label } : {}),
      });
    }
  }

  private edge(source: string, target: string, kind: IREdge['kind'], label?: string): void {
    this.edges.push({
      id: `e${this.edgeSeq++}`,
      source,
      target,
      kind,
      ...(label ? { label } : {}),
    });
  }

  /**
   * Walk a statement list, folding runs of plain statements into basic blocks and
   * delegating control structures.
   *
   * Statements after a return/break/continue are UNREACHABLE. They are still
   * emitted, tagged, and left with no incoming edge, so the canvas can render them
   * dimmed — a learner should see their dead code, not watch a line they can see in
   * the editor vanish from the diagram (spec §11, "degrade, never blank").
   */
  walk(list: SynNode[], incoming: Pending[]): Pending[] {
    let pending = incoming;
    let run: SynNode[] = [];
    let unreachable = false;

    const flush = () => {
      if (run.length === 0) return;
      const node = this.addNode({
        id: this.ids.block(),
        kind: 'basic',
        label: run[0].text,
        statements: run.map((s) => s.text),
        span: {
          startLine: run[0].span.startLine,
          endLine: run[run.length - 1].span.endLine,
        },
      });
      this.connect(pending, node.id);
      run = [];
      if (unreachable) {
        node.meta = { ...node.meta, unsupported: 'unreachable' };
        // Dead code has no successor in the reachable flow either.
        pending = [];
      } else {
        pending = [{ from: node.id, kind: 'seq' }];
      }
    };

    for (const stmt of list) {
      if (stmt.kind === 'stmt' || stmt.kind === 'call' || stmt.kind === 'label') {
        run.push(stmt);
        continue;
      }
      flush();
      pending = this.control(stmt, pending);
      // return / throw / break / continue all yield [] — nothing after is reachable.
      if (pending.length === 0) unreachable = true;
    }
    flush();
    return pending;
  }

  private control(stmt: SynNode, incoming: Pending[]): Pending[] {
    switch (stmt.kind) {
      case 'if':
        return this.ifStmt(stmt, incoming);
      case 'loop':
        return this.loopStmt(stmt, incoming);
      case 'switch':
        return this.switchStmt(stmt, incoming);
      case 'try':
        return this.tryStmt(stmt, incoming);
      case 'return':
        return this.returnStmt(stmt, incoming);
      case 'throw':
        return this.throwStmt(stmt, incoming);
      case 'break':
        return this.breakStmt(stmt, incoming);
      case 'continue':
        return this.continueStmt(stmt, incoming);
      default:
        return this.walk([{ ...stmt, kind: 'stmt' }], incoming);
    }
  }

  private ifStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    this.ids.enter('if');
    const branch = this.addNode({
      id: this.ids.block('cond'),
      kind: 'branch',
      label: stmt.text,
      statements: [stmt.text],
      span: stmt.span,
    });
    this.connect(incoming, branch.id);

    // children = then arm; the else arm arrives separately. Never slice them apart:
    // a multi-statement else would leak into the then arm.
    const elseBody = stmt.meta?.elseBody ?? [];

    // Each arm is its own id scope, so editing one arm cannot renumber the other
    // and discard the user's saved positions for nodes they never touched.
    this.ids.enterRole('then');
    const thenOut = this.walk(stmt.children, [
      { from: branch.id, kind: 'true', label: 'true' },
    ]);
    this.ids.exit();

    let elseOut: Pending[];
    if (elseBody.length) {
      this.ids.enterRole('else');
      elseOut = this.walk(elseBody, [{ from: branch.id, kind: 'false', label: 'false' }]);
      this.ids.exit();
    } else {
      elseOut = [{ from: branch.id, kind: 'false', label: 'false' }];
    }

    this.ids.exit();
    return [...thenOut, ...elseOut];
  }

  private loopStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const kind: LoopKind = stmt.meta?.loopKind ?? 'while';
    // Segment carries the loop KIND, so paths read `while@0` / `for@0` as spec §6
    // shows, rather than a generic `loop@0`.
    this.ids.enter(kind === 'do-while' ? 'do' : kind);

    const header = this.addNode({
      id: this.ids.block('cond'),
      kind: 'loop-header',
      label: stmt.text,
      statements: [stmt.text],
      span: stmt.span,
      meta: { loopKind: kind },
    });

    const ctx: LoopCtx = {
      ctxKind: 'loop',
      headerId: header.id,
      label: stmt.meta?.label,
      breaks: [],
      continueTarget: header.id,
    };
    this.loops.push(ctx);

    if (kind === 'do-while') {
      // Body runs first, header is tested after. Record where the body starts
      // BEFORE walking: searching this.nodes for "not the header" would return the
      // function entry and emit a bogus header -> entry edge.
      const bodyStart = this.nodes.length;
      const bodyOut = this.walk(stmt.children, incoming);
      this.connect(bodyOut, header.id);
      const firstBody = this.nodes[bodyStart];
      // An empty body degrades to a self-loop rather than a dangling edge.
      this.edge(header.id, firstBody ? firstBody.id : header.id, 'back', kind);
    } else {
      this.connect(incoming, header.id);
      const bodyOut = this.walk(stmt.children, [
        { from: header.id, kind: 'true', label: 'true' },
      ]);
      // The body returning to the header IS the back edge.
      for (const p of bodyOut) {
        this.edge(p.from, header.id, 'back', p.label ? `${p.label} → ${kind}` : kind);
      }
    }

    this.loops.pop();

    // Loop exhaustion. Python's for/while `else` runs here — and a `break` must
    // skip it, which is why breaks are returned separately below.
    let exhausted: Pending[] = [{ from: header.id, kind: 'false', label: 'false' }];
    if (stmt.meta?.elseBody?.length) {
      this.ids.enterRole('loop-else');
      exhausted = this.walk(stmt.meta.elseBody, exhausted);
      this.ids.exit();
    }

    this.ids.exit();
    return [...exhausted, ...ctx.breaks];
  }

  private switchStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    this.ids.enter('switch');
    const sw = this.addNode({
      id: this.ids.block('disc'),
      kind: 'switch',
      label: stmt.text,
      statements: [stmt.text],
      span: stmt.span,
    });
    this.connect(incoming, sw.id);

    // ctxKind 'switch': collects `break`, but `continue` passes through to the
    // enclosing loop. A switch is not a loop.
    const ctx: LoopCtx = {
      ctxKind: 'switch',
      headerId: sw.id,
      breaks: [],
      continueTarget: sw.id,
    };
    this.loops.push(ctx);

    const cases = stmt.children.filter((c) => c.kind === 'case');
    const hasDefault = cases.some((c) => c.meta?.isDefault === true);
    /** Exits of the previous case body, for implicit fallthrough. */
    let fallthrough: Pending[] = [];

    cases.forEach((c, i) => {
      const isDefault = c.meta?.isDefault === true;
      const entry: Pending[] = [
        {
          from: sw.id,
          kind: isDefault ? 'default' : 'case',
          label: isDefault ? 'default' : `case ${c.meta?.caseValue ?? ''}`.trim(),
        },
        ...fallthrough, // spec §5.1 — implicit fallthrough
      ];
      this.ids.enterRole(`case-${isDefault ? 'default' : (c.meta?.caseValue ?? i)}`);
      const bodyOut = this.walk(c.children, entry);
      this.ids.exit();
      fallthrough = c.children.some((x) => x.kind === 'break') ? [] : bodyOut;
    });

    // Only the final case's exits fall out; every earlier case either broke
    // (collected in ctx.breaks) or fell through into its successor.
    const out = fallthrough;

    this.loops.pop();
    this.ids.exit();

    // A bypass edge only when no default arm exists — otherwise the default arm
    // already covers "no match" and a second edge is a phantom.
    return hasDefault
      ? [...out, ...ctx.breaks]
      : [...out, ...ctx.breaks, { from: sw.id, kind: 'default', label: 'no match' }];
  }

  private tryStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    this.ids.enter('try');

    // RESERVE the finally id without consuming a block ordinal, and emit the node
    // after the body. Emitting it first would renumber every block in the try body,
    // so adding a finally clause would discard saved layout for untouched nodes.
    let finallyEntry: string | undefined;
    if (stmt.meta?.finallyBody?.length) {
      finallyEntry = makeNodeId(this.functionId, this.ids.path(), 'finally');
      this.finallies.push({ entryId: finallyEntry });
    }

    const tryStart = this.nodes.length;
    const bodyOut = this.walk(stmt.children, incoming);
    // DOCUMENTED SIMPLIFICATION: an exception is modelled as leaving the try region
    // from its ENTRY node. A precise model would add an edge from every statement
    // that can throw, which in these languages is nearly all of them, and renders
    // as a hairball. Recorded alongside spec §5.4.
    const tryEntry = this.nodes[tryStart]?.id;

    const catchOuts: Pending[] = [];
    if (tryEntry) {
      const handlers = stmt.meta?.catchBodies ?? [];
      handlers.forEach((handler, i) => {
        this.ids.enterRole(`catch-${i}`);
        catchOuts.push(
          ...this.walk(handler, [{ from: tryEntry, kind: 'exception', label: 'exception' }]),
        );
        this.ids.exit();
      });
    }

    if (finallyEntry) {
      const fb = stmt.meta!.finallyBody!;
      this.addNode({
        id: finallyEntry,
        kind: 'basic',
        label: fb[0].text,
        statements: fb.map((x) => x.text),
        span: fb[0].span,
      });
      this.finallies.pop();
      this.connect([...bodyOut, ...catchOuts], finallyEntry);
      this.ids.exit();
      return [{ from: finallyEntry, kind: 'seq' }];
    }

    this.ids.exit();
    return [...bodyOut, ...catchOuts];
  }

  private returnStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const node = this.addNode({
      id: this.ids.block('return'),
      kind: 'return',
      label: stmt.text,
      statements: [stmt.text],
      span: stmt.span,
    });
    this.connect(incoming, node.id);
    // A return inside a try must still run finally (spec §5.4).
    const fin = this.finallies[this.finallies.length - 1];
    if (fin) this.edge(node.id, fin.entryId, 'seq', 'finally');
    else this.exitIds.push(node.id);
    return [];
  }

  private throwStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const node = this.addNode({
      id: this.ids.block('throw'),
      kind: 'throw',
      label: stmt.text,
      statements: [stmt.text],
      span: stmt.span,
    });
    this.connect(incoming, node.id);
    this.exitIds.push(node.id);
    return [];
  }

  private breakStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const label = stmt.meta?.label;
    // A labeled break targets the LABELED loop, not the innermost one (spec §5.3).
    // Unlabeled `break` binds to the innermost loop OR switch.
    const target = label
      ? [...this.loops].reverse().find((l) => l.label === label)
      : this.loops[this.loops.length - 1];
    // Malformed source: degrade rather than throw.
    if (!target) return incoming;

    const node = this.addNode({
      id: this.ids.block('break'),
      kind: 'basic',
      label: stmt.text,
      statements: [stmt.text],
      span: stmt.span,
    });
    this.connect(incoming, node.id);
    target.breaks.push({
      from: node.id,
      kind: 'break',
      label: label ? `break ${label}` : 'break',
    });
    return [];
  }

  private continueStmt(stmt: SynNode, incoming: Pending[]): Pending[] {
    const label = stmt.meta?.label;
    // `continue` binds to the innermost enclosing LOOP, never to a switch between.
    const loopsOnly = [...this.loops].reverse().filter((l) => l.ctxKind === 'loop');
    const target = label ? loopsOnly.find((l) => l.label === label) : loopsOnly[0];
    if (!target) return incoming;

    const node = this.addNode({
      id: this.ids.block('continue'),
      kind: 'basic',
      label: stmt.text,
      statements: [stmt.text],
      span: stmt.span,
    });
    this.connect(incoming, node.id);
    this.edge(node.id, target.continueTarget, 'continue', 'continue');
    return [];
  }
}

export function buildFunctionGraph(
  fn: SynNode,
  functionId: string,
  name: string,
  params: string[],
): FunctionGraph {
  const b = new GraphBuilder(functionId);

  const entry = b.addNode({
    id: `${functionId}#entry`,
    kind: 'entry',
    label: `${name}(${params.join(', ')})`,
    statements: [],
    span: fn.span,
  });

  const out = b.walk(fn.children, [{ from: entry.id, kind: 'seq' }]);

  // Anything still pending falls off the end — that is an implicit exit.
  if (out.length > 0) {
    const exit = b.addNode({
      id: `${functionId}#exit`,
      kind: 'exit',
      label: 'end',
      statements: [],
      span: { startLine: fn.span.endLine, endLine: fn.span.endLine },
    });
    for (const p of out) {
      b.edges.push({
        id: `e-exit-${b.edges.length}`,
        source: p.from,
        target: exit.id,
        kind: p.kind,
        ...(p.label ? { label: p.label } : {}),
      });
    }
    b.exitIds.push(exit.id);
  }

  return {
    id: functionId,
    name,
    params,
    nodes: b.nodes,
    edges: b.edges,
    entryId: entry.id,
    exitIds: b.exitIds.length ? b.exitIds : [entry.id],
  };
}

/** Global flag is required by matchAll. */
const CALL_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

export function buildProgramIR(
  funcs: SynFunction[],
  language: Language,
  diagnostics: Diagnostic[],
): ProgramIR {
  const functions = funcs.map((f) => buildFunctionGraph(f.node, f.id, f.name, f.params));

  // Resolve calls by name, but refuse to guess when a name is ambiguous: a wrong
  // call edge is worse than a missing one.
  const byName = new Map<string, string[]>();
  for (const f of functions) {
    const ids = byName.get(f.name) ?? [];
    ids.push(f.id);
    byName.set(f.name, ids);
  }

  const seen = new Set<string>();
  const callEdges: CallEdge[] = [];
  for (const f of functions) {
    for (const node of f.nodes) {
      for (const stmt of node.statements) {
        for (const m of stmt.matchAll(CALL_RE)) {
          const candidates = byName.get(m[1]);
          if (!candidates || candidates.length !== 1) continue;
          const to = candidates[0];
          const key = `${f.id}->${to}@${node.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // Self-calls are KEPT: recursion is the hero feature, not noise.
          callEdges.push({ from: f.id, to, nodeId: node.id });
        }
      }
    }
  }

  return { language, functions, callEdges, diagnostics, irVersion: IR_VERSION };
}
