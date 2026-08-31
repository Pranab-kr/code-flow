/**
 * Realtime snapshot status against the real database.
 *
 * The unit tests for `useSnapshotStatus` mock the Supabase client, so they prove
 * the hook's logic and nothing about whether Postgres actually delivers. Two
 * things can only be checked here:
 *
 *   1. `snapshots` is really in the `supabase_realtime` publication. Miss the
 *      migration and the hook subscribes successfully, receives nothing, and the
 *      indicator sits at its seeded value forever — a silent no-op, not an error.
 *   2. RLS applies to the STREAM, not just to SELECT. A publication makes rows
 *      available to Realtime; the policy is what decides who receives them. If
 *      another user's snapshot arrived here, this migration would have widened
 *      read access, which is the failure this file exists to catch.
 *
 * TRAP, and the reason this test failed on its first run: channel status
 * `SUBSCRIBED` does NOT mean postgres_changes is attached. The socket reports
 * SUBSCRIBED first and the replication connection is wired up a moment later,
 * announced by a `system` event. An UPDATE fired in that window is simply lost,
 * so a test that triggers on SUBSCRIBED times out even though the feature works.
 * `replication_ready` is what actually gates it.
 *
 * That trap makes the negative test below dangerous if left unfixed: it would
 * pass because the write raced the subscription, not because RLS blocked it. So
 * the negative case subscribes BOTH users and asserts the owner receives the very
 * same UPDATE the intruder does not. That way the delivery path is proven live in
 * the same window, and silence for the intruder can only mean the policy.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

/** Realtime is a network round trip; a tight timeout here reads as flakiness. */
const WAIT_MS = 15_000;

interface Row {
  status?: unknown;
  error?: unknown;
}

interface Listener {
  /** Resolves once postgres_changes is genuinely attached, not merely SUBSCRIBED. */
  ready: Promise<void>;
  /** Resolves with the first matching UPDATE, or null if none arrives in time. */
  received: Promise<Row | null>;
  close: () => Promise<void>;
}

/**
 * Listen for UPDATEs to one snapshot row, resolving `ready` only when the
 * replication connection is actually up. Firing a write before that is the race
 * described above.
 */
function listen(client: SupabaseClient, snapshotId: string): Listener {
  let markReady: () => void;
  let deliver: (row: Row | null) => void;

  const ready = new Promise<void>((r) => {
    markReady = r;
  });
  const received = new Promise<Row | null>((r) => {
    deliver = r;
  });

  const channel = client
    .channel(`test:${snapshotId}:${Math.random().toString(36).slice(2)}`, {
      config: { broadcast: { replication_ready: true } },
    })
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'snapshots',
        filter: `id=eq.${snapshotId}`,
      },
      (payload) => deliver(payload.new as Row),
    )
    .on('system', {}, (payload) => {
      if (payload?.extension === 'postgres_changes' && payload?.status === 'ok') {
        markReady();
      }
    })
    .subscribe();

  const timer = setTimeout(() => deliver(null), WAIT_MS);

  return {
    ready,
    received,
    close: async () => {
      clearTimeout(timer);
      await client.removeChannel(channel);
    },
  };
}

describe('realtime snapshot status', () => {
  let owner: SupabaseClient;
  let intruder: SupabaseClient;
  let ownerId: string;
  let intruderId: string;
  let projectId: string;
  let snapshotId: string;

  beforeAll(async () => {
    const password = 'test-password-123';
    const stamp = `${process.pid}-${Math.floor(performance.now())}`;

    const mk = async (prefix: string) => {
      const email = `${prefix}-${stamp}@test.local`;
      const { data, error } = await admin().auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      const client = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
      const { error: se } = await client.auth.signInWithPassword({ email, password });
      if (se) throw se;
      return { id: data.user.id, client };
    };

    const a = await mk('rt-owner');
    const b = await mk('rt-other');
    ownerId = a.id;
    owner = a.client;
    intruderId = b.id;
    intruder = b.client;

    const { data: project, error: pe } = await owner
      .from('projects')
      .insert({ user_id: ownerId, title: 'realtime', language: 'python' })
      .select('id')
      .single();
    if (pe) throw pe;
    projectId = project.id;

    const { data: snapshot, error: se } = await owner
      .from('snapshots')
      .insert({
        project_id: projectId,
        source: 'def f():\n    return 1\n',
        language: 'python',
        status: 'queued',
      })
      .select('id')
      .single();
    if (se) throw se;
    snapshotId = snapshot.id;
  }, 60_000);

  afterAll(async () => {
    await admin().from('projects').delete().eq('id', projectId);
    for (const id of [ownerId, intruderId]) {
      await admin().auth.admin.deleteUser(id);
    }
    await owner.removeAllChannels();
    await intruder.removeAllChannels();
  }, 60_000);

  it('delivers the analyze job status transitions to the owner', async () => {
    // Exactly what the Inngest job writes on its way through the work.
    const parsing = listen(owner, snapshotId);
    await parsing.ready;
    await admin().from('snapshots').update({ status: 'parsing' }).eq('id', snapshotId);

    const first = await parsing.received;
    await parsing.close();
    expect(first, 'no UPDATE arrived — is snapshots in supabase_realtime?').toBeTruthy();
    expect(first!.status).toBe('parsing');

    const done = listen(owner, snapshotId);
    await done.ready;
    await admin()
      .from('snapshots')
      .update({ status: 'ready', error: null })
      .eq('id', snapshotId);

    const second = await done.received;
    await done.close();
    expect(second).toBeTruthy();
    expect(second!.status).toBe('ready');
    expect(second!.error).toBeNull();
  }, 60_000);

  it('carries the failure reason, so the UI can say more than "it broke"', async () => {
    const l = listen(owner, snapshotId);
    await l.ready;
    await admin()
      .from('snapshots')
      .update({ status: 'failed', error: 'ENOENT tree-sitter-python.wasm' })
      .eq('id', snapshotId);

    const row = await l.received;
    await l.close();
    expect(row).toBeTruthy();
    expect(row!.status).toBe('failed');
    expect(row!.error).toBe('ENOENT tree-sitter-python.wasm');
  }, 60_000);

  // NEGATIVE. Publishing a table must not widen who can read it: RLS is
  // evaluated per subscriber before delivery.
  //
  // Both users listen to the same row and one UPDATE is fired. The owner
  // receiving it proves the event was live and deliverable in this exact window,
  // so the intruder's silence can only be the policy — not the subscription race
  // that made the first version of this file lie.
  it("does NOT deliver another user's snapshot", async () => {
    const mine = listen(owner, snapshotId);
    const theirs = listen(intruder, snapshotId);
    await Promise.all([mine.ready, theirs.ready]);

    await admin()
      .from('snapshots')
      .update({ status: 'ready', error: null })
      .eq('id', snapshotId);

    const delivered = await mine.received;
    const leaked = await theirs.received;
    await Promise.all([mine.close(), theirs.close()]);

    expect(delivered, 'control failed: the owner saw nothing either').toBeTruthy();
    expect(leaked, 'RLS LEAK: another user received a snapshot UPDATE').toBeNull();
  }, 60_000);
});
