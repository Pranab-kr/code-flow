-- BYOK key vault (Plan 5 Task 2).
--
-- One row per (user, provider). Key material is AES-256-GCM ciphertext;
-- decryption happens only inside a server route with the KEK from BYOK_KEK.
create table user_provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  label text,
  last4 text not null,
  ciphertext text not null,
  iv text not null,
  key_version int not null default 1,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table user_provider_keys enable row level security;
-- NO policy on purpose: RLS with zero policies denies everything to anon and
-- authenticated roles. Only the service-role client (which bypasses RLS) may read
-- this table, and only from a server route.
