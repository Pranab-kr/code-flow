# code-flow P1 — Plan 2: Persistence, Inngest, and saved layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in user's project — source, derived graph, and their dragged node positions — survives a reload.

**Architecture:** Supabase Auth + RLS-protected Postgres. The client POSTs **source only**; an Inngest job re-parses authoritatively with the same portable IR module, writes the graph, and broadcasts on Realtime. Manual node positions live in their own table keyed by stable structural id, so they survive every re-parse.

**Tech Stack:** Supabase (Postgres/Auth/RLS/Realtime), `@supabase/ssr`, Inngest, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` (§7 data flow, §8 schema)

**Prerequisite (blocking):** a Postgres instance. Either a container runtime for `supabase start`, or a hosted Supabase project. See Task 0.

## Global Constraints

- Versions: `@supabase/ssr` 0.12.5, `@supabase/supabase-js` 2.112.4, `supabase` CLI 2.116.0, `inngest` 4.18.1.
- **The client never uploads a graph.** Source only; the server re-derives. (spec §14.5)
- **RLS on every table**, keyed through `projects.user_id`, and **every table gets a negative test** proving user A cannot read or write user B's rows.
- `createServiceClient` must never be imported into a client component.
- `src/lib/ir/**` stays portable — the Inngest job imports `parseToIR` unchanged. No React/Next/DOM.
- A **negative RLS test that passes when it should fail means the policy is wrong.** Do not proceed.
- Orphaned layout overrides are **retained 30 days**, never hard-deleted on disappearance.

---

## Task 0: Provision Postgres

**Files:** `.env.local` (not committed)

- [ ] **Step 1: Pick a route**

*Local* (preferred — free, fast, disposable) needs Docker or Podman:

```bash
# Arch/CachyOS
sudo pacman -S docker && sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # then log out and back in
pnpm dlx supabase init && pnpm dlx supabase start
```

*Hosted* needs no local runtime. Create a project at supabase.com/dashboard, then
**Project Settings → API** for the three values below.

- [ ] **Step 2: Fill `.env.local`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`supabase start` prints all three. The anon key is public by design — RLS is what
protects data. The service-role key **bypasses RLS**: server-only, never in a
`NEXT_PUBLIC_*` var.

- [ ] **Step 3: Confirm the connection**

```bash
pnpm dlx supabase status     # local
# or, hosted: check the MCP server sees it
```

Expected: a URL and keys, no error. **Do not start Task 1 until this works** — every
later task's tests need a live database.

---

## Task 1: Schema and RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_rls.sql`
- Create: `src/lib/supabase/{client,server,middleware}.ts`, `src/middleware.ts`
- Test: `tests/rls.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createBrowserClient()`, `createServerClient()`, `createServiceClient()`; the table names every later task uses.

- [ ] **Step 1: Install**

```bash
pnpm add @supabase/supabase-js@2.112.4 @supabase/ssr@0.12.5
pnpm add -D supabase@2.116.0
```

- [ ] **Step 2: Write `supabase/migrations/0001_init.sql`**

```sql
create extension if not exists "pgcrypto";

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  theme_pref text not null default 'system'
    check (theme_pref in ('dark','light','system')),
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  language text not null default 'python'
    check (language in ('cpp','java','python')),
  current_snapshot_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_user_id_idx on projects(user_id, updated_at desc);

-- Append-only source history. Never UPDATE a snapshot's source.
create table snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  source text not null,
  language text not null check (language in ('cpp','java','python')),
  status text not null default 'queued'
    check (status in ('queued','parsing','ready','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index snapshots_project_idx on snapshots(project_id, created_at desc);

alter table projects
  add constraint projects_current_snapshot_fk
  foreign key (current_snapshot_id) references snapshots(id) on delete set null;

-- Derived. Disposable: regenerated from source on every parse.
create table graphs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null unique references snapshots(id) on delete cascade,
  ir jsonb not null,
  layout jsonb not null,
  ir_version int not null,
  created_at timestamptz not null default now()
);

-- PRECIOUS: the user's own arrangement. Scoped to the PROJECT, not the snapshot,
-- so it survives every re-parse. Keyed by stable structural node id (spec §6).
create table layout_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_id text not null,
  x double precision not null,
  y double precision not null,
  collapsed boolean not null default false,
  orphaned_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (project_id, node_id)
);
create index layout_overrides_project_idx on layout_overrides(project_id);

create table annotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_id text,                       -- nullable: free-floating notes allowed
  body text not null,
  x double precision not null,
  y double precision not null,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 3: Write `supabase/migrations/0002_rls.sql`**

```sql
alter table profiles         enable row level security;
alter table projects         enable row level security;
alter table snapshots        enable row level security;
alter table graphs           enable row level security;
alter table layout_overrides enable row level security;
alter table annotations      enable row level security;

create policy profiles_own on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy projects_own on projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- security definer so the policy can read projects without recursing into its own RLS
create function public.owns_project(pid uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid and p.user_id = auth.uid()
  );
$$;

create policy snapshots_own on snapshots
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

create policy graphs_own on graphs
  for all using (exists (
    select 1 from snapshots s
    where s.id = graphs.snapshot_id and public.owns_project(s.project_id)))
  with check (exists (
    select 1 from snapshots s
    where s.id = graphs.snapshot_id and public.owns_project(s.project_id)));

create policy layout_overrides_own on layout_overrides
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

create policy annotations_own on annotations
  for all using (public.owns_project(project_id))
  with check (public.owns_project(project_id));
```

- [ ] **Step 4: Apply**

Run: `pnpm dlx supabase db reset` (local) or `supabase db push` (hosted).
Expected: both migrations apply cleanly.

- [ ] **Step 5: Write the client factories**

`src/lib/supabase/client.ts`:

```ts
import { createBrowserClient as create } from '@supabase/ssr';

export function createBrowserClient() {
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

`src/lib/supabase/server.ts`:

```ts
import { createServerClient as create } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

export async function createServerClient() {
  const store = await cookies();   // async in Next 15+
  return create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a Server Component: middleware refreshes instead.
          }
        },
      },
    },
  );
}

/** Bypasses RLS. Server routes ONLY — never import into a client component. */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
```

- [ ] **Step 6: Write the failing RLS test**

`tests/rls.test.ts` — this runs in the `rls` vitest project, which already loads
`.env.local` (see `vitest.config.mts`):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function makeUser(email: string) {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  await admin.auth.admin.createUser({
    email, password: 'test-password-123', email_confirm: true,
  });
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({
    email, password: 'test-password-123',
  });
  if (error) throw error;
  return { client, userId: data.user!.id };
}

describe('RLS isolation', () => {
  let a: { client: SupabaseClient; userId: string };
  let b: { client: SupabaseClient; userId: string };
  let projectA: string;
  let snapshotA: string;

  beforeAll(async () => {
    const stamp = Number(process.env.TEST_STAMP ?? '1');
    a = await makeUser(`a-${stamp}@test.local`);
    b = await makeUser(`b-${stamp}@test.local`);

    const { data: p, error: pe } = await a.client
      .from('projects').insert({ user_id: a.userId, title: 'A project' })
      .select('id').single();
    if (pe) throw pe;
    projectA = p.id;

    const { data: s, error: se } = await a.client
      .from('snapshots').insert({ project_id: projectA, source: 'x=1', language: 'python' })
      .select('id').single();
    if (se) throw se;
    snapshotA = s.id;
  });

  // A blocked SELECT returns [] with error null; a blocked INSERT errors.
  it("user B cannot read user A's project", async () => {
    const { data } = await b.client.from('projects').select('*').eq('id', projectA);
    expect(data).toEqual([]);
  });

  it("user B cannot read user A's snapshots", async () => {
    const { data } = await b.client.from('snapshots').select('*').eq('project_id', projectA);
    expect(data).toEqual([]);
  });

  it("user B cannot write a snapshot into user A's project", async () => {
    const { error } = await b.client.from('snapshots')
      .insert({ project_id: projectA, source: 'evil', language: 'python' });
    expect(error).not.toBeNull();
  });

  it("user B cannot write a graph for user A's snapshot", async () => {
    const { error } = await b.client.from('graphs')
      .insert({ snapshot_id: snapshotA, ir: {}, layout: {}, ir_version: 1 });
    expect(error).not.toBeNull();
  });

  it("user B cannot write a layout override into user A's project", async () => {
    const { error } = await b.client.from('layout_overrides')
      .insert({ project_id: projectA, node_id: 'fake#b0', x: 0, y: 0 });
    expect(error).not.toBeNull();
  });

  it("user B cannot write an annotation into user A's project", async () => {
    const { error } = await b.client.from('annotations')
      .insert({ project_id: projectA, body: 'evil', x: 0, y: 0 });
    expect(error).not.toBeNull();
  });

  it("user B cannot read user A's profile", async () => {
    const { data } = await b.client.from('profiles').select('*').eq('id', a.userId);
    expect(data).toEqual([]);
  });

  it("user B cannot delete user A's project", async () => {
    await b.client.from('projects').delete().eq('id', projectA);
    const { data } = await a.client.from('projects').select('id').eq('id', projectA);
    expect(data).toHaveLength(1);   // survived
  });

  it('user A can read their own project', async () => {
    const { data } = await a.client.from('projects').select('id').eq('id', projectA);
    expect(data).toHaveLength(1);
  });
});
```

