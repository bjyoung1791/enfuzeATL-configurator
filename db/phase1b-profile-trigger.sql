-- =============================================================
-- Phase 1b: ensure every auth.users row has a matching profile
-- Run this ONCE in the Supabase SQL Editor, after phase1-auth.sql.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Trigger: auto-create a profile row whenever an auth user
--    is created (including via the Supabase Dashboard).
--    Defaults: role 'designer', must_change_password true.
--    Admins can promote / edit via the Users tab after creation.
--    If a profile already exists (our api/users endpoint creates
--    it explicitly), the ON CONFLICT clause skips the insert.
-- -------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role, must_change_password, active)
  values (new.id, new.email, 'designer', true, true)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -------------------------------------------------------------
-- 2. Backfill: any auth.users that already exist but have no
--    profile (e.g. created via Dashboard before the trigger
--    existed) get a default designer profile. Admin can then
--    promote them in the Users tab.
-- -------------------------------------------------------------
insert into public.profiles (id, email, role, must_change_password, active)
select u.id, u.email, 'designer', true, true
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
