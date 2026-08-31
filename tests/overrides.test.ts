/**
 * Layout-override round trip against the real database.
 *
 * The load-bearing behaviour of Plan 2 Task 4: a position the user dragged must
 * survive a re-parse, and must survive a node vanishing for one parse because of
 * a transient syntax error. Both are asserted here against real rows rather than
 * a mock, because the interesting part is the upsert and the orphan bookkeeping.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { reconcile, toPositions, type Override } from '../src/lib/layout/overrides';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

describe('layout override persistence', () => {
  let client: SupabaseClient;
  let userId: string;
  let projectId: string;

  const NODE = 'binary_search(arr,target)/while@0#cond-b0';

  beforeAll(async () => {
    const email = `ov-${process.pid}-${Math.floor(performance.now())}@test.local`;
    const password = 'test-password-123';
    const { data: created, error: ce } = await admin().auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (ce) throw ce;
    userId = created.user.id;

    client = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
    const { error: se } = await client.auth.signInWithPassword({ email, password });
    if (se) throw se;

    const { data: p, error: pe } = await client
      .from('projects').insert({ user_id: userId, title: 'Overrides' })
      .select('id').single();
    if (pe) throw pe;
    projectId = p.id;
  }, 60_000);

  afterAll(async () => {
    if (userId) await admin().auth.admin.deleteUser(userId).catch(() => {});
  }, 60_000);

  it('saves a dragged position and reads it back', async () => {
    const { error } = await client.from('layout_overrides').upsert(
      { project_id: projectId, node_id: NODE, x: 420, y: 137, orphaned_at: null },
      { onConflict: 'project_id,node_id' },
    );
    expect(error).toBeNull();

    const { data } = await client
      .from('layout_overrides').select('x, y').eq('project_id', projectId)
      .eq('node_id', NODE).single();
    expect(data).toEqual({ x: 420, y: 137 });
  });

  it('a second drag of the same node updates rather than duplicating', async () => {
    await client.from('layout_overrides').upsert(
      { project_id: projectId, node_id: NODE, x: 10, y: 20, orphaned_at: null },
      { onConflict: 'project_id,node_id' },
    );
    const { data } = await client
      .from('layout_overrides').select('x, y').eq('project_id', projectId).eq('node_id', NODE);
    expect(data).toHaveLength(1);           // the unique constraint holds
    expect(data![0]).toEqual({ x: 10, y: 20 });
  });

  it('survives a re-parse: the same node id still matches', async () => {
    const { data } = await client
      .from('layout_overrides').select('node_id, x, y, collapsed, orphaned_at')
      .eq('project_id', projectId);
    const saved: Override[] = data!.map((r) => ({
      nodeId: r.node_id, x: r.x, y: r.y, collapsed: r.collapsed, orphanedAt: r.orphaned_at,
    }));
    // Ids are structural, so an unrelated edit re-derives the SAME id.
    const out = reconcile(saved, new Set([NODE]));
    expect(toPositions(out.active)).toEqual({ [NODE]: { x: 10, y: 20 } });
    expect(out.orphaned).toEqual([]);
  });

  it('a transient syntax error orphans but does NOT delete the position', async () => {
    // Parse yields no nodes at all — the state mid-typing after deleting a colon.
    const { data } = await client
      .from('layout_overrides').select('node_id, x, y, collapsed, orphaned_at')
      .eq('project_id', projectId);
    const saved: Override[] = data!.map((r) => ({
      nodeId: r.node_id, x: r.x, y: r.y, collapsed: r.collapsed, orphanedAt: r.orphaned_at,
    }));
    const out = reconcile(saved, new Set());
    expect(out.orphaned).toEqual([NODE]);

    await client.from('layout_overrides')
      .update({ orphaned_at: new Date().toISOString() })
      .eq('project_id', projectId).in('node_id', out.orphaned);

    // The ROW is still there. This is the whole point.
    const { data: still } = await client
      .from('layout_overrides').select('x, y, orphaned_at')
      .eq('project_id', projectId).eq('node_id', NODE).single();
    expect(still!.x).toBe(10);
    expect(still!.orphaned_at).not.toBeNull();
  });

  it('fixing the syntax error revives the position unchanged', async () => {
    const { data } = await client
      .from('layout_overrides').select('node_id, x, y, collapsed, orphaned_at')
      .eq('project_id', projectId);
    const saved: Override[] = data!.map((r) => ({
      nodeId: r.node_id, x: r.x, y: r.y, collapsed: r.collapsed, orphanedAt: r.orphaned_at,
    }));
    const out = reconcile(saved, new Set([NODE]));
    expect(out.revived).toEqual([NODE]);
    expect(toPositions(out.active)).toEqual({ [NODE]: { x: 10, y: 20 } });

    await client.from('layout_overrides')
      .update({ orphaned_at: null })
      .eq('project_id', projectId).in('node_id', out.revived);

    const { data: cleared } = await client
      .from('layout_overrides').select('orphaned_at')
      .eq('project_id', projectId).eq('node_id', NODE).single();
    expect(cleared!.orphaned_at).toBeNull();
  });

  it('deleting the project cascades its overrides away', async () => {
    await client.from('projects').delete().eq('id', projectId);
    const { data } = await client
      .from('layout_overrides').select('id').eq('project_id', projectId);
    expect(data).toEqual([]);
  });
});