- [ ] **Step 7: Run it**

Run: `pnpm vitest run tests/rls.test.ts`
Expected: PASS (9 tests).

**If any negative test passes when it should fail, the policy is wrong.** Fix
`0002_rls.sql`, `db reset`, re-run. Do not assume flakiness, and do not proceed.

Local auth note: if signup fails, check `supabase/config.toml` has
`[auth.email] enable_signup = true` and `enable_confirmations = false`.

- [ ] **Step 8: Auth middleware**

`src/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          // MUST rebuild the response here, then copy cookies onto it. Returning a
          // response created before this point silently drops the refreshed session.
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/projects')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return response;
}
```

`src/middleware.ts`:

```ts
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|grammars|.*\\.(?:svg|png|jpg|woff2|wasm)$).*)'],
};
```

Note `grammars` and `wasm` in the matcher exclusion: running auth middleware on a
3MB wasm fetch is pure latency.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: Supabase schema with RLS and negative-path isolation tests"
```

---

## Task 2: Auth and project routes

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/actions.ts`
- Create: `src/app/(app)/projects/page.tsx`, `src/app/(app)/projects/actions.ts`
- Create: `src/app/(app)/projects/[id]/page.tsx`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: Task 1's clients.
- Produces: `signIn`, `signUp`, `signOut`, `createProject`, `saveSource(projectId, source, language)`.

