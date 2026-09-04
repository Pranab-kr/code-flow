-- P2: JavaScript joins the language set (spec section 9 wiring checklist).
--
-- Both checks are inline in 0001_init.sql and therefore auto-named
-- `projects_language_check` / `snapshots_language_check`. IF EXISTS keeps
-- this re-runnable; widening cannot break existing rows or RLS policies.
alter table projects drop constraint if exists projects_language_check;
alter table projects add constraint projects_language_check
  check (language in ('cpp','java','python','javascript'));
alter table snapshots drop constraint if exists snapshots_language_check;
alter table snapshots add constraint snapshots_language_check
  check (language in ('cpp','java','python','javascript'));
