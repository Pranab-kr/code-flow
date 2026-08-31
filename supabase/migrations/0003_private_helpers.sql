-- Close the RPC surface on both SECURITY DEFINER helpers.
--
-- The Supabase security linter flagged public.owns_project and
-- public.handle_new_user as callable by anon AND authenticated over
-- /rest/v1/rpc/*. Neither leaked data (owns_project returns false when
-- auth.uid() is null), but an RPC endpoint nobody needs is surface nobody
-- should have.
--
-- Moving them to a `private` schema is the fix rather than revoking EXECUTE:
-- PostgREST only exposes functions in its API schemas, while RLS policies still
-- resolve them normally. Revoking EXECUTE would break the policies instead,
-- because a policy expression is evaluated as the querying role.

create schema if not exists private;
revoke all on schema private from anon, authenticated;

-- Policies depend on owns_project, so drop them first.
drop policy if exists snapshots_own        on snapshots;
drop policy if exists graphs_own           on graphs;
drop policy if exists layout_overrides_own on layout_overrides;
drop policy if exists annotations_own      on annotations;

drop function if exists public.owns_project(uuid);

create function private.owns_project(pid uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid and p.user_id = auth.uid()
  );
$$;

-- Still needs EXECUTE (policies run as the querying role); it just can no longer
-- be reached over HTTP.
grant usage on schema private to authenticated;
grant execute on function private.owns_project(uuid) to authenticated;

create policy snapshots_own on snapshots
  for all using (private.owns_project(project_id))
  with check (private.owns_project(project_id));

create policy graphs_own on graphs
  for all using (exists (
    select 1 from snapshots s
    where s.id = graphs.snapshot_id and private.owns_project(s.project_id)))
  with check (exists (
    select 1 from snapshots s
    where s.id = graphs.snapshot_id and private.owns_project(s.project_id)));

create policy layout_overrides_own on layout_overrides
  for all using (private.owns_project(project_id))
  with check (private.owns_project(project_id));

create policy annotations_own on annotations
  for all using (private.owns_project(project_id))
  with check (private.owns_project(project_id));

-- The signup trigger fires as the auth admin role during an insert into
-- auth.users, so it needs no grant to anon or authenticated at all.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