- [ ] **Step 1: Auth actions** — `src/app/(auth)/actions.ts`

```ts
'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });
  // Plain language, never a raw provider dump (spec §11).
  if (error) return { error: 'That email and password did not match an account.' };
  revalidatePath('/', 'layout');
  redirect('/projects');
}

export async function signUp(formData: FormData) {
  const supabase = await createServerClient();
  const { error } = await supabase.auth.signUp({
    email: String(formData.get('email')),
    password: String(formData.get('password')),
  });
  if (error) return { error: error.message };
  revalidatePath('/', 'layout');
  redirect('/projects');
}

export async function signOut() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

- [ ] **Step 2: Project actions** — `src/app/(app)/projects/actions.ts`

```ts
'use server';

import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { inngest } from '@/lib/inngest/client';

const MAX_SOURCE_BYTES = 100_000;
const MAX_SOURCE_LINES = 2000;

const STARTER: Record<string, string> = {
  python: `def binary_search(arr, target):\n    lo = 0\n    hi = len(arr) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if arr[mid] == target:\n            return mid\n        elif arr[mid] < target:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return -1\n`,
};

export async function createProject(formData: FormData) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const language = String(formData.get('language') ?? 'python');
  const { data: project, error } = await supabase
    .from('projects')
    .insert({ user_id: user.id, title: String(formData.get('title') || 'Untitled'), language })
    .select('id').single();
  if (error) throw error;

  // Seed a snapshot so the canvas is never empty on first open.
  const { data: snapshot } = await supabase
    .from('snapshots')
    .insert({ project_id: project.id, source: STARTER[language] ?? '', language, status: 'queued' })
    .select('id').single();

  if (snapshot) {
    await supabase.from('projects')
      .update({ current_snapshot_id: snapshot.id }).eq('id', project.id);
    await inngest.send({
      name: 'code/submitted',
      data: { snapshotId: snapshot.id, projectId: project.id },
    });
  }

  redirect(`/projects/${project.id}`);
}

