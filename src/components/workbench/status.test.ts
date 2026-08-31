/**
 * The status indicator has to reconcile TWO independent facts, which is why this
 * is a pure function rather than a ternary in the JSX: what the browser's own
 * parse says (that is what is on screen), and what the server's analyze job says
 * (that is what is stored). They routinely disagree, and the ranking between them
 * is a product decision worth pinning down in tests.
 *
 * The rule: whatever the user can act on wins. An unsaved edit outranks a stale
 * server status, because the user can retype; a server failure outranks a happy
 * local parse, because otherwise the app claims "saved" about work that was not
 * analyzed.
 */
import { describe, it, expect } from 'vitest';
import { describeStatus } from './status';

const base = {
  parse: 'ready' as const,
  save: 'idle' as const,
  server: null,
  serverError: null,
  errorCount: 0,
  persists: true,
};

describe('describeStatus', () => {
  it('puts an unsaved edit above everything else', () => {
    const v = describeStatus({ ...base, save: 'error', server: 'ready' });
    expect(v).toMatchObject({ label: 'not saved', tone: 'error', retry: false });
  });

  it('says saving while a write is in flight', () => {
    expect(describeStatus({ ...base, save: 'saving' })).toMatchObject({
      label: 'saving',
      tone: 'busy',
    });
  });

  it('shows the first-load skeleton state as loading', () => {
    expect(describeStatus({ ...base, parse: 'first-load' })).toMatchObject({
      label: 'loading',
      tone: 'busy',
    });
  });

  it('reports the local parse while it runs', () => {
    expect(describeStatus({ ...base, parse: 'parsing' })).toMatchObject({
      label: 'parsing',
      tone: 'busy',
    });
  });

  it('reports a dead worker as a parser error', () => {
    expect(describeStatus({ ...base, parse: 'error' })).toMatchObject({
      label: 'parser error',
      tone: 'error',
    });
  });

  it('calls an empty editor empty, not ready', () => {
    expect(describeStatus({ ...base, parse: 'idle' })).toMatchObject({
      label: 'empty',
      tone: 'neutral',
    });
  });

  it('counts syntax errors, singular and plural', () => {
    expect(describeStatus({ ...base, errorCount: 1 }).label).toBe('1 syntax error');
    expect(describeStatus({ ...base, errorCount: 3 }).label).toBe('3 syntax errors');
  });

  it('offers a retry when the server analysis failed, and says why', () => {
    const v = describeStatus({
      ...base,
      server: 'failed',
      serverError: 'ENOENT tree-sitter-python.wasm',
    });
    expect(v).toMatchObject({
      label: 'analysis failed',
      tone: 'error',
      retry: true,
      title: 'ENOENT tree-sitter-python.wasm',
    });
  });

  it('surfaces a server failure even when the local parse is happy', () => {
    // The diagram on screen is fine and STAYS on screen (spec §11). But the app
    // must not call this 'saved' — nothing analyzed it.
    expect(describeStatus({ ...base, parse: 'ready', server: 'failed' })).toMatchObject({
      label: 'analysis failed',
      retry: true,
    });
  });

  it('reports the server queue honestly while it works', () => {
    expect(describeStatus({ ...base, server: 'queued' })).toMatchObject({
      label: 'queued',
      tone: 'busy',
    });
    expect(describeStatus({ ...base, server: 'parsing' })).toMatchObject({
      label: 'analyzing',
      tone: 'busy',
    });
  });

  it('says saved only once the server actually stored a graph', () => {
    expect(describeStatus({ ...base, server: 'ready' })).toMatchObject({
      label: 'saved',
      tone: 'ok',
    });
  });

  it('does not claim saved before the server has said anything', () => {
    // A project open with no status yet: honest neutral, never a false 'saved'.
    expect(describeStatus({ ...base, server: null })).toMatchObject({
      label: 'ready',
      tone: 'neutral',
    });
  });

  it('never says saved where nothing persists', () => {
    // The demo route has no project, so 'saved' would be a lie.
    const v = describeStatus({ ...base, persists: false, server: 'ready' });
    expect(v).toMatchObject({ label: 'ready', tone: 'neutral' });
  });

  it('never offers a retry where there is nothing to retry against', () => {
    const v = describeStatus({ ...base, persists: false, server: 'failed' });
    expect(v.retry).toBe(false);
  });

  it('ranks a syntax error above a server status', () => {
    // A partial parse is the user's problem to fix and the more useful thing to
    // say; the server will happily store a partial graph and report ready.
    expect(describeStatus({ ...base, errorCount: 2, server: 'ready' }).label).toBe(
      '2 syntax errors',
    );
  });
});
