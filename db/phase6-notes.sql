-- =============================================================
-- Phase 6: project notes + zone notes
-- Run this ONCE in the Supabase SQL Editor.
-- =============================================================

-- Project-level notes are a real column (so the projects list can
-- search them). Zone-level notes live inside the existing state JSONB
-- blob — no schema change needed for those.
alter table public.projects
  add column if not exists notes text,
  add column if not exists notes_show_on_estimate boolean not null default true;
