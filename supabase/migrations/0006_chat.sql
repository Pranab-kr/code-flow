-- Grounded chat threads and messages (Plan 5, Task 3).
--
-- A thread belongs to one project; messages belong to one thread. Both reach
-- their owner through projects.user_id via private.owns_project (0003), the
-- same pattern as snapshots/graphs/annotations. RLS with zero missing
-- policies: every role except the owner is denied by default.
--
-- Chat history is a convenience copy. The grounded context sent to the model
-- is always re-derived on the server from the project's current source, never
-- trusted from the client, so a stale or forged node_context changes nothing
-- authoritative. node_context records which node the learner had selected when
-- they asked, so "why does this loop terminate?" stays answerable later.

create table chat_threads (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null default 'Untitled',
  created_at timestamptz not null default now()
);
create index chat_threads_project_idx on chat_threads(project_id);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references chat_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  provider text,
  model text,
  node_context jsonb,
  created_at timestamptz not null default now()
);
create index chat_messages_thread_idx on chat_messages(thread_id, created_at);

alter table chat_threads  enable row level security;
alter table chat_messages enable row level security;

create policy chat_threads_own on chat_threads
  for all using (private.owns_project(project_id))
  with check (private.owns_project(project_id));

-- Messages reach their owner one hop out, through their thread (cf. graphs_own
-- in 0002, which reaches through snapshots the same way).
create policy chat_messages_own on chat_messages
  for all using (exists (
    select 1 from chat_threads t
    where t.id = chat_messages.thread_id and private.owns_project(t.project_id)))
  with check (exists (
    select 1 from chat_threads t
    where t.id = chat_messages.thread_id and private.owns_project(t.project_id)));
