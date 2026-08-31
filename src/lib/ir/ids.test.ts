import { describe, it, expect } from 'vitest';
import { IdBuilder, makeNodeId } from './ids';

describe('makeNodeId', () => {
  it('composes function, path, and role', () => {
    expect(makeNodeId('binarySearch(int*,int)', 'while@0/if@1/then', 'b0')).toBe(
      'binarySearch(int*,int)/while@0/if@1/then#b0',
    );
  });

  it('handles an empty path (function-level block)', () => {
    expect(makeNodeId('main()', '', 'b0')).toBe('main()#b0');
  });
});

describe('IdBuilder', () => {
  it('indexes same-kind siblings independently in a scope', () => {
    const b = new IdBuilder('f()');
    b.enter('if');
    b.exit();
    b.enter('if');
    b.exit();
    b.enter('while'); // separate counter per kind
    expect(b.path()).toBe('while@0');
    b.exit();
  });

  it('nests paths and resets child counters per scope', () => {
    const b = new IdBuilder('f()');
    b.enter('while'); // while@0
    b.enter('if'); // while@0/if@0
    expect(b.path()).toBe('while@0/if@0');
    b.exit();
    b.exit();
    b.enter('if'); // if@0 at top level — not if@1
    expect(b.path()).toBe('if@0');
  });

  it('numbers blocks sequentially within the current scope', () => {
    const b = new IdBuilder('f()');
    expect(b.block()).toBe('f()#b0');
    expect(b.block()).toBe('f()#b1');
    b.enter('if');
    expect(b.block('then')).toBe('f()/if@0#then-b0');
  });

  it('throws on an unbalanced exit rather than corrupting the path', () => {
    const b = new IdBuilder('f()');
    expect(() => b.exit()).toThrow(/unbalanced/i);
  });

  // --- enterRole: branch arms are their own scopes ---

  it('enterRole pushes a path segment with no sibling index', () => {
    const b = new IdBuilder('f()');
    b.enter('if');
    b.enterRole('then');
    expect(b.path()).toBe('if@0/then');
    expect(b.block()).toBe('f()/if@0/then#b0');
  });

  it('enterRole isolates the arms: editing one cannot re-id the other', () => {
    // Without arm scoping, both arms share one block ordinal, so adding a
    // statement to the THEN arm shifts every id in the ELSE arm — and the
    // user's saved layout for the else arm is destroyed by an unrelated edit.
    const withShortThen = (thenBlocks: number) => {
      const b = new IdBuilder('f()');
      b.enter('if');
      b.enterRole('then');
      for (let i = 0; i < thenBlocks; i++) b.block();
      b.exit();
      b.enterRole('else');
      const elseId = b.block();
      b.exit();
      b.exit();
      return elseId;
    };
    expect(withShortThen(1)).toBe(withShortThen(4));
    expect(withShortThen(1)).toBe('f()/if@0/else#b0');
  });

  it('enterRole does not consume a same-kind sibling index', () => {
    const b = new IdBuilder('f()');
    b.enter('if'); // if@0
    b.enterRole('then');
    b.exit();
    b.exit();
    b.enter('if'); // if@1 — the role did not disturb the 'if' counter
    expect(b.path()).toBe('if@1');
  });

  // --- Spec §6 consequences, as executable spec ---

  it('SURVIVES: editing statements inside a block keeps the same ids', () => {
    const firstBlockId = (stmtCount: number) => {
      const b = new IdBuilder('f()');
      const out: string[] = [];
      b.enter('while');
      for (let i = 0; i < stmtCount; i++) out.push(b.block());
      b.exit();
      return out[0];
    };
    expect(firstBlockId(1)).toBe(firstBlockId(5));
  });

  it('SHIFTS: inserting a structure before another re-indexes the later one', () => {
    const withoutLeading = new IdBuilder('f()');
    withoutLeading.enter('while');
    const before = withoutLeading.path();

    const withLeading = new IdBuilder('f()');
    withLeading.enter('while');
    withLeading.exit();
    withLeading.enter('while');
    const after = withLeading.path();

    expect(before).toBe('while@0');
    expect(after).toBe('while@1'); // documented, expected shift
  });

  it('scopes ids per function, so two functions never collide', () => {
    const a = new IdBuilder('push(int)');
    const b = new IdBuilder('pop()');
    expect(a.block()).toBe('push(int)#b0');
    expect(b.block()).toBe('pop()#b0');
    expect(a.block()).not.toBe(b.block());
  });
});
