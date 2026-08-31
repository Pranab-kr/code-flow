/**
 * IR type definitions. No logic lives here.
 *
 * This module — and everything under src/lib/ir/ — must stay portable: no React,
 * no Next, no DOM globals. One implementation runs in a browser web worker AND in
 * a Node job (Vitest today, Inngest later). An ESLint rule enforces it.
 */

/** Bump to invalidate every persisted graph. */
export const IR_VERSION = 1;

export type Language = 'cpp' | 'java' | 'python';

export type NodeKind =
  | 'entry'
  | 'exit'
  | 'basic'
  | 'branch'
  | 'loop-header'
  | 'switch'
  | 'return'
  | 'throw'
  | 'call-site';

export type EdgeKind =
  | 'seq'
  | 'true'
  | 'false'
  | 'case'
  | 'default'
  | 'back'
  | 'break'
  | 'continue'
  | 'exception'
  | 'call';

export type LoopKind = 'while' | 'for' | 'do-while' | 'foreach';

/** 1-based and inclusive, to match what editors show in the gutter. */
export interface Span {
  startLine: number;
  endLine: number;
}

export interface IRNode {
  /** Structural id — see ids.ts and spec §6. */
  id: string;
  kind: NodeKind;
  /** Display text, already collapsed to one line. */
  label: string;
  /** Source lines folded into this block. */
  statements: string[];
  span: Span;
  meta?: {
    loopKind?: LoopKind;
    caseValue?: string;
    /** Set on code that control flow cannot reach; the canvas renders it dimmed. */
    unsupported?: string;
  };
}

export interface IREdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** 'true' | 'false' | 'case 3' | 'break' — meaning is never carried by colour alone. */
  label?: string;
}

export interface FunctionGraph {
  /** Signature-derived so overloads do not collide: 'binarySearch(int*,int)'. */
  id: string;
  name: string;
  params: string[];
  nodes: IRNode[];
  edges: IREdge[];
  entryId: string;
  /** A list, not a single id: multiple returns are the normal case. */
  exitIds: string[];
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  span: Span;
}

export interface CallEdge {
  from: string;
  to: string;
  nodeId: string;
}

export interface ProgramIR {
  language: Language;
  functions: FunctionGraph[];
  callEdges: CallEdge[];
  /** A parse error yields diagnostics AND whatever IR was recoverable. */
  diagnostics: Diagnostic[];
  irVersion: number;
}
