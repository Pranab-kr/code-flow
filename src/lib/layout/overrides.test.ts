import { describe, it, expect } from 'vitest';
import { reconcile, ORPHAN_RETENTION_DAYS, type Override } from './overrides';

const ov = (nodeId: string, orphanedAt: string | null = null): Override => ({
  nodeId,
  x: 10,
  y: 20,
  collapsed: false,
  orphanedAt,
});

describe('reconcile', () => {
  it('keeps overrides whose node still exists', () => {
    const out = reconcile([ov('a'), ov('b')], new Set(['a', 'b']));
    expect(out.active.map((o) => o.nodeId)).toEqual(['a', 'b']);
    expect(out.orphaned).toEqual([]);
    expect(out.revived).toEqual([]);
  });

  it('marks a vanished node orphaned instead of deleting it', () => {
    // A transient syntax error mid-typing makes a node disappear for one parse.
    // Hard-deleting here would destroy arrangement work over a stray brace.
    const out = reconcile([ov('a'), ov('gone')], new Set(['a']));
    expect(out.orphaned).toEqual(['gone']);
    expect(out.active.map((o) => o.nodeId)).toEqual(['a']);
  });

  it('revives an orphan whose node reappears', () => {
    const out = reconcile([ov('back', '2026-08-01T00:00:00Z')], new Set(['back']));
    expect(out.revived).toEqual(['back']);
    expect(out.active.map((o) => o.nodeId)).toEqual(['back']);
  });

  it('does not re-mark an already-orphaned node', () => {
    // Re-stamping would restart the 30-day clock on every parse, so an orphan
    // would never age out.
    const out = reconcile([ov('gone', '2026-08-01T00:00:00Z')], new Set(['other']));
    expect(out.orphaned).toEqual([]);
    expect(out.active).toEqual([]);
  });

  it('applies an orphan\'s position while it is still retained', () => {
    // The node is back, so its saved position is still the user's intent.
    const out = reconcile([ov('back', '2026-08-01T00:00:00Z')], new Set(['back']));
    expect(out.active[0]).toMatchObject({ x: 10, y: 20 });
  });

  it('is pure — never mutates its input', () => {
    const saved = [ov('a'), ov('gone')];
    const before = JSON.stringify(saved);
    reconcile(saved, new Set(['a']));
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('handles an empty saved set', () => {
    expect(reconcile([], new Set(['a']))).toEqual({ active: [], orphaned: [], revived: [] });
  });

  it('handles an empty graph — every override orphans at once', () => {
    // A file emptied or broken beyond parsing must not wipe saved positions.
    const out = reconcile([ov('a'), ov('b')], new Set());
    expect(out.orphaned.sort()).toEqual(['a', 'b']);
    expect(out.active).toEqual([]);
  });

  it('retains orphans for 30 days', () => {
    expect(ORPHAN_RETENTION_DAYS).toBe(30);
  });
});

describe('toPositions', () => {
  it('reduces active overrides to the shape the canvas consumes', async () => {
    const { toPositions } = await import('./overrides');
    expect(toPositions([ov('a'), ov('b')])).toEqual({
      a: { x: 10, y: 20 },
      b: { x: 10, y: 20 },
    });
  });
});