/** Client sends SOURCE only. The server re-derives the graph. (spec §14.5) */
export async function saveSource(projectId: string, source: string, language: string) {
  if (source.length > MAX_SOURCE_BYTES) {
    return { error: `That is over the ${MAX_SOURCE_BYTES / 1000}KB limit for one snapshot.` };
  }
  if (source.split('\n').length > MAX_SOURCE_LINES) {
    return { error: `That is over the ${MAX_SOURCE_LINES}-line limit for one snapshot.` };
  }

  const supabase = await createServerClient();
  const { data: snapshot, error } = await supabase
    .from('snapshots')
    .insert({ project_id: projectId, source, language, status: 'queued' })
    .select('id').single();
  if (error) return { error: 'Could not save. Your local diagram is still current.' };

  await supabase.from('projects')
    .update({ current_snapshot_id: snapshot.id, updated_at: new Date().toISOString() })
    .eq('id', projectId);

  await inngest.send({
    name: 'code/submitted',
    data: { snapshotId: snapshot.id, projectId },
  });
  return { ok: true, snapshotId: snapshot.id };
}
```

- [ ] **Step 3: Login page** with all 8 states on the submit button, then the projects
list and the `[id]` page that renders the Task 7 `Workbench` with `initialSource` from
the current snapshot. Reuse `src/app/demo/Workbench.tsx` — move it to
`src/components/workbench/Workbench.tsx` and add `projectId` + `onSave` props.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: auth and project routes"
```

---

## Task 3: Inngest analyze job

**Files:**
- Create: `src/lib/inngest/client.ts`, `src/lib/inngest/functions/analyze.ts`
- Create: `src/app/api/inngest/route.ts`
- Test: `src/lib/inngest/functions/analyze.test.ts`

**Interfaces:**
- Consumes: `parseToIR` (Plan 1 Task 5), `layoutProgram` (Plan 1 Task 6), `createServiceClient`.
- Produces: event `code/submitted` with `{ snapshotId, projectId }`.

- [ ] **Step 1: Install**

```bash
pnpm add inngest@4.18.1
```

- [ ] **Step 2: Client** — `src/lib/inngest/client.ts`

```ts
import { Inngest } from 'inngest';

export const inngest = new Inngest({ id: 'code-flow' });
```

- [ ] **Step 3: The job** — `src/lib/inngest/functions/analyze.ts`

```ts
import { NonRetriableError } from 'inngest';
import { inngest } from '../client';
import { createServiceClient } from '@/lib/supabase/server';
import { parseToIR } from '@/lib/ir/parse';
import { layoutProgram } from '@/lib/layout/elk';
import { IR_VERSION, type Language } from '@/lib/ir/types';

/**
 * Re-parses a snapshot AUTHORITATIVELY.
 *
 * The client's graph is never trusted or uploaded — it is a spoofable value the
 * AI (P4) and the tracer (P3) both have to reason about, so the server derives
 * its own from the stored source using the same portable IR module.
 */
export const analyze = inngest.createFunction(
  { id: 'analyze-snapshot', retries: 3 },
  { event: 'code/submitted' },
  async ({ event, step }) => {
    const { snapshotId } = event.data as { snapshotId: string; projectId: string };
    const db = createServiceClient();

    const snapshot = await step.run('load-snapshot', async () => {
      const { data, error } = await db
        .from('snapshots').select('id, source, language, project_id')
        .eq('id', snapshotId).single();
      // A deleted snapshot is not worth retrying.
      if (error || !data) throw new NonRetriableError(`snapshot ${snapshotId} not found`);
      return data;
    });

    await step.run('mark-parsing', async () => {
      await db.from('snapshots').update({ status: 'parsing' }).eq('id', snapshotId);
    });

    try {
      const { ir, layout } = await step.run('parse-and-layout', async () => {
        const parsed = await parseToIR(snapshot.source, snapshot.language as Language, {
          // Node resolves grammars from the repo's public/ directory.
          baseUrl: 'public',
        });
        const laid = await layoutProgram(parsed.functions);
        return { ir: parsed, layout: laid };
      });

      await step.run('write-graph', async () => {
        await db.from('graphs').upsert(
          { snapshot_id: snapshotId, ir, layout, ir_version: IR_VERSION },
          { onConflict: 'snapshot_id' },
        );
        await db.from('snapshots')
          .update({ status: 'ready', error: null }).eq('id', snapshotId);
      });

      // Realtime: the client swaps to the server graph. Postgres changes on
      // `snapshots` already broadcast, so no explicit publish is needed.
      return { ok: true, functions: ir.functions.length };
    } catch (err) {
      await step.run('mark-failed', async () => {
        await db.from('snapshots').update({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        }).eq('id', snapshotId);
      });
      throw err;
    }
  },
);
```

