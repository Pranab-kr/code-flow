'use client';

import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';

/** Mirrors the `snapshots.status` check constraint in 0001_init.sql. */
export type SnapshotStatus = 'queued' | 'parsing' | 'ready' | 'failed';

const STATUSES: readonly SnapshotStatus[] = ['queued', 'parsing', 'ready', 'failed'];

function isStatus(v: unknown): v is SnapshotStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

export interface SnapshotState {
  /** null until the first row or event arrives, and whenever there is no snapshot. */
  status: SnapshotStatus | null;
  /** Set only alongside `failed`; the reason the Inngest job recorded. */
  error: string | null;
}

/**
 * Follow one snapshot's SERVER-side analysis status.
 *
 * This is a different thing from `useParse`, deliberately. `useParse` reports the
 * browser's own parse, which is what draws the diagram; this reports whether the
 * durable pipeline has re-derived and stored an authoritative graph. They can
 * disagree — a perfectly good local diagram while the queue is unreachable is a
 * normal state, and the indicator should be able to say so.
 *
 * Reads the row once, then subscribes. The read is not redundant: a snapshot
 * created before this component mounted (an open project, a reload) emits no
 * UPDATE, so a subscription alone would sit at `null` forever.
 *
 * RLS applies. Realtime authenticates the socket with the user's access token,
 * so `postgres_changes` only delivers rows the same policies would have let a
 * SELECT return — a snapshot id from another account yields silence, not a leak.
 */
export function useSnapshotStatus(snapshotId: string | undefined): SnapshotState {
  // The id this state describes is stored WITH it, so switching snapshots resets
  // by derivation rather than by a setState in the effect body. Setting state
  // synchronously in an effect triggers a cascading render (and React's lint rule
  // rejects it); `useParse` derives its empty case the same way.
  const [state, setState] = useState<SnapshotState & { id?: string }>({
    status: null,
    error: null,
  });

  // Guards the one-shot read against a Realtime event that beat it. The Inngest
  // job can reach `ready` in well under a second, so applying the read
  // unconditionally would walk the indicator backwards from `ready` to `queued`
  // and strand it there, because no further UPDATE is coming.
  const sawEvent = useRef(false);

  useEffect(() => {
    if (!snapshotId) return;

    const supabase = createBrowserClient();
    let cancelled = false;
    sawEvent.current = false;

    const apply = (row: Record<string, unknown> | null | undefined) => {
      if (cancelled || !row || !isStatus(row.status)) return;
      setState({
        id: snapshotId,
        status: row.status,
        error: typeof row.error === 'string' ? row.error : null,
      });
    };

    const channel = supabase
      .channel(`snapshot:${snapshotId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'snapshots',
          filter: `id=eq.${snapshotId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          sawEvent.current = true;
          apply(payload.new);
        },
      )
      .subscribe();

    void supabase
      .from('snapshots')
      .select('status, error')
      .eq('id', snapshotId)
      .single()
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        if (sawEvent.current) return; // A live event already said something newer.
        apply(data);
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [snapshotId]);

  // State left over from a previous snapshot is not this one's status. Reporting
  // it would show the OLD snapshot's `ready` against a newly queued edit.
  if (!snapshotId || state.id !== snapshotId) return { status: null, error: null };

  return { status: state.status, error: state.error };
}
