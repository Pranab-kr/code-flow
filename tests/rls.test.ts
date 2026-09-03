/**
 * RLS isolation. The most important tests in the repo.
 *
 * These are NEGATIVE tests on purpose: they assert that user B *cannot* reach user
 * A's rows. A positive-only auth suite passes just as happily against a database
 * with RLS switched off, which is exactly how a leak ships.
 *
 * If a negative test here passes when it should fail, the POLICY is wrong. Fix the
 * migration; do not weaken the test and do not assume flakiness.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PUBLISHABLE =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = () => createClient(URL, SERVICE, { auth: { persistSession: false } });

interface TestUser {
  client: SupabaseClient;
  userId: string;
  email: string;
}

/** Create a confirmed user and sign them in with the publishable key. */
async function makeUser(tag: string): Promise<TestUser> {
  // A fixed-but-unique suffix per run; Date.now() would collide across parallel files.
  const email = `rls-${tag}-${process.pid}-${Math.floor(performance.now())}@test.local`;
  const password = 'test-password-123';

  const { data: created, error: ce } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (ce) throw new Error(`createUser(${tag}): ${ce.message}`);

  const client = createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });
  const { error: se } = await client.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn(${tag}): ${se.message}`);

  return { client, userId: created.user.id, email };
}

describe('RLS isolation', () => {
  let a: TestUser;
  let b: TestUser;
  let projectA: string;
  let snapshotA: string;

  beforeAll(async () => {
    expect(URL, 'NEXT_PUBLIC_SUPABASE_URL missing — is .env.local filled in?').toBeTruthy();
    expect(PUBLISHABLE, 'publishable key missing').toBeTruthy();
    expect(SERVICE, 'service role key missing').toBeTruthy();

    a = await makeUser('a');
    b = await makeUser('b');

    const { data: p, error: pe } = await a.client
      .from('projects')
      .insert({ user_id: a.userId, title: 'A project' })
      .select('id')
      .single();
    if (pe) throw new Error(`seed project: ${pe.message}`);
    projectA = p.id;

    const { data: s, error: se } = await a.client
      .from('snapshots')
      .insert({ project_id: projectA, source: 'x = 1\n', language: 'python' })
      .select('id')
      .single();
    if (se) throw new Error(`seed snapshot: ${se.message}`);
    snapshotA = s.id;
  }, 60_000);

  afterAll(async () => {
    // Leave no test users behind on a shared hosted project.
    const db = admin();
    for (const u of [a, b]) {
      if (u?.userId) await db.auth.admin.deleteUser(u.userId).catch(() => {});
    }
  }, 60_000);

  // ---- reads ----------------------------------------------------------------
  // A blocked SELECT returns [] with error null. That is why these assert on data
  // rather than on an error: expecting an error here would pass vacuously.

  it("B cannot read A's project", async () => {
    const { data, error } = await b.client.from('projects').select('*').eq('id', projectA);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("B cannot read A's snapshots", async () => {
    const { data } = await b.client.from('snapshots').select('*').eq('project_id', projectA);
    expect(data).toEqual([]);
  });

  it("B cannot read A's profile", async () => {
    const { data } = await b.client.from('profiles').select('*').eq('id', a.userId);
    expect(data).toEqual([]);
  });

  it('B listing all projects sees none of A\'s', async () => {
    const { data } = await b.client.from('projects').select('id');
    expect(data?.some((r) => r.id === projectA)).toBe(false);
  });

  // ---- writes ---------------------------------------------------------------

  it("B cannot write a snapshot into A's project", async () => {
    const { error } = await b.client
      .from('snapshots')
      .insert({ project_id: projectA, source: 'evil', language: 'python' });
    expect(error).not.toBeNull();
  });

  it("B cannot write a graph for A's snapshot", async () => {
    const { error } = await b.client
      .from('graphs')
      .insert({ snapshot_id: snapshotA, ir: {}, layout: {}, ir_version: 1 });
    expect(error).not.toBeNull();
  });

  it("B cannot write a layout override into A's project", async () => {
    const { error } = await b.client
      .from('layout_overrides')
      .insert({ project_id: projectA, node_id: 'fake#b0', x: 0, y: 0 });
    expect(error).not.toBeNull();
  });

  it("B cannot write an annotation into A's project", async () => {
    const { error } = await b.client
      .from('annotations')
      .insert({ project_id: projectA, body: 'evil', x: 0, y: 0 });
    expect(error).not.toBeNull();
  });

  it('B cannot create a project owned by A', async () => {
    const { error } = await b.client
      .from('projects')
      .insert({ user_id: a.userId, title: 'impersonation' });
    expect(error).not.toBeNull();
  });

  // ---- updates and deletes -------------------------------------------------
  // These need an after-the-fact check: an UPDATE or DELETE matching zero rows
  // succeeds quietly, so only A's own read proves the row survived intact.

  it("B cannot rename A's project", async () => {
    await b.client.from('projects').update({ title: 'hacked' }).eq('id', projectA);
    const { data } = await a.client.from('projects').select('title').eq('id', projectA).single();
    expect(data?.title).toBe('A project');
  });

  it("B cannot delete A's project", async () => {
    await b.client.from('projects').delete().eq('id', projectA);
    const { data } = await a.client.from('projects').select('id').eq('id', projectA);
    expect(data).toHaveLength(1);
  });

  it("B cannot delete A's snapshot", async () => {
    await b.client.from('snapshots').delete().eq('id', snapshotA);
    const { data } = await a.client.from('snapshots').select('id').eq('id', snapshotA);
    expect(data).toHaveLength(1);
  });

  // ---- provider keys --------------------------------------------------------
  // user_provider_keys has RLS enabled with NO policy: every client role is
  // denied, and only the service-role client (server routes) may touch it.

  it('no client can read provider keys, not even their own', async () => {
    const { data } = await a.client.from('user_provider_keys').select('*');
    expect(data).toEqual([]); // service-role only
  });

  it('no client can insert a provider key directly', async () => {
    const { error } = await a.client
      .from('user_provider_keys')
      .insert({ user_id: a.userId, provider: 'openai', last4: '1234', ciphertext: 'x', iv: 'y' });
    expect(error).not.toBeNull();
  });

  // ---- chat tables ----------------------------------------------------------
  // chat_threads / chat_messages are owner-scoped through projects.user_id,
  // like snapshots. (0006_chat.sql; snippet from the context-builder task.)

  it("B cannot read A's chat threads", async () => {
    const { data } = await b.client.from('chat_threads').select('*');
    expect((data ?? []).filter((t) => t.project_id === projectA)).toEqual([]);
  });

  it("B cannot insert a chat thread into A's project", async () => {
    const { error } = await b.client
      .from('chat_threads')
      .insert({ project_id: projectA, title: 'hijack' });
    expect(error).not.toBeNull();
  });

  it("B cannot read or write A's chat messages", async () => {
    const { data: thread, error: threadError } = await a.client
      .from('chat_threads')
      .insert({ project_id: projectA, title: 'A thread' })
      .select('id')
      .single();
    expect(threadError).toBeNull();
    if (!thread) throw new Error('seed chat thread');
    await a.client
      .from('chat_messages')
      .insert({ thread_id: thread.id, role: 'user', content: 'why does this loop terminate?' });

    const { data: seen } = await b.client.from('chat_messages').select('*');
    expect((seen ?? []).filter((m) => m.thread_id === thread.id)).toEqual([]);

    const { error } = await b.client
      .from('chat_messages')
      .insert({ thread_id: thread.id, role: 'user', content: 'forged' });
    expect(error).not.toBeNull();
  });

  // ---- positive path -------------------------------------------------------
  // Without these, every test above would also pass against a database that
  // denies everything, including to its rightful owner.

  it('A can read their own project', async () => {
    const { data } = await a.client.from('projects').select('id').eq('id', projectA);
    expect(data).toHaveLength(1);
  });

  it('A can read their own snapshot', async () => {
    const { data } = await a.client.from('snapshots').select('id').eq('id', snapshotA);
    expect(data).toHaveLength(1);
  });

  it('A can write and read back their own layout override', async () => {
    const { error } = await a.client
      .from('layout_overrides')
      .upsert(
        { project_id: projectA, node_id: 'f()#entry', x: 12, y: 34 },
        { onConflict: 'project_id,node_id' },
      );
    expect(error).toBeNull();
    const { data } = await a.client
      .from('layout_overrides')
      .select('x, y')
      .eq('project_id', projectA)
      .eq('node_id', 'f()#entry')
      .single();
    expect(data).toEqual({ x: 12, y: 34 });
  });

  it('A gets a profile row automatically on signup', async () => {
    const { data } = await a.client.from('profiles').select('id').eq('id', a.userId);
    expect(data).toHaveLength(1);
  });
});
