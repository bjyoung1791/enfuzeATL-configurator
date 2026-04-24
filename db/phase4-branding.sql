-- =============================================================
-- Phase 4: Customer info, proposal numbering, company branding
-- Run this ONCE in the Supabase SQL Editor, after prior phases.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Customer info columns on projects.
--    We store on the project row (not a separate customers table)
--    since customers are one-off per job for this business.
-- -------------------------------------------------------------
alter table public.projects
  add column if not exists customer_name     text,
  add column if not exists customer_company  text,
  add column if not exists customer_address  text,
  add column if not exists customer_email    text,
  add column if not exists customer_phone    text,
  add column if not exists proposal_number   text unique;

create index if not exists projects_proposal_number_idx on public.projects(proposal_number);
create index if not exists projects_customer_name_idx   on public.projects(customer_name);

-- -------------------------------------------------------------
-- 2. Proposal numbering.
--    Sequence-backed RPC returns the next proposal ID in the
--    format EA-YYYY-NNNN. Year is derived at call time from
--    Postgres's NOW(). Sequence grows monotonically (no reset at
--    year rollover) — simpler, and uniqueness is what actually
--    matters; the YYYY is just a visual grouping.
-- -------------------------------------------------------------
create sequence if not exists public.proposal_number_seq start 1;

create or replace function public.next_proposal_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  y text;
begin
  select nextval('public.proposal_number_seq') into n;
  y := to_char(now(), 'YYYY');
  return 'EA-' || y || '-' || lpad(n::text, 4, '0');
end;
$$;

grant execute on function public.next_proposal_number() to authenticated;

-- -------------------------------------------------------------
-- 3. Company branding defaults in admin_settings.
--    Insert rows only if they don't exist yet — safe to re-run.
--    The logo is stored as a base64 data URL string; this keeps
--    us from needing a Supabase Storage bucket for a single
--    one-off asset.
-- -------------------------------------------------------------
insert into public.admin_settings (setting_key, setting_value)
values ('company_name',    'Enfuze Atlanta')
  on conflict (setting_key) do nothing;

insert into public.admin_settings (setting_key, setting_value)
values ('company_address', '')
  on conflict (setting_key) do nothing;

insert into public.admin_settings (setting_key, setting_value)
values ('company_phone',   '')
  on conflict (setting_key) do nothing;

insert into public.admin_settings (setting_key, setting_value)
values ('company_website', '')
  on conflict (setting_key) do nothing;

insert into public.admin_settings (setting_key, setting_value)
values ('company_logo',    '')
  on conflict (setting_key) do nothing;
