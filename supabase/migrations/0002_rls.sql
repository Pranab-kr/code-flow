-- Owner-scoped RLS. Every table reaches its owner through projects.user_id.
--
-- Read this before adding a table: a table with RLS enabled and NO policy denies
-- everything to anon and authenticated roles, which is the right default. A table
-- with RLS *disabled* is wide open to anyone holding the publishable key. Never
-- add a table without deciding which of those you meant.

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

-- security definer so a policy on a child table can read `projects` without
-- recursing into projects' own RLS. `set search_path = ''` is not decoration:
-- without it a caller could shadow `public` and redirect this lookup.
--
-- NOTE: 0003 moves this function to a `private` schema so PostgREST stops
-- exposing it as an RPC endpoint. It is left here as written so the migration
-- history stays truthful about what was actually applied, and when.
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

-- graphs reaches its owner one hop further out, through its snapshot.
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