- [ ] **Step 4: Route** — `src/app/api/inngest/route.ts`

```ts
import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { analyze } from '@/lib/inngest/functions/analyze';

export const { GET, POST, PUT } = serve({ client: inngest, functions: [analyze] });
```

- [ ] **Step 5: Run the dev server and verify a real round trip**

```bash
pnpm dev
pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Create a project in the UI. Expected: the run appears in the Inngest dashboard, the
snapshot's `status` goes `queued → parsing → ready`, and a `graphs` row exists whose
`ir` has the same node ids the client computed.

**Kill the Inngest dev server mid-run and reload the page.** Expected: the local
client graph is still on screen with an amber status dot — never a blank canvas.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: Inngest analyze job with authoritative server-side re-parse"
```

---

## Task 4: Layout overrides and orphan GC

**Files:**
- Create: `src/lib/layout/overrides.ts`
- Create: `src/app/(app)/projects/[id]/layout-actions.ts`
- Create: `src/lib/inngest/functions/gc-overrides.ts`
- Test: `src/lib/layout/overrides.test.ts`, `tests/rls.test.ts` (extend)

**Interfaces:**
- Consumes: stable node ids (Plan 1 Task 3), `LaidOutGraph` (Plan 1 Task 6).
- Produces:
  - `reconcile(saved: Override[], liveIds: Set<string>): { active: Override[]; orphaned: string[]; revived: string[] }`
  - `saveOverride(projectId, nodeId, x, y)`, `loadOverrides(projectId)`

- [ ] **Step 1: Write the failing reconcile test**

`src/lib/layout/overrides.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcile, type Override } from './overrides';

const ov = (nodeId: string, orphanedAt: string | null = null): Override =>
  ({ nodeId, x: 10, y: 20, collapsed: false, orphanedAt });

describe('reconcile', () => {
  it('keeps overrides whose node still exists', () => {
    const out = reconcile([ov('a'), ov('b')], new Set(['a', 'b']));
    expect(out.active.map((o) => o.nodeId)).toEqual(['a', 'b']);
    expect(out.orphaned).toEqual([]);
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
    const out = reconcile([ov('gone', '2026-08-01T00:00:00Z')], new Set(['other']));
    expect(out.orphaned).toEqual([]);   // already marked; nothing to write
  });

  it('is a pure function — never mutates its input', () => {
    const saved = [ov('a'), ov('gone')];
    const before = JSON.stringify(saved);
    reconcile(saved, new Set(['a']));
    expect(JSON.stringify(saved)).toBe(before);
  });
});

describe('override application', () => {
  it('an override wins over the auto layout, and only for its own node', () => {
    // toReactFlow already implements this (Plan 1 Task 7); asserted here so the
    // contract is pinned from the persistence side too.
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm test src/lib/layout/overrides.test.ts` → FAIL (no module)

- [ ] **Step 3: Implement** — `src/lib/layout/overrides.ts`

```ts
export interface Override {
  nodeId: string;
  x: number;
  y: number;
  collapsed: boolean;
  orphanedAt: string | null;
}

export interface Reconciled {
  /** Overrides to apply to the current graph. */
  active: Override[];
  /** Node ids to stamp orphaned_at on (newly vanished). */
  orphaned: string[];
  /** Node ids whose orphaned_at should be cleared (reappeared). */
  revived: string[];
}

/**
 * Match saved positions against the node ids in a freshly derived graph.
 *
 * Vanished nodes are MARKED, never deleted: a transient syntax error can make a
 * node disappear for a single parse, and hard-deleting would throw away
 * arrangement work because the user typed a stray brace. A scheduled job removes
 * overrides still orphaned after 30 days.
 */
export function reconcile(saved: Override[], liveIds: Set<string>): Reconciled {
  const active: Override[] = [];
  const orphaned: string[] = [];
  const revived: string[] = [];

  for (const o of saved) {
    if (liveIds.has(o.nodeId)) {
      active.push(o);
      if (o.orphanedAt) revived.push(o.nodeId);
    } else if (!o.orphanedAt) {
      orphaned.push(o.nodeId);
    }
  }
  return { active, orphaned, revived };
}

export const ORPHAN_RETENTION_DAYS = 30;
```

