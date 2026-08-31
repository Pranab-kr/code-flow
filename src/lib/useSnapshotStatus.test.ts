/**
 * The server-side snapshot status feed.
 *
 * Two behaviours here are load-bearing and easy to get wrong:
 *
 * 1. The initial fetch must not clobber a Realtime event that arrived first. The
 *    Inngest job often finishes in under a second, so `ready` can land before the
 *    one-shot read resolves. Applying the read unconditionally would walk the
 *    indicator backwards from `ready` to `queued` and leave it there, because no
 *    further UPDATE is coming.
 * 2. The channel must be removed on unmount and when the id changes. Every edit
 *    mints a new snapshot, so a leak here is one live socket subscription per
 *    keystroke burst, all of them writing into unmounted state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

type Handler = (payload: { new: Record<string, unknown> }) => void;

interface Bindings {
  event: string;
  table: string;
  filter?: string;
}

const handlers: Handler[] = [];
const bindings: Bindings[] = [];
const channelNames: string[] = [];
const removed: unknown[] = [];
let subscribeCalls = 0;
let selectedIds: string[] = [];

/** Resolved by the test, so a slow one-shot read can be simulated. */
let readRow: () => Promise<{ data: unknown; error: null }>;

const channel = {
  on: vi.fn((_type: string, filter: Bindings, cb: Handler) => {
    bindings.push(filter);
    handlers.push(cb);
    return channel;
  }),
  subscribe: vi.fn(() => {
    subscribeCalls += 1;
    return channel;
  }),
};

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => {
          selectedIds.push(id);
          return { single: () => readRow() };
        },
      }),
    }),
    channel: (name: string) => {
      channelNames.push(name);
      return channel;
    },
    removeChannel: (c: unknown) => {
      removed.push(c);
      return Promise.resolve('ok');
    },
  }),
}));

import { useSnapshotStatus } from './useSnapshotStatus';

const ID = '11111111-1111-1111-1111-111111111111';

function emit(row: Record<string, unknown>) {
  for (const h of handlers) h({ new: row });
}

beforeEach(() => {
  handlers.length = 0;
  bindings.length = 0;
  channelNames.length = 0;
  removed.length = 0;
  selectedIds = [];
  subscribeCalls = 0;
  readRow = () => Promise.resolve({ data: { status: 'queued', error: null }, error: null });
});

describe('useSnapshotStatus', () => {
  it('reports nothing and opens no channel without a snapshot id', () => {
    const { result } = renderHook(() => useSnapshotStatus(undefined));
    expect(result.current).toEqual({ status: null, error: null });
    expect(subscribeCalls).toBe(0);
    expect(selectedIds).toEqual([]);
  });

  it('seeds from the row that already exists', async () => {
    readRow = () =>
      Promise.resolve({ data: { status: 'ready', error: null }, error: null });

    const { result } = renderHook(() => useSnapshotStatus(ID));

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(selectedIds).toEqual([ID]);
  });

  it('subscribes to UPDATEs on that one row', () => {
    renderHook(() => useSnapshotStatus(ID));

    expect(subscribeCalls).toBe(1);
    expect(bindings[0]).toMatchObject({
      event: 'UPDATE',
      table: 'snapshots',
      filter: `id=eq.${ID}`,
    });
  });

  it('follows the job through to ready', async () => {
    const { result } = renderHook(() => useSnapshotStatus(ID));
    await waitFor(() => expect(result.current.status).toBe('queued'));

    act(() => emit({ status: 'parsing', error: null }));
    expect(result.current.status).toBe('parsing');

    act(() => emit({ status: 'ready', error: null }));
    expect(result.current).toEqual({ status: 'ready', error: null });
  });

  it('carries the reason on a failure', async () => {
    const { result } = renderHook(() => useSnapshotStatus(ID));

    act(() => emit({ status: 'failed', error: 'grammar wasm not found' }));
    await waitFor(() =>
      expect(result.current).toEqual({
        status: 'failed',
        error: 'grammar wasm not found',
      }),
    );
  });

  it('does not let a slow initial read overwrite a newer event', async () => {
    let release: (v: { data: unknown; error: null }) => void = () => {};
    readRow = () =>
      new Promise((resolve) => {
        release = resolve;
      });

    const { result } = renderHook(() => useSnapshotStatus(ID));

    act(() => emit({ status: 'ready', error: null }));
    expect(result.current.status).toBe('ready');

    // The one-shot read finally lands, carrying the stale pre-job value.
    await act(async () => {
      release({ data: { status: 'queued', error: null }, error: null });
      await Promise.resolve();
    });

    expect(result.current.status).toBe('ready');
  });

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useSnapshotStatus(ID));
    expect(removed).toHaveLength(0);
    unmount();
    expect(removed).toEqual([channel]);
  });

  it('resubscribes when the id changes, and drops the old channel', () => {
    const NEXT = '22222222-2222-2222-2222-222222222222';
    const { rerender } = renderHook(({ id }) => useSnapshotStatus(id), {
      initialProps: { id: ID },
    });

    rerender({ id: NEXT });

    expect(removed).toHaveLength(1);
    expect(subscribeCalls).toBe(2);
    expect(channelNames).toEqual([`snapshot:${ID}`, `snapshot:${NEXT}`]);
    expect(bindings[1]).toMatchObject({ filter: `id=eq.${NEXT}` });
  });

  it('ignores a status the schema does not define', async () => {
    const { result } = renderHook(() => useSnapshotStatus(ID));
    await waitFor(() => expect(result.current.status).toBe('queued'));

    act(() => emit({ status: 'weird', error: null }));
    expect(result.current.status).toBe('queued');
  });
});
