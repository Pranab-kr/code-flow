-- code-flow P1 schema.
--
-- Shape follows spec §8. The load-bearing decision: `graphs` is DERIVED and
-- disposable (regenerated from source on every parse), while `layout_overrides`
-- holds the user's own arrangement and is precious. They are separate tables so
-- a re-parse can freely replace one without touching the other.

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

-- Append-only source history. Never UPDATE a snapshot's source: a new edit is a
-- new row, which is what makes the derived graph reproducible from any point.
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

-- Derived view of a snapshot. Disposable by design.
create table graphs (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null unique references snapshots(id) on delete cascade,
  ir jsonb not null,
  layout jsonb not null,
  ir_version int not null,
  created_at timestamptz not null default now()
);

-- The user's manual arrangement, keyed by STABLE STRUCTURAL node id (spec §6).
-- Scoped to the project, not the snapshot, so it survives every re-parse.
--
-- orphaned_at instead of a delete: a transient syntax error mid-typing can make a
-- node vanish for a single parse, and hard-deleting would throw away arrangement
-- work because someone typed a stray brace. A scheduled job clears rows still
-- orphaned after 30 days.
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
create index layout_overrides_orphaned_idx on layout_overrides(orphaned_at)
  where orphaned_at is not null;

create table annotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  node_id text,                      -- nullable: free-floating notes are allowed
  body text not null,
  x double precision not null,
  y double precision not null,
  created_at timestamptz not null default now()
);
create index annotations_project_idx on annotations(project_id);

-- Give every new auth user a profile row, so the app never has to branch on a
-- missing one.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
