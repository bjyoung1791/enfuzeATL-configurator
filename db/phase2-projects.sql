-- =============================================================
-- Phase 2: Projects table + role-based RLS
-- Run this ONCE in the Supabase SQL Editor, after phase1* have run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Helper: current_role() — the calling user's role, as text,
--    or NULL if not signed in / inactive. SECURITY DEFINER so it
--    can read profiles without triggering its own RLS.
-- -------------------------------------------------------------
create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles
  where id = auth.uid() and active = true;
$$;

grant execute on function public.current_role() to authenticated, anon;

-- -------------------------------------------------------------
-- 2. Projects table
--    - state: full configurator JSON blob (audio zones, insect
--      zones, cables, toggles, etc.) so the edit flow can hydrate
--      the UI without needing normalized sub-tables.
--    - outcome: NULL = still open, 'won' | 'lost' otherwise.
--    - archived: independent of outcome — a won OR lost OR open
--      project can be archived.
-- -------------------------------------------------------------
create table if not exists public.projects (
  id bigserial primary key,
  name text not null default '',
  project_date date,
  service_type text,
  state jsonb not null default '{}'::jsonb,
  equipment_total numeric(12,2) not null default 0,
  installation_total numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null default 0,
  outcome text check (outcome in ('won', 'lost')),
  archived boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_created_by_idx  on public.projects(created_by);
create index if not exists projects_archived_idx    on public.projects(archived);
create index if not exists projects_updated_at_idx  on public.projects(updated_at desc);
create index if not exists projects_outcome_idx     on public.projects(outcome);

-- updated_at trigger (touch_updated_at already created in phase1)
drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- 3. Row-level security
--
--    Designer:       see/insert/update/delete own projects only
--    Lead designer:  see ALL, update ALL (won/lost, archive, edit),
--                    delete NONE
--    Admin:          full rights on all projects
-- -------------------------------------------------------------
alter table public.projects enable row level security;

drop policy if exists "projects_select"       on public.projects;
drop policy if exists "projects_insert"       on public.projects;
drop policy if exists "projects_update"       on public.projects;
drop policy if exists "projects_delete"       on public.projects;

create policy "projects_select"
  on public.projects for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.current_role() in ('lead_designer', 'admin')
  );

create policy "projects_insert"
  on public.projects for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "projects_update"
  on public.projects for update
  to authenticated
  using (
    created_by = auth.uid()
    or public.current_role() in ('lead_designer', 'admin')
  )
  with check (
    created_by = auth.uid()
    or public.current_role() in ('lead_designer', 'admin')
  );

create policy "projects_delete"
  on public.projects for delete
  to authenticated
  using (
    public.current_role() = 'admin'
    or (public.current_role() = 'designer' and created_by = auth.uid())
  );