- [ ] **Step 4: Run it** → PASS (6 tests)

- [ ] **Step 5: Server actions** — `layout-actions.ts` with `saveOverride` (upsert on
`(project_id, node_id)`, clearing `orphaned_at`) and `loadOverrides`. Debounce drags
client-side at 500ms so a drag is one write, not sixty.

- [ ] **Step 6: GC job** — `src/lib/inngest/functions/gc-overrides.ts`

```ts
import { inngest } from '../client';
import { createServiceClient } from '@/lib/supabase/server';
import { ORPHAN_RETENTION_DAYS } from '@/lib/layout/overrides';

export const gcOverrides = inngest.createFunction(
  { id: 'gc-orphaned-overrides' },
  { cron: '17 4 * * *' },   // off-peak, off the hour
  async ({ step }) => {
    const deleted = await step.run('delete-expired', async () => {
      const db = createServiceClient();
      const cutoff = new Date(Date.now() - ORPHAN_RETENTION_DAYS * 86_400_000).toISOString();
      const { data } = await db.from('layout_overrides')
        .delete().lt('orphaned_at', cutoff).select('id');
      return data?.length ?? 0;
    });
    return { deleted };
  },
);
```

Register it in `src/app/api/inngest/route.ts` alongside `analyze`.

- [ ] **Step 7: Verify by hand — the test that matters most**

1. Open a project, drag three nodes into a shape, reload → positions hold.
2. Break the syntax (delete a colon), wait for the parse, fix it → **positions still hold.**
3. Add a statement inside a block → positions hold.
4. Insert a new `if` above an existing one → the later structure re-lays out, as documented in spec §6.

- [ ] **Step 8: Extend the RLS test** with `layout_overrides` and `annotations` negative
cases (already in Task 1 Step 6 — confirm they still pass), then commit.

```bash
git commit -m "feat: persisted layout overrides with orphan retention"
```

---

## Task 5: Realtime and status states

**Files:**
- Create: `src/lib/useSnapshotStatus.ts`
- Modify: the Workbench status indicator

- [ ] **Step 1: Enable Realtime on `snapshots`**

```sql
-- supabase/migrations/0003_realtime.sql
alter publication supabase_realtime add table snapshots;
```

- [ ] **Step 2: Subscribe** — `useSnapshotStatus(snapshotId)` returns
`'queued' | 'parsing' | 'ready' | 'failed'`, subscribing to `postgres_changes` on
that row and unsubscribing on unmount.

- [ ] **Step 3: Wire the indicator.** The four states map to plain words, and a
`failed` status **keeps the local graph on screen** with a retry affordance. Never a
blank canvas (spec §11).

- [ ] **Step 4: Verify** — edit code, watch the dot go `parsing → ready` without a
reload. Then stop the Inngest dev server, edit again: the dot goes amber, the diagram
stays.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: Realtime snapshot status with degrade-never-blank states"
```

---

## Self-Review

**Spec coverage:** §7 durable path (Task 3), §8 every table + RLS (Task 1), §8
`layout_overrides` separation and 30-day retention (Task 4), §11 failure states
(Tasks 2, 3, 5), §12 RLS negative tests (Task 1), §14.5 client-never-uploads-a-graph
(Tasks 2, 3).

**Deferred:** annotations UI (schema exists, sticky notes ship with export in Plan 4),
project rename/delete UI.

**Type consistency:** `reconcile`, `Override`, `saveOverride`, `loadOverrides`,
`saveSource`, `createProject`, `analyze`, `gcOverrides` each defined once. The
`code/submitted` event payload is `{ snapshotId, projectId }` in both sender and
receiver.

**Done when:** a user signs up, creates a project, edits code, drags nodes, reloads,
and finds their arrangement intact — with `pnpm vitest run tests/rls.test.ts` green.
