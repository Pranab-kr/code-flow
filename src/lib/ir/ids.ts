/**
 * Structural node ids.
 *
 * The diagram is a derived view, so every parse produces a fresh graph. These ids
 * are what let the user's dragged layout survive that: they are keyed to a node's
 * POSITION IN THE SYNTAX TREE, not to its ordinal in a node array.
 *
 *     {functionId}/{structuralPath}#{role}
 *     binarySearch(int*,int)/while@0/if@1/then#b0
 *
 * Consequences are deliberate and tested in ids.test.ts (spec §6):
 *   - editing statements inside a block          -> ids hold, layout survives
 *   - inserting a control structure before another -> later siblings re-index
 */

export function makeNodeId(functionId: string, structuralPath: string, role: string): string {
  return structuralPath ? `${functionId}/${structuralPath}#${role}` : `${functionId}#${role}`;
}

interface Scope {
  /** kind -> next sibling index, for numbering same-kind siblings in THIS scope */
  counters: Map<string, number>;
  /** next block ordinal in this scope */
  blockOrdinal: number;
  /** this scope's path segment, e.g. 'while@0' or 'then' */
  segment: string;
}

/**
 * Allocates ids while a CFG is walked.
 *
 * Two ways to open a scope:
 *   enter(kind)     — a control structure. Takes a sibling index: `while@0`, `if@1`.
 *   enterRole(role) — a branch arm. No index, and no effect on the parent's
 *                     sibling counters, so `then` and `else` each get their own
 *                     block ordinals. Without this, adding a statement to the then
 *                     arm renumbers the else arm and silently discards the user's
 *                     saved positions for nodes they never touched.
 */
export class IdBuilder {
  private stack: Scope[];

  constructor(private readonly functionId: string) {
    this.stack = [{ counters: new Map(), blockOrdinal: 0, segment: '' }];
  }

  private get current(): Scope {
    return this.stack[this.stack.length - 1];
  }

  /** Open a control-structure scope, allocating its sibling index. */
  enter(kind: string): string {
    const parent = this.current;
    const index = parent.counters.get(kind) ?? 0;
    parent.counters.set(kind, index + 1);
    this.stack.push({ counters: new Map(), blockOrdinal: 0, segment: `${kind}@${index}` });
    return this.path();
  }

  /** Open a named sub-scope (a branch arm). No sibling index is consumed. */
  enterRole(role: string): string {
    this.stack.push({ counters: new Map(), blockOrdinal: 0, segment: role });
    return this.path();
  }

  exit(): void {
    if (this.stack.length === 1) throw new Error('IdBuilder: unbalanced exit()');
    this.stack.pop();
  }

  /** The current structural path, e.g. 'while@0/if@1/then'. */
  path(): string {
    return this.stack
      .map((s) => s.segment)
      .filter(Boolean)
      .join('/');
  }

  /** Allocate a block id in the current scope. `role` prefixes the ordinal. */
  block(role?: string): string {
    const ordinal = this.current.blockOrdinal++;
    const suffix = role ? `${role}-b${ordinal}` : `b${ordinal}`;
    return makeNodeId(this.functionId, this.path(), suffix);
  }
}
